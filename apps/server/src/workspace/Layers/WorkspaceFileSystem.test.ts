import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import fsPromises from "node:fs/promises";
import { vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntriesLive } from "./WorkspaceEntries.ts";
import { WorkspaceFileSystemLive } from "./WorkspaceFileSystem.ts";
import { WorkspacePathsLive } from "./WorkspacePaths.ts";

const ProjectLayer = WorkspaceFileSystemLive.pipe(
  Layer.provide(WorkspacePathsLive),
  Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-workspace-files-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "capycode-workspace-files-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

it.layer(TestLayer)("WorkspaceFileSystemLive", (it) => {
  describe("listDirectory", () => {
    it.effect("lists direct children with directories first", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "z-last.ts", "export const z = true;\n");
        yield* writeTextFile(cwd, "src/alpha.ts", "export const alpha = true;\n");
        yield* writeTextFile(cwd, "src/nested/beta.ts", "export const beta = true;\n");

        const result = yield* workspaceFileSystem.listDirectory({ cwd });

        expect(result.entries).toEqual([
          { path: "src", name: "src", kind: "directory" },
          { path: "z-last.ts", name: "z-last.ts", kind: "file" },
        ]);
      }),
    );

    it.effect("rejects traversal outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;

        const error = yield* workspaceFileSystem
          .listDirectory({
            cwd,
            relativePath: "../escape",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape",
        );
      }),
    );
  });

  describe("readFile", () => {
    it.effect("returns text previews for UTF-8 files", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/preview.ts", "export const preview = true;\r\n");

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "src/preview.ts",
        });

        expect(result.kind).toBe("text");
        expect(result.relativePath).toBe("src/preview.ts");
        expect(result.contents).toBe("export const preview = true;\r\n");
        expect(result.encoding).toBe("utf8");
        expect(result.lineEnding).toBe("crlf");
        expect(result.versionToken).toMatch(/^sha256:/);
        expect(result.sizeBytes).toBe(30);
        expect(result.lastModifiedMs).toBeGreaterThan(0);
        expect(result.truncated).toBe(false);
      }),
    );

    it.effect("classifies binary files without returning contents", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem
          .makeDirectory(path.join(cwd, "assets"), { recursive: true })
          .pipe(Effect.orDie);
        yield* fileSystem
          .writeFile(path.join(cwd, "assets", "logo.bin"), Uint8Array.from([0, 255, 10]))
          .pipe(Effect.orDie);

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "assets/logo.bin",
        });

        expect(result).toEqual({
          relativePath: "assets/logo.bin",
          kind: "binary",
          sizeBytes: 3,
          lastModifiedMs: expect.any(Number),
          truncated: false,
        });
      }),
    );

    it.effect("marks files above the preview cap as too_large", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "logs/big.log", "0123456789");

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "logs/big.log",
          maxBytes: 5,
        });

        expect(result).toEqual({
          relativePath: "logs/big.log",
          kind: "too_large",
          sizeBytes: 10,
          lastModifiedMs: expect.any(Number),
          truncated: true,
        });
      }),
    );

    it.effect("reuses cached preview results for repeated reads of unchanged files", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/cached.ts", "export const cached = true;\n");
        const readFileSpy = vi.spyOn(fsPromises, "readFile");

        try {
          const first = yield* workspaceFileSystem.readFile({
            cwd,
            relativePath: "src/cached.ts",
          });
          const second = yield* workspaceFileSystem.readFile({
            cwd,
            relativePath: "src/cached.ts",
          });

          expect(first.kind).toBe("text");
          expect(second.kind).toBe("text");
          expect(readFileSpy).toHaveBeenCalledTimes(1);
        } finally {
          readFileSpy.mockRestore();
        }
      }),
    );
  });

  describe("writeFile", () => {
    it.effect("writes files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });
        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "plans/effect-rpc.md"))
          .pipe(Effect.orDie);

        expect(result.relativePath).toBe("plans/effect-rpc.md");
        expect(result.versionToken).toMatch(/^sha256:/);
        expect(result.lastModifiedMs).toBeGreaterThan(0);
        expect(result.created).toBe(true);
        expect(saved).toBe("# Plan\n");
      }),
    );

    it.effect("supports binary uploads with base64 encoding", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;

        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "assets/logo.bin",
          contents: Buffer.from([0, 1, 255, 10]).toString("base64"),
          encoding: "base64",
        });

        const saved = yield* fileSystem
          .readFile(path.join(cwd, "assets/logo.bin"))
          .pipe(Effect.orDie);

        expect(result.created).toBe(true);
        expect(Array.from(saved)).toEqual([0, 1, 255, 10]);
      }),
    );

    it.effect("rejects stale version writes", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/plan.md", "one\n");

        const initial = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "src/plan.md",
        });
        if (initial.kind !== "text" || !initial.versionToken) {
          throw new Error("Expected text file with version token.");
        }

        yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "src/plan.md",
          contents: "two\n",
          expectedVersionToken: initial.versionToken,
        });

        const error = yield* workspaceFileSystem
          .writeFile({
            cwd,
            relativePath: "src/plan.md",
            contents: "three\n",
            expectedVersionToken: initial.versionToken,
          })
          .pipe(Effect.flip);

        expect("detail" in error ? error.detail : error.message).toContain("stale_version");
      }),
    );

    it.effect("invalidates workspace entry search cache after writes", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "export {};\n");

        const beforeWrite = yield* workspaceEntries.search({
          cwd,
          query: "rpc",
          limit: 10,
        });
        expect(beforeWrite).toEqual({
          entries: [],
          truncated: false,
        });

        yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });

        const afterWrite = yield* workspaceEntries.search({
          cwd,
          query: "rpc",
          limit: 10,
        });
        expect(afterWrite.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "plans/effect-rpc.md" })]),
        );
        expect(afterWrite.truncated).toBe(false);
      }),
    );

    it.effect("rejects writes outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;

        const error = yield* workspaceFileSystem
          .writeFile({
            cwd,
            relativePath: "../escape.md",
            contents: "# nope\n",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );

        const escapedPath = path.resolve(cwd, "..", "escape.md");
        const escapedStat = yield* fileSystem
          .stat(escapedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        expect(escapedStat).toBeNull();
      }),
    );
  });

  describe("createDirectory", () => {
    it.effect("creates directories relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;

        const result = yield* workspaceFileSystem.createDirectory({
          cwd,
          relativePath: "src/components",
        });
        const stat = yield* fileSystem.stat(path.join(cwd, "src", "components")).pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "src/components", created: true });
        expect(stat.type).toBe("Directory");
      }),
    );
  });

  describe("moveEntry", () => {
    it.effect("moves files within the workspace", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/old.ts", "export const oldValue = true;\n");

        const result = yield* workspaceFileSystem.moveEntry({
          cwd,
          sourceRelativePath: "src/old.ts",
          destinationRelativePath: "src/new.ts",
        });

        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "src", "new.ts"))
          .pipe(Effect.orDie);
        const sourceStat = yield* fileSystem
          .stat(path.join(cwd, "src", "old.ts"))
          .pipe(Effect.catch(() => Effect.succeed(null)));

        expect(result).toEqual({
          sourceRelativePath: "src/old.ts",
          destinationRelativePath: "src/new.ts",
        });
        expect(saved).toContain("oldValue");
        expect(sourceStat).toBeNull();
      }),
    );

    it.effect("rejects moving a directory into its own descendant", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/nested/file.ts", "export {};\n");

        const error = yield* workspaceFileSystem
          .moveEntry({
            cwd,
            sourceRelativePath: "src",
            destinationRelativePath: "src/nested/src",
          })
          .pipe(Effect.flip);

        expect("detail" in error ? error.detail : error.message).toContain("invalid_move");
      }),
    );

    it.effect("does not remove the destination when a move collides", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/source.ts", "export const source = true;\n");
        yield* writeTextFile(cwd, "src/destination.ts", "export const destination = true;\n");

        const error = yield* workspaceFileSystem
          .moveEntry({
            cwd,
            sourceRelativePath: "src/source.ts",
            destinationRelativePath: "src/destination.ts",
            overwrite: true,
          })
          .pipe(Effect.flip);

        const sourceContents = yield* fileSystem
          .readFileString(path.join(cwd, "src", "source.ts"))
          .pipe(Effect.orDie);
        const destinationContents = yield* fileSystem
          .readFileString(path.join(cwd, "src", "destination.ts"))
          .pipe(Effect.orDie);

        expect("detail" in error ? error.detail : error.message).toContain("already exists");
        expect(sourceContents).toContain("source");
        expect(destinationContents).toContain("destination");
      }),
    );
  });

  describe("deleteEntry", () => {
    it.effect("deletes directories recursively", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/nested/file.ts", "export {};\n");

        const result = yield* workspaceFileSystem.deleteEntry({
          cwd,
          relativePath: "src",
          recursive: true,
          expectedKind: "directory",
        });
        const stat = yield* fileSystem
          .stat(path.join(cwd, "src"))
          .pipe(Effect.catch(() => Effect.succeed(null)));

        expect(result).toEqual({ relativePath: "src" });
        expect(stat).toBeNull();
      }),
    );
  });
});
