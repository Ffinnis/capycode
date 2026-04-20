import { scopeProjectRef } from "@capycode/client-runtime";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  ensurePrimaryEnvironmentReady,
  resolveInitialServerAuthGateState,
} from "../environments/primary";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { startNewThreadLatency } from "../perf/newThreadLatency";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useServerKeybindings } from "~/rpc/serverState";

export function resolveNewThreadShortcutOptions(input: {
  command: string | null;
  branch: string | null;
  worktreePath: string | null;
}): { envMode: "local"; branch?: string | null; worktreePath?: string | null } | null {
  if (input.command === "chat.newLocal") {
    return { envMode: "local" };
  }

  if (input.command === "chat.new") {
    return {
      branch: input.branch,
      worktreePath: input.worktreePath,
      envMode: "local",
    };
  }

  return null;
}

export function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useServerKeybindings();
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      const projectRef = activeThread
        ? scopeProjectRef(activeThread.environmentId, activeThread.projectId)
        : activeDraftThread && routeThreadRef
          ? scopeProjectRef(routeThreadRef.environmentId, activeDraftThread.projectId)
          : defaultProjectRef;
      if (!projectRef) return;

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });

      const newThreadOptions = resolveNewThreadShortcutOptions({
        command,
        branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
        worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
      });
      if (newThreadOptions) {
        event.preventDefault();
        event.stopPropagation();
        const latencyTracker = startNewThreadLatency("shortcut");
        void handleNewThread(projectRef, {
          ...newThreadOptions,
          latencyTracker,
        });
        return;
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    routeThreadRef,
    selectedThreadKeysSize,
    terminalOpen,
  ]);

  return null;
}

function ChatRouteLayout() {
  return (
    <>
      <ChatRouteGlobalShortcuts />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async () => {
    const [, authGateState] = await Promise.all([
      ensurePrimaryEnvironmentReady(),
      resolveInitialServerAuthGateState(),
    ]);
    if (authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
