import { describe, expect, it } from "vitest";

import {
  isBlockingWorkspaceFileTreeRootLoad,
  removeDirectoryEntriesCache,
  renameDirectoryEntriesCache,
} from "./useWorkspaceFileTree";

describe("useWorkspaceFileTree cache helpers", () => {
  it("renames cached directory subtrees", () => {
    const cache = {
      "": [{ path: "src", name: "src", kind: "directory" as const }],
      src: [
        { path: "src/app.ts", name: "app.ts", kind: "file" as const },
        { path: "src/nested", name: "nested", kind: "directory" as const },
      ],
      "src/nested": [{ path: "src/nested/file.ts", name: "file.ts", kind: "file" as const }],
    };

    expect(renameDirectoryEntriesCache(cache, "src", "renamed")).toEqual({
      "": [{ path: "renamed", name: "renamed", kind: "directory" }],
      renamed: [
        { path: "renamed/app.ts", name: "app.ts", kind: "file" },
        { path: "renamed/nested", name: "nested", kind: "directory" },
      ],
      "renamed/nested": [{ path: "renamed/nested/file.ts", name: "file.ts", kind: "file" }],
    });
  });

  it("removes cached directory subtrees", () => {
    const cache = {
      "": [
        { path: "src", name: "src", kind: "directory" as const },
        { path: "docs", name: "docs", kind: "directory" as const },
      ],
      src: [{ path: "src/app.ts", name: "app.ts", kind: "file" as const }],
      docs: [{ path: "docs/readme.md", name: "readme.md", kind: "file" as const }],
    };

    expect(removeDirectoryEntriesCache(cache, "src")).toEqual({
      "": [{ path: "docs", name: "docs", kind: "directory" }],
      docs: [{ path: "docs/readme.md", name: "readme.md", kind: "file" }],
    });
  });

  it("only blocks the root tree during the first load", () => {
    expect(
      isBlockingWorkspaceFileTreeRootLoad({
        isLoading: true,
        rootData: undefined,
        cachedRootData: undefined,
      }),
    ).toBe(true);

    expect(
      isBlockingWorkspaceFileTreeRootLoad({
        isLoading: true,
        rootData: [],
        cachedRootData: undefined,
      }),
    ).toBe(false);

    expect(
      isBlockingWorkspaceFileTreeRootLoad({
        isLoading: true,
        rootData: undefined,
        cachedRootData: [],
      }),
    ).toBe(false);

    expect(
      isBlockingWorkspaceFileTreeRootLoad({
        isLoading: false,
        rootData: undefined,
        cachedRootData: undefined,
      }),
    ).toBe(false);
  });
});
