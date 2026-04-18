import "../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { FilePreviewPanel } from "./FilePreviewPanel";
import {
  __resetWorkspaceEditorStoreForTests,
  useWorkspaceEditorStore,
} from "~/workspaceEditorStore";

vi.mock("~/localApi", () => ({
  ensureLocalApi: vi.fn(() => ({
    contextMenu: { show: vi.fn(async () => "cancel") },
  })),
  readLocalApi: vi.fn(() => null),
}));

vi.mock("~/editorPreferences", () => ({
  openInPreferredEditor: vi.fn(async () => undefined),
}));

describe("FilePreviewPanel", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    __resetWorkspaceEditorStoreForTests();
    queryClient = new QueryClient();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    __resetWorkspaceEditorStoreForTests();
  });

  it("renders immediately from the local editor buffer when available", async () => {
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
        <FilePreviewPanel
          environmentId={null}
          cwd={null}
          scopeKey="scope"
          relativePath="src/app.ts"
        />
      </QueryClientProvider>,
    );

    await expect.element(page.getByText("Save")).toBeInTheDocument();
    await expect.element(page.getByText("Loading file preview...")).not.toBeInTheDocument();
  });
});
