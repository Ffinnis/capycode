import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetWorkspaceDockStoreForTests,
  getWorkspaceDockScopeKey,
  getWorkspaceDockScopeState,
  resolveWorkspaceDockScopeId,
  WORKSPACE_TERMINAL_TAB_ID,
  useWorkspaceDockStore,
} from "./workspaceDockStore";

const SCOPE = getWorkspaceDockScopeKey({
  environmentId: "env-1",
  threadId: "thread-1",
  cwd: "/repo",
});

describe("workspaceDockStore", () => {
  beforeEach(() => {
    __resetWorkspaceDockStoreForTests();
  });

  it("opens files and selects them as active tabs", () => {
    useWorkspaceDockStore.getState().openFile(SCOPE, "src/app.ts");

    const scope = getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), SCOPE);
    expect(scope.filesOpen).toBe(true);
    expect(scope.openFileTabs).toEqual(["src/app.ts"]);
    expect(scope.activeTab).toBe("src/app.ts");
    expect(scope.activeContext).toBe("file");
  });

  it("switches back to chat without dropping open tabs", () => {
    const store = useWorkspaceDockStore.getState();
    store.openFile(SCOPE, "src/app.ts");
    store.selectChatTab(SCOPE);

    const scope = getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), SCOPE);
    expect(scope.openFileTabs).toEqual(["src/app.ts"]);
    expect(scope.activeTab).toBe("chat");
  });

  it("closes the active tab and falls back to the previous tab", () => {
    const store = useWorkspaceDockStore.getState();
    store.openFile(SCOPE, "src/app.ts");
    store.openFile(SCOPE, "src/other.ts");
    store.closeFileTab(SCOPE, "src/other.ts");

    const scope = getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), SCOPE);
    expect(scope.openFileTabs).toEqual(["src/app.ts"]);
    expect(scope.activeTab).toBe("src/app.ts");
  });

  it("renames open file tabs and preserves active selection", () => {
    const store = useWorkspaceDockStore.getState();
    store.openFile(SCOPE, "src/app.ts");
    store.renameFileTab(SCOPE, "src/app.ts", "src/renamed.ts");

    const scope = getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), SCOPE);
    expect(scope.openFileTabs).toEqual(["src/renamed.ts"]);
    expect(scope.activeTab).toBe("src/renamed.ts");
    expect(scope.revealedFilePath).toBe("src/renamed.ts");
  });

  it("keeps scopes isolated by cwd", () => {
    const otherScope = getWorkspaceDockScopeKey({
      environmentId: "env-1",
      threadId: "thread-1",
      cwd: "/other",
    });
    const store = useWorkspaceDockStore.getState();
    store.openFile(SCOPE, "src/app.ts");
    store.openFile(otherScope, "main.go");

    expect(
      getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), SCOPE).openFileTabs,
    ).toEqual(["src/app.ts"]);
    expect(
      getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), otherScope).openFileTabs,
    ).toEqual(["main.go"]);
  });

  it("keeps scopes isolated by workspace id even when cwd matches", () => {
    const firstWorkspaceScope = getWorkspaceDockScopeKey({
      environmentId: "env-1",
      threadId: "thread-1",
      workspaceId: "workspace-1",
      cwd: "/repo",
    });
    const secondWorkspaceScope = getWorkspaceDockScopeKey({
      environmentId: "env-1",
      threadId: "thread-1",
      workspaceId: "workspace-2",
      cwd: "/repo",
    });
    const store = useWorkspaceDockStore.getState();

    store.syncRouteState(firstWorkspaceScope, {
      filesOpen: false,
      diffOpen: false,
      terminalOpen: true,
      filePath: null,
    });
    store.openFile(secondWorkspaceScope, "src/other.ts");

    expect(
      getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), firstWorkspaceScope),
    ).toMatchObject({
      terminalTabOpen: true,
      activeTab: WORKSPACE_TERMINAL_TAB_ID,
      openFileTabs: [],
    });
    expect(
      getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), secondWorkspaceScope),
    ).toMatchObject({
      terminalTabOpen: false,
      activeTab: "src/other.ts",
      openFileTabs: ["src/other.ts"],
    });
  });

  it("prefers the thread workspace id over the project's active workspace id", () => {
    expect(
      resolveWorkspaceDockScopeId({
        effectiveWorkspaceId: "workspace-thread",
        activeWorkspaceId: "workspace-project",
      }),
    ).toBe("workspace-thread");
  });

  it("returns a stable default snapshot for missing scopes", () => {
    const state = useWorkspaceDockStore.getState();

    const first = getWorkspaceDockScopeState(state, "missing-scope");
    const second = getWorkspaceDockScopeState(state, "missing-scope");
    const empty = getWorkspaceDockScopeState(state, null);

    expect(first).toBe(second);
    expect(second).toBe(empty);
    expect(first.activeTab).toBe("chat");
  });

  it("prioritizes the terminal workspace tab over an active file path", () => {
    useWorkspaceDockStore.getState().syncRouteState(SCOPE, {
      filesOpen: false,
      diffOpen: false,
      terminalOpen: true,
      filePath: "src/app.ts",
    });

    const scope = getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), SCOPE);
    expect(scope.openFileTabs).toEqual(["src/app.ts"]);
    expect(scope.terminalTabOpen).toBe(true);
    expect(scope.activeTab).toBe(WORKSPACE_TERMINAL_TAB_ID);
  });

  it("keeps the detached terminal tab available when switching back to chat", () => {
    const store = useWorkspaceDockStore.getState();
    store.syncRouteState(SCOPE, {
      filesOpen: false,
      diffOpen: false,
      terminalOpen: true,
      filePath: null,
    });
    store.selectChatTab(SCOPE);

    const scope = getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), SCOPE);
    expect(scope.terminalTabOpen).toBe(true);
    expect(scope.activeTab).toBe("chat");
  });

  it("syncs the active tab back to chat when the route drops filePath", () => {
    const store = useWorkspaceDockStore.getState();
    store.openFile(SCOPE, "src/app.ts");

    store.syncRouteState(SCOPE, {
      filesOpen: true,
      diffOpen: false,
      terminalOpen: false,
      filePath: null,
    });

    const scope = getWorkspaceDockScopeState(useWorkspaceDockStore.getState(), SCOPE);
    expect(scope.openFileTabs).toEqual(["src/app.ts"]);
    expect(scope.activeTab).toBe("chat");
  });
});
