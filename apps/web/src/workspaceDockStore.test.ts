import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetWorkspaceDockStoreForTests,
  getWorkspaceDockScopeKey,
  getWorkspaceDockScopeState,
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
});
