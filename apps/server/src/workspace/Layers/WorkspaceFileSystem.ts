import fsPromises from "node:fs/promises";
import { Buffer } from "node:buffer";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

const DEFAULT_PROJECT_READ_FILE_MAX_BYTES = 256 * 1024;

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

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  const resolveWorkspacePath = Effect.fn("WorkspaceFileSystem.resolveWorkspacePath")(
    function* (input: { cwd: string; relativePath?: string }) {
      if (!input.relativePath) {
        const absolutePath = yield* workspacePaths.normalizeWorkspaceRoot(input.cwd).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                operation: "workspaceFileSystem.resolveWorkspaceRoot",
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
        new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.listDirectory.stat",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    if (!stat.isDirectory()) {
      return yield* new WorkspaceFileSystemError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFileSystem.listDirectory",
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
        new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.listDirectory",
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
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.readFile.stat",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      if (!stat.isFile()) {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile",
          detail: "Path is not a file.",
        });
      }

      const sizeBytes = stat.size;
      if (sizeBytes > maxBytes) {
        return {
          relativePath: target.relativePath ?? input.relativePath,
          kind: "too_large",
          sizeBytes,
          truncated: true,
        };
      }

      const bytes = yield* Effect.tryPromise({
        try: async () => Uint8Array.from(await fsPromises.readFile(target.absolutePath)),
        catch: (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.readFile",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      if (isBinaryContent(bytes)) {
        return {
          relativePath: target.relativePath ?? input.relativePath,
          kind: "binary",
          sizeBytes,
          truncated: false,
        };
      }

      return {
        relativePath: target.relativePath ?? input.relativePath,
        kind: "text",
        contents: Buffer.from(bytes).toString("utf8"),
        sizeBytes,
        truncated: false,
      };
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });
  return { listDirectory, readFile, writeFile } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
