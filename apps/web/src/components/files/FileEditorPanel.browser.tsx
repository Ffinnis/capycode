import "../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { FileEditorPanel } from "./FileEditorPanel";
import {
  __resetWorkspaceEditorStoreForTests,
  useWorkspaceEditorStore,
} from "~/workspaceEditorStore";

const writeFileMock = vi.fn(async () => ({
  relativePath: "src/app.ts",
  versionToken: "next-version",
  lastModifiedMs: Date.now(),
  created: false,
}));
let queryClient: QueryClient;

vi.mock("~/hooks/useSettings", () => ({
  useSettings: vi.fn((selector?: (settings: { fileEditorAutoSave: boolean }) => unknown) => {
    const settings = { fileEditorAutoSave: false };
    return selector ? selector(settings) : settings;
  }),
}));

vi.mock("~/hooks/useWorkspaceFileMutations", () => ({
  useWorkspaceFileMutations: vi.fn(() => ({
    writeFile: writeFileMock,
  })),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: vi.fn(() => ({
    contextMenu: { show: vi.fn(async () => "cancel") },
  })),
  readLocalApi: vi.fn(() => null),
}));

vi.mock("~/editorPreferences", () => ({
  openInPreferredEditor: vi.fn(async () => undefined),
}));

describe("FileEditorPanel", () => {
  beforeEach(() => {
    __resetWorkspaceEditorStoreForTests();
    writeFileMock.mockClear();
    queryClient = new QueryClient();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    __resetWorkspaceEditorStoreForTests();
  });

  it("does not loop when a dirty buffer sees a newer server version", async () => {
    useWorkspaceEditorStore.getState().loadBuffer("scope", "src/app.ts", {
      contents: "changed\n",
      savedContents: "original\n",
      versionToken: "local-version",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: new Date().toISOString(),
      lastSavedAt: null,
    });

    await render(
      <QueryClientProvider client={queryClient}>
        <FileEditorPanel
          environmentId={null}
          cwd={null}
          scopeKey="scope"
          relativePath="src/app.ts"
          readResult={{
            kind: "text",
            contents: "server\n",
            versionToken: "server-version",
            lineEnding: "lf",
            lastModifiedMs: Date.now(),
          }}
        />
      </QueryClientProvider>,
    );

    await expect.element(page.getByText(/File changed on disk/i)).toBeVisible();
  });

  it("saves on Mod+S from a document key event", async () => {
    useWorkspaceEditorStore.getState().loadBuffer("scope", "src/app.ts", {
      contents: "draft\n",
      savedContents: "saved\n",
      versionToken: "local-version",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: new Date().toISOString(),
      lastSavedAt: null,
    });

    await render(
      <QueryClientProvider client={queryClient}>
        <FileEditorPanel
          environmentId={"env-test" as never}
          cwd="/workspace"
          scopeKey="scope"
          relativePath="src/app.ts"
          readResult={{
            kind: "text",
            contents: "saved\n",
            versionToken: "local-version",
            lineEnding: "lf",
            lastModifiedMs: Date.now(),
          }}
        />
      </QueryClientProvider>,
    );

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        metaKey: true,
        bubbles: true,
      }),
    );

    await vi.waitFor(() => {
      expect(writeFileMock).toHaveBeenCalledTimes(1);
    });

    expect(
      useWorkspaceEditorStore.getState().scopes.scope?.buffersByPath["src/app.ts"]?.versionToken,
    ).toBe("next-version");
  });

  it("keeps the same editor view mounted when buffer contents change", async () => {
    useWorkspaceEditorStore.getState().loadBuffer("scope", "src/app.ts", {
      contents: "draft\n",
      savedContents: "draft\n",
      versionToken: "local-version",
      encoding: "utf8",
      lineEnding: "lf",
      lastLoadedAt: new Date().toISOString(),
      lastSavedAt: null,
    });

    await render(
      <QueryClientProvider client={queryClient}>
        <FileEditorPanel
          environmentId={"env-test" as never}
          cwd="/workspace"
          scopeKey="scope"
          relativePath="src/app.ts"
          readResult={{
            kind: "text",
            contents: "draft\n",
            versionToken: "local-version",
            lineEnding: "lf",
            lastModifiedMs: Date.now(),
          }}
        />
      </QueryClientProvider>,
    );

    await vi.waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const editorBefore = document.querySelector(".cm-editor");
    const contentBefore = document.querySelector<HTMLElement>(".cm-content");
    contentBefore?.focus();

    useWorkspaceEditorStore.getState().updateBufferContents("scope", "src/app.ts", "draft x\n");

    await vi.waitFor(() => {
      expect(
        useWorkspaceEditorStore.getState().scopes.scope?.buffersByPath["src/app.ts"]?.contents,
      ).toBe("draft x\n");
    });

    expect(document.querySelector(".cm-editor")).toBe(editorBefore);
    expect(document.activeElement?.closest(".cm-editor")).toBe(editorBefore);
  });
});
