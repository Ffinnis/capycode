import { describe, expect, it } from "vitest";

import {
  canUseBufferForEditorPreview,
  getEditorReadResultFromPreviewState,
} from "./FilePreviewPanel";
import type { WorkspaceEditorBufferState } from "~/workspaceEditorStore";

function createBuffer(
  overrides: Partial<WorkspaceEditorBufferState> = {},
): WorkspaceEditorBufferState {
  return {
    contents: "draft",
    savedContents: "draft",
    versionToken: "buffer-version",
    encoding: "utf8",
    lineEnding: "lf",
    isDirty: false,
    isSaving: false,
    saveError: null,
    lastLoadedAt: "2026-04-18T10:00:00.000Z",
    lastSavedAt: null,
    pendingExternalConflict: false,
    ...overrides,
  };
}

describe("FilePreviewPanel editor state selection", () => {
  it("uses a stable local buffer for the editor preview", () => {
    const editorReadResult = getEditorReadResultFromPreviewState(createBuffer(), {
      kind: "text",
      contents: "server",
      versionToken: "server-version",
      lineEnding: "crlf",
      lastModifiedMs: 123,
    });

    expect(editorReadResult).toMatchObject({
      kind: "text",
      contents: "draft",
      versionToken: "buffer-version",
      lineEnding: "lf",
    });
  });

  it("falls back to the last stable server read while the buffer is saving", () => {
    const editorReadResult = getEditorReadResultFromPreviewState(createBuffer({ isSaving: true }), {
      kind: "text",
      contents: "server",
      versionToken: "server-version",
      lineEnding: "crlf",
      lastModifiedMs: 123,
    });

    expect(editorReadResult).toEqual({
      kind: "text",
      contents: "server",
      versionToken: "server-version",
      lineEnding: "crlf",
      lastModifiedMs: 123,
    });
  });

  it("does not use an unstable conflicted buffer without a stable server read", () => {
    expect(canUseBufferForEditorPreview(createBuffer({ pendingExternalConflict: true }))).toBe(
      false,
    );
    expect(
      getEditorReadResultFromPreviewState(
        createBuffer({ pendingExternalConflict: true }),
        undefined,
      ),
    ).toBeNull();
  });
});
