import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fsPromises from "node:fs/promises";
import type { Stats } from "node:fs";
import { Effect, Layer, Path } from "effect";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import {
  WorkspacePaths,
  WorkspaceRootNotDirectoryError,
  WorkspaceRootNotExistsError,
} from "../Services/WorkspacePaths.ts";

const DEFAULT_PROJECT_READ_FILE_MAX_BYTES = 256 * 1024;
const READ_FILE_CACHE_MAX_ENTRIES = 64;

function toPosixPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function isBinaryContent(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) {
    return true;
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

function lastModifiedMsOf(stat: Stats): number {
  return Math.max(0, Math.trunc(stat.mtimeMs));
}

function detectLineEnding(contents: string): "lf" | "crlf" {
  return contents.includes("\r\n") ? "crlf" : "lf";
}

function buildVersionToken(bytes: Uint8Array, stat: Stats): string {
  const digest = createHash("sha256")
    .update(bytes)
    .update("\0")
    .update(String(stat.size))
    .update("\0")
    .update(String(lastModifiedMsOf(stat)))
    .digest("hex");
  return `sha256:${digest}`;
}

type CachedReadFileResult =
  | {
      relativePath: string;
      kind: "binary";
      sizeBytes: number;
      lastModifiedMs: number;
      truncated: false;
    }
  | {
      relativePath: string;
      kind: "text";
      contents: string;
      encoding: "utf8";
      lineEnding: "lf" | "crlf";
      versionToken: string;
      sizeBytes: number;
      lastModifiedMs: number;
      truncated: false;
    };

interface ReadFileCacheEntry {
  maxBytes: number;
  sizeBytes: number;
  lastModifiedMs: number;
  result: CachedReadFileResult;
}

type WorkspaceMutationCode =
  | "outside_root"
  | "not_found"
  | "already_exists"
  | "not_a_directory"
  | "is_a_directory"
  | "directory_not_empty"
  | "invalid_move"
  | "stale_version"
  | "unsupported_encoding";

function makeWorkspaceError(input: {
  cwd: string;
  relativePath?: string;
  operation: string;
  code: WorkspaceMutationCode;
  detail: string;
  cause?: unknown;
}) {
  return new WorkspaceFileSystemError({
    cwd: input.cwd,
    ...(input.relativePath !== undefined ? { relativePath: input.relativePath } : {}),
    operation: input.operation,
    code: input.code,
    detail: input.detail,
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
  });
}

function errorCodeFromNormalizeWorkspaceRootError(
  cause: WorkspaceRootNotExistsError | WorkspaceRootNotDirectoryError,
): WorkspaceMutationCode {
  return cause._tag === "WorkspaceRootNotExistsError" ? "not_found" : "not_a_directory";
}

async function statIfExists(absolutePath: string): Promise<Stats | null> {
  try {
    return await fsPromises.stat(absolutePath);
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
      return null;
    }
    throw cause;
  }
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;
  const readFileCache = new Map<string, ReadFileCacheEntry>();

  const getCachedReadFileResult = (
    absolutePath: string,
    maxBytes: number,
    sizeBytes: number,
    lastModifiedMs: number,
  ): CachedReadFileResult | null => {
    const cached = readFileCache.get(absolutePath);
    if (
      !cached ||
      cached.maxBytes !== maxBytes ||
      cached.sizeBytes !== sizeBytes ||
      cached.lastModifiedMs !== lastModifiedMs
    ) {
      return null;
    }
    readFileCache.delete(absolutePath);
    readFileCache.set(absolutePath, cached);
    return cached.result;
  };

  const setCachedReadFileResult = (
    absolutePath: string,
    maxBytes: number,
    sizeBytes: number,
    lastModifiedMs: number,
    result: CachedReadFileResult,
  ) => {
    readFileCache.delete(absolutePath);
    readFileCache.set(absolutePath, {
      maxBytes,
      sizeBytes,
      lastModifiedMs,
      result,
    });
    if (readFileCache.size <= READ_FILE_CACHE_MAX_ENTRIES) {
      return;
    }
    const oldestKey = readFileCache.keys().next().value;
    if (oldestKey) {
      readFileCache.delete(oldestKey);
    }
  };

  const invalidateReadFileCachePath = (absolutePath: string) => {
    readFileCache.delete(absolutePath);
  };

  const invalidateReadFileCachePrefix = (absolutePathPrefix: string) => {
    for (const cacheKey of readFileCache.keys()) {
      if (cacheKey === absolutePathPrefix || cacheKey.startsWith(`${absolutePathPrefix}/`)) {
        readFileCache.delete(cacheKey);
      }
    }
  };

  const invalidateWorkspaceEntries = Effect.fn("WorkspaceFileSystem.invalidateWorkspaceEntries")(
    function* (cwd: string) {
      yield* workspaceEntries.invalidate(cwd);
    },
  );

  const resolveWorkspacePath = Effect.fn("WorkspaceFileSystem.resolveWorkspacePath")(
    function* (input: { cwd: string; relativePath?: string }) {
      if (!input.relativePath) {
        const absolutePath = yield* workspacePaths.normalizeWorkspaceRoot(input.cwd).pipe(
          Effect.mapError((cause) =>
            makeWorkspaceError({
              cwd: input.cwd,
              operation: "workspaceFileSystem.resolveWorkspaceRoot",
              code: errorCodeFromNormalizeWorkspaceRootError(cause),
              detail: cause.message,
              cause,
            }),
          ),
        );
        return {
          absolutePath,
          relativePath: undefined,
        };
      }

      const resolved = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      return {
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
      };
    },
  );

  const readBytesAndStat = Effect.fn("WorkspaceFileSystem.readBytesAndStat")(function* (input: {
    cwd: string;
    relativePath: string;
    absolutePath: string;
    operation: string;
  }) {
    const stat = yield* Effect.tryPromise({
      try: async () => fsPromises.stat(input.absolutePath),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: `${input.operation}.stat`,
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    const bytes = yield* Effect.tryPromise({
      try: async () => Uint8Array.from(await fsPromises.readFile(input.absolutePath)),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: input.operation,
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    return { stat, bytes };
  });

  const pathExists: WorkspaceFileSystemShape["pathExists"] = Effect.fn(
    "WorkspaceFileSystem.pathExists",
  )(function* (input) {
    const target = yield* resolveWorkspacePath(input);
    const stat = yield* Effect.tryPromise({
      try: async () => statIfExists(target.absolutePath),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.pathExists",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    if (!stat) {
      return { exists: false };
    }

    return {
      exists: true,
      kind: stat.isDirectory() ? ("directory" as const) : ("file" as const),
    };
  });

  const listDirectory: WorkspaceFileSystemShape["listDirectory"] = Effect.fn(
    "WorkspaceFileSystem.listDirectory",
  )(function* (input) {
    const target = yield* resolveWorkspacePath({
      cwd: input.cwd,
      ...(input.relativePath ? { relativePath: input.relativePath } : {}),
    });

    const stat = yield* Effect.tryPromise({
      try: async () => fsPromises.stat(target.absolutePath),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          ...(input.relativePath ? { relativePath: input.relativePath } : {}),
          operation: "workspaceFileSystem.listDirectory.stat",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    if (!stat.isDirectory()) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        ...(input.relativePath ? { relativePath: input.relativePath } : {}),
        operation: "workspaceFileSystem.listDirectory",
        code: "not_a_directory",
        detail: "Path is not a directory.",
      });
    }

    const entries = yield* Effect.tryPromise({
      try: async () => {
        const dirents = await fsPromises.readdir(target.absolutePath, { withFileTypes: true });
        return dirents
          .filter((entry) => entry.isDirectory() || entry.isFile())
          .map((entry) => {
            const relativePath = target.relativePath
              ? toPosixPath(path.join(target.relativePath, entry.name))
              : entry.name;
            return {
              path: relativePath,
              name: entry.name,
              kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
            };
          })
          .toSorted((left, right) => {
            if (left.kind !== right.kind) {
              return left.kind === "directory" ? -1 : 1;
            }
            return left.name.localeCompare(right.name);
          });
      },
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          ...(input.relativePath ? { relativePath: input.relativePath } : {}),
          operation: "workspaceFileSystem.listDirectory",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    return { entries };
  });

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const target = yield* resolveWorkspacePath({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
      const maxBytes = input.maxBytes ?? DEFAULT_PROJECT_READ_FILE_MAX_BYTES;

      const stat = yield* Effect.tryPromise({
        try: async () => fsPromises.stat(target.absolutePath),
        catch: (cause) =>
          makeWorkspaceError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.readFile.stat",
            code: "not_found",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      if (!stat.isFile()) {
        return yield* makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile",
          code: "is_a_directory",
          detail: "Path is not a file.",
        });
      }

      const sizeBytes = stat.size;
      const lastModifiedMs = lastModifiedMsOf(stat);
      if (sizeBytes > maxBytes) {
        return {
          relativePath: target.relativePath ?? input.relativePath,
          kind: "too_large",
          sizeBytes,
          lastModifiedMs,
          truncated: true,
        };
      }

      const cached = getCachedReadFileResult(
        target.absolutePath,
        maxBytes,
        sizeBytes,
        lastModifiedMs,
      );
      if (cached) {
        return cached;
      }

      const bytes = yield* Effect.tryPromise({
        try: async () => Uint8Array.from(await fsPromises.readFile(target.absolutePath)),
        catch: (cause) =>
          makeWorkspaceError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.readFile",
            code: "not_found",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      if (isBinaryContent(bytes)) {
        const result: CachedReadFileResult = {
          relativePath: target.relativePath ?? input.relativePath,
          kind: "binary" as const,
          sizeBytes,
          lastModifiedMs,
          truncated: false as const,
        };
        setCachedReadFileResult(target.absolutePath, maxBytes, sizeBytes, lastModifiedMs, result);
        return result;
      }

      const contents = Buffer.from(bytes).toString("utf8");
      const result: CachedReadFileResult = {
        relativePath: target.relativePath ?? input.relativePath,
        kind: "text" as const,
        contents,
        encoding: "utf8" as const,
        lineEnding: detectLineEnding(contents),
        versionToken: buildVersionToken(bytes, stat),
        sizeBytes,
        lastModifiedMs,
        truncated: false as const,
      };
      setCachedReadFileResult(target.absolutePath, maxBytes, sizeBytes, lastModifiedMs, result);
      return result;
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const createParents = input.createParents ?? true;
    const overwrite = input.overwrite ?? false;
    const encoding = input.encoding ?? "utf8";
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const parentAbsolutePath = path.dirname(target.absolutePath);
    const existingParentStat = yield* Effect.tryPromise({
      try: async () => statIfExists(parentAbsolutePath),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.writeFile.parentStat",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    if (!createParents && !existingParentStat) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.writeFile",
        code: "not_found",
        detail: "Parent directory does not exist.",
      });
    }

    if (!createParents && existingParentStat && !existingParentStat.isDirectory()) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.writeFile",
        code: "not_a_directory",
        detail: "Parent path is not a directory.",
      });
    }

    if (createParents) {
      yield* Effect.tryPromise({
        try: async () => fsPromises.mkdir(parentAbsolutePath, { recursive: true }),
        catch: (cause) =>
          makeWorkspaceError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile.makeDirectory",
            code: "not_found",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    }

    const existingStat = yield* Effect.tryPromise({
      try: async () => statIfExists(target.absolutePath),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.writeFile.stat",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    if (existingStat && !existingStat.isFile()) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.writeFile",
        code: "is_a_directory",
        detail: "Target path is a directory.",
      });
    }

    if (existingStat && input.expectedVersionToken) {
      const currentBytes = yield* Effect.tryPromise({
        try: async () => Uint8Array.from(await fsPromises.readFile(target.absolutePath)),
        catch: (cause) =>
          makeWorkspaceError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile.readCurrent",
            code: "not_found",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      const currentVersionToken = buildVersionToken(currentBytes, existingStat);
      if (currentVersionToken !== input.expectedVersionToken) {
        return yield* makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.writeFile",
          code: "stale_version",
          detail: `stale_version: expected ${input.expectedVersionToken}, received ${currentVersionToken}`,
        });
      }
    } else if (existingStat && !overwrite) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.writeFile",
        code: "already_exists",
        detail: "Target file already exists.",
      });
    } else if (!existingStat && input.expectedVersionToken) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.writeFile",
        code: "not_found",
        detail: "Cannot apply version-aware write to a missing file.",
      });
    }

    const bytesToWrite =
      encoding === "utf8"
        ? Buffer.from(input.contents, "utf8")
        : encoding === "base64"
          ? Buffer.from(input.contents, "base64")
          : null;

    if (!bytesToWrite) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.writeFile",
        code: "unsupported_encoding",
        detail: `Unsupported encoding: ${String(encoding)}`,
      });
    }

    yield* Effect.tryPromise({
      try: async () => fsPromises.writeFile(target.absolutePath, bytesToWrite),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.writeFile",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    const next = yield* readBytesAndStat({
      cwd: input.cwd,
      relativePath: input.relativePath,
      absolutePath: target.absolutePath,
      operation: "workspaceFileSystem.writeFile.readBack",
    });
    invalidateReadFileCachePath(target.absolutePath);
    yield* invalidateWorkspaceEntries(input.cwd);

    return {
      relativePath: target.relativePath,
      versionToken: buildVersionToken(next.bytes, next.stat),
      lastModifiedMs: lastModifiedMsOf(next.stat),
      created: !existingStat,
    };
  });

  const createDirectory: WorkspaceFileSystemShape["createDirectory"] = Effect.fn(
    "WorkspaceFileSystem.createDirectory",
  )(function* (input) {
    const overwrite = input.overwrite ?? false;
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    const existingStat = yield* Effect.tryPromise({
      try: async () => statIfExists(target.absolutePath),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.createDirectory.stat",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    if (existingStat) {
      if (existingStat.isDirectory() && overwrite) {
        return {
          relativePath: target.relativePath,
          created: false,
        };
      }

      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.createDirectory",
        code: "already_exists",
        detail: "Target path already exists.",
      });
    }

    yield* Effect.tryPromise({
      try: async () => fsPromises.mkdir(target.absolutePath, { recursive: true }),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.createDirectory",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    yield* invalidateWorkspaceEntries(input.cwd);

    return {
      relativePath: target.relativePath,
      created: true,
    };
  });

  const deleteEntry: WorkspaceFileSystemShape["deleteEntry"] = Effect.fn(
    "WorkspaceFileSystem.deleteEntry",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const existingStat = yield* Effect.tryPromise({
      try: async () => statIfExists(target.absolutePath),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.deleteEntry.stat",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    if (!existingStat) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.deleteEntry",
        code: "not_found",
        detail: "Target path does not exist.",
      });
    }

    if (input.expectedKind === "directory" && !existingStat.isDirectory()) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.deleteEntry",
        code: "not_a_directory",
        detail: "Expected a directory.",
      });
    }
    if (input.expectedKind === "file" && !existingStat.isFile()) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.deleteEntry",
        code: "is_a_directory",
        detail: "Expected a file.",
      });
    }

    yield* Effect.tryPromise({
      try: async () => {
        if (existingStat.isDirectory()) {
          if (input.recursive) {
            await fsPromises.rm(target.absolutePath, { recursive: true, force: false });
            return;
          }
          await fsPromises.rmdir(target.absolutePath);
          return;
        }
        await fsPromises.unlink(target.absolutePath);
      },
      catch: (cause) => {
        const code =
          cause && typeof cause === "object" && "code" in cause && cause.code === "ENOTEMPTY"
            ? "directory_not_empty"
            : "not_found";
        return makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.deleteEntry",
          code,
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        });
      },
    });

    if (existingStat.isDirectory()) {
      invalidateReadFileCachePrefix(target.absolutePath);
    } else {
      invalidateReadFileCachePath(target.absolutePath);
    }
    yield* invalidateWorkspaceEntries(input.cwd);
    return { relativePath: target.relativePath };
  });

  const moveEntry: WorkspaceFileSystemShape["moveEntry"] = Effect.fn(
    "WorkspaceFileSystem.moveEntry",
  )(function* (input) {
    const source = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.sourceRelativePath,
    });
    const destination = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.destinationRelativePath,
    });

    if (source.relativePath === destination.relativePath) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.sourceRelativePath,
        operation: "workspaceFileSystem.moveEntry",
        code: "invalid_move",
        detail: "invalid_move: source and destination are identical.",
      });
    }

    const sourceStat = yield* Effect.tryPromise({
      try: async () => statIfExists(source.absolutePath),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.sourceRelativePath,
          operation: "workspaceFileSystem.moveEntry.sourceStat",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    if (!sourceStat) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.sourceRelativePath,
        operation: "workspaceFileSystem.moveEntry",
        code: "not_found",
        detail: "Source path does not exist.",
      });
    }

    if (
      sourceStat.isDirectory() &&
      (destination.relativePath === source.relativePath ||
        destination.relativePath.startsWith(`${source.relativePath}/`))
    ) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.sourceRelativePath,
        operation: "workspaceFileSystem.moveEntry",
        code: "invalid_move",
        detail: `invalid_move: cannot move ${source.relativePath} into ${destination.relativePath}.`,
      });
    }

    const destinationStat = yield* Effect.tryPromise({
      try: async () => statIfExists(destination.absolutePath),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.destinationRelativePath,
          operation: "workspaceFileSystem.moveEntry.destinationStat",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    if (destinationStat) {
      return yield* makeWorkspaceError({
        cwd: input.cwd,
        relativePath: input.destinationRelativePath,
        operation: "workspaceFileSystem.moveEntry",
        code: "already_exists",
        detail: "Destination path already exists.",
      });
    }

    yield* Effect.tryPromise({
      try: async () =>
        fsPromises.mkdir(path.dirname(destination.absolutePath), { recursive: true }),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.destinationRelativePath,
          operation: "workspaceFileSystem.moveEntry.makeDirectory",
          code: "not_found",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    yield* Effect.tryPromise({
      try: async () => fsPromises.rename(source.absolutePath, destination.absolutePath),
      catch: (cause) =>
        makeWorkspaceError({
          cwd: input.cwd,
          relativePath: input.sourceRelativePath,
          operation: "workspaceFileSystem.moveEntry.rename",
          code: "invalid_move",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    if (sourceStat.isDirectory()) {
      invalidateReadFileCachePrefix(source.absolutePath);
      invalidateReadFileCachePrefix(destination.absolutePath);
    } else {
      invalidateReadFileCachePath(source.absolutePath);
      invalidateReadFileCachePath(destination.absolutePath);
    }
    yield* invalidateWorkspaceEntries(input.cwd);
    return {
      sourceRelativePath: source.relativePath,
      destinationRelativePath: destination.relativePath,
    };
  });

  return {
    pathExists,
    listDirectory,
    readFile,
    writeFile,
    createDirectory,
    deleteEntry,
    moveEntry,
  } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
