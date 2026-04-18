import { beforeEach, describe, expect, it } from "vitest";
import * as workspaceEditorStoreModule from "./workspaceEditorStore";

import {
  __resetWorkspaceEditorStoreForTests,
  createWorkspaceOpenFileTabStatusSelector,
  getWorkspaceEditorBuffer,
  hasDirtyWorkspaceBuffersForScope,
  hasAnyDirtyWorkspaceBuffers,
  useWorkspaceEditorStore,
} from "./workspaceEditorStore";

const SCOPE = "env:thread:cwd:/repo";

describe("workspaceEditorStore", () => {
  beforeEach(() => {
    __resetWorkspaceEditorStoreForTests();
  });

  it("loads and updates editable buffers", () => {
    const store = useWorkspaceEditorStore.getState();
    store.loadBuffer(SCOPE, "src/app.ts", {
      contents: "export const value = 1;\n",
      savedContents: "export const value = 1;\n",
      versionToken: "sha256:one",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: "2026-04-17T00:00:00.000Z",
      lastSavedAt: null,
    });
    store.updateBufferContents(SCOPE, "src/app.ts", "export const value = 2;\n");

    const buffer = getWorkspaceEditorBuffer(
      useWorkspaceEditorStore.getState(),
      SCOPE,
      "src/app.ts",
    );
    expect(buffer?.contents).toBe("export const value = 2;\n");
    expect(buffer?.isDirty).toBe(true);
  });

  it("marks save progress and clears dirty state after save", () => {
    const store = useWorkspaceEditorStore.getState();
    store.loadBuffer(SCOPE, "src/app.ts", {
      contents: "export const value = 1;\n",
      savedContents: "export const value = 1;\n",
      versionToken: "sha256:one",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: "2026-04-17T00:00:00.000Z",
      lastSavedAt: null,
    });
    store.updateBufferContents(SCOPE, "src/app.ts", "export const value = 2;\n");
    store.markSaving(SCOPE, "src/app.ts", true);
    store.markSaveSucceeded(SCOPE, "src/app.ts", {
      contents: "export const value = 2;\n",
      versionToken: "sha256:two",
      lastSavedAt: "2026-04-17T00:00:01.000Z",
    });

    const buffer = getWorkspaceEditorBuffer(
      useWorkspaceEditorStore.getState(),
      SCOPE,
      "src/app.ts",
    );
    expect(buffer?.isSaving).toBe(false);
    expect(buffer?.isDirty).toBe(false);
    expect(buffer?.versionToken).toBe("sha256:two");
    expect(buffer?.savedContents).toBe("export const value = 2;\n");
  });

  it("tracks save errors and pending external conflicts", () => {
    const store = useWorkspaceEditorStore.getState();
    store.loadBuffer(SCOPE, "src/app.ts", {
      contents: "export const value = 1;\n",
      savedContents: "export const value = 1;\n",
      versionToken: "sha256:one",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: "2026-04-17T00:00:00.000Z",
      lastSavedAt: null,
    });

    store.markSaveFailed(SCOPE, "src/app.ts", "stale_version");
    store.setPendingExternalConflict(SCOPE, "src/app.ts", true);

    const buffer = getWorkspaceEditorBuffer(
      useWorkspaceEditorStore.getState(),
      SCOPE,
      "src/app.ts",
    );
    expect(buffer?.saveError).toBe("stale_version");
    expect(buffer?.pendingExternalConflict).toBe(true);
  });

  it("renames and removes buffers", () => {
    const store = useWorkspaceEditorStore.getState();
    store.loadBuffer(SCOPE, "src/app.ts", {
      contents: "export const value = 1;\n",
      savedContents: "export const value = 1;\n",
      versionToken: "sha256:one",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: "2026-04-17T00:00:00.000Z",
      lastSavedAt: null,
    });

    store.renameBuffer(SCOPE, "src/app.ts", "src/renamed.ts");
    expect(
      getWorkspaceEditorBuffer(useWorkspaceEditorStore.getState(), SCOPE, "src/app.ts"),
    ).toBeUndefined();
    expect(
      getWorkspaceEditorBuffer(useWorkspaceEditorStore.getState(), SCOPE, "src/renamed.ts")
        ?.contents,
    ).toContain("value");

    store.removeBuffer(SCOPE, "src/renamed.ts");
    expect(
      getWorkspaceEditorBuffer(useWorkspaceEditorStore.getState(), SCOPE, "src/renamed.ts"),
    ).toBeUndefined();
  });

  it("reports dirty buffers across scopes", () => {
    const store = useWorkspaceEditorStore.getState();
    store.loadBuffer(SCOPE, "src/app.ts", {
      contents: "export const value = 1;\n",
      savedContents: "export const value = 1;\n",
      versionToken: "sha256:one",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: "2026-04-17T00:00:00.000Z",
      lastSavedAt: null,
    });
    store.updateBufferContents(SCOPE, "src/app.ts", "export const value = 2;\n");

    expect(hasAnyDirtyWorkspaceBuffers(useWorkspaceEditorStore.getState())).toBe(true);

    store.markSaveSucceeded(SCOPE, "src/app.ts", {
      contents: "export const value = 2;\n",
      versionToken: "sha256:two",
      lastSavedAt: "2026-04-17T00:00:01.000Z",
    });

    expect(hasAnyDirtyWorkspaceBuffers(useWorkspaceEditorStore.getState())).toBe(false);
  });

  it("returns a stable empty buffers snapshot for missing scopes", () => {
    const getWorkspaceEditorBuffersByScopeKey = (
      workspaceEditorStoreModule as Record<string, unknown>
    ).getWorkspaceEditorBuffersByScopeKey;

    expect(typeof getWorkspaceEditorBuffersByScopeKey).toBe("function");
    if (typeof getWorkspaceEditorBuffersByScopeKey !== "function") {
      return;
    }

    const state = useWorkspaceEditorStore.getState();
    const first = getWorkspaceEditorBuffersByScopeKey(state, "missing-scope");
    const second = getWorkspaceEditorBuffersByScopeKey(state, "missing-scope");
    const empty = getWorkspaceEditorBuffersByScopeKey(state, null);

    expect(first).toBe(second);
    expect(second).toBe(empty);
    expect(first).toEqual({});
  });

  it("returns stable open-tab status for unrelated buffer updates", () => {
    const store = useWorkspaceEditorStore.getState();
    store.loadBuffer(SCOPE, "src/app.ts", {
      contents: "export const value = 1;\n",
      savedContents: "export const value = 1;\n",
      versionToken: "sha256:one",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: "2026-04-17T00:00:00.000Z",
      lastSavedAt: null,
    });
    store.loadBuffer(SCOPE, "src/other.ts", {
      contents: "export const other = 1;\n",
      savedContents: "export const other = 1;\n",
      versionToken: "sha256:other",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: "2026-04-17T00:00:00.000Z",
      lastSavedAt: null,
    });
    store.updateBufferContents(SCOPE, "src/app.ts", "export const value = 2;\n");

    const selectOpenFileTabStatus = createWorkspaceOpenFileTabStatusSelector(SCOPE, ["src/app.ts"]);

    const first = selectOpenFileTabStatus(useWorkspaceEditorStore.getState());
    store.updateBufferContents(SCOPE, "src/other.ts", "export const other = 2;\n");
    const second = selectOpenFileTabStatus(useWorkspaceEditorStore.getState());

    expect(first).toBe(second);
    expect(second.dirtyFileTabs).toEqual(["src/app.ts"]);
    expect(second.savingFileTabs).toEqual([]);
  });

  it("reports dirty buffers per scope", () => {
    const otherScope = "env:thread:cwd:/other";
    const store = useWorkspaceEditorStore.getState();
    store.loadBuffer(SCOPE, "src/app.ts", {
      contents: "export const value = 1;\n",
      savedContents: "export const value = 1;\n",
      versionToken: "sha256:one",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: "2026-04-17T00:00:00.000Z",
      lastSavedAt: null,
    });
    store.loadBuffer(otherScope, "src/other.ts", {
      contents: "export const other = 1;\n",
      savedContents: "export const other = 1;\n",
      versionToken: "sha256:other",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: "2026-04-17T00:00:00.000Z",
      lastSavedAt: null,
    });
    store.updateBufferContents(otherScope, "src/other.ts", "export const other = 2;\n");

    expect(hasDirtyWorkspaceBuffersForScope(useWorkspaceEditorStore.getState(), SCOPE)).toBe(false);
    expect(hasDirtyWorkspaceBuffersForScope(useWorkspaceEditorStore.getState(), otherScope)).toBe(
      true,
    );
  });
});
