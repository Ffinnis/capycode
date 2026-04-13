import { scopeProjectRef } from "@capycode/client-runtime";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import {
  ThreadWorkspaceShell,
  threadWorkspaceSearchConfig,
} from "../components/ThreadWorkspaceShell";
import { threadHasStarted } from "../components/ChatView.logic";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { resolveEffectiveGitContext } from "../lib/gitContext";
import {
  selectActiveWorkspaceForProjectRef,
  selectEnvironmentState,
  selectThreadExistsByRef,
  useStore,
} from "../store";
import { createProjectSelectorByRef, createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef } from "../threadRoutes";

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : null;
  const activeProject = useStore(
    useMemo(() => createProjectSelectorByRef(activeProjectRef), [activeProjectRef]),
  );
  const linkedWorkspace = useStore(
    useMemo(
      () => (store) => selectActiveWorkspaceForProjectRef(store, activeProjectRef),
      [activeProjectRef],
    ),
  );
  const effectiveGitContext = useMemo(
    () =>
      resolveEffectiveGitContext({
        project: activeProject ? { cwd: activeProject.cwd } : null,
        thread: serverThread
          ? {
              workspaceId: serverThread.workspaceId ?? null,
              branch: serverThread.branch,
              worktreePath: serverThread.worktreePath,
            }
          : null,
        linkedWorkspace: linkedWorkspace
          ? {
              id: linkedWorkspace.id,
              branch: linkedWorkspace.branch,
              worktreePath: linkedWorkspace.worktreePath,
            }
          : null,
      }),
    [activeProject, linkedWorkspace, serverThread],
  );
  const activeWorkspaceRoot = effectiveGitContext.worktreePath ?? activeProject?.cwd ?? null;

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  return (
    <ThreadWorkspaceShell
      routeKind="server"
      environmentId={threadRef.environmentId}
      threadId={threadRef.threadId}
      activeWorkspaceRoot={activeWorkspaceRoot}
      search={search}
    />
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  ...threadWorkspaceSearchConfig,
  component: ChatThreadRouteView,
});
