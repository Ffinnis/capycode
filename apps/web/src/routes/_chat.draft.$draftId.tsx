import { scopeProjectRef } from "@capycode/client-runtime";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import {
  ThreadWorkspaceShell,
  threadWorkspaceSearchConfig,
} from "../components/ThreadWorkspaceShell";
import { threadHasStarted } from "../components/ChatView.logic";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { resolveEffectiveGitContext } from "../lib/gitContext";
import { selectActiveWorkspaceForProjectRef, useStore } from "../store";
import {
  createProjectSelectorByRef,
  createThreadSelectorAcrossEnvironments,
} from "../storeSelectors";
import { buildThreadRouteParams } from "../threadRoutes";

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const search = Route.useSearch();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);
  const canonicalThreadRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverThreadStarted
          ? draftSession.promotedTo
          : null
        : serverThread
          ? {
              environmentId: serverThread.environmentId,
              threadId: serverThread.id,
            }
          : null,
    [draftSession?.promotedTo, serverThread, serverThreadStarted],
  );
  const activeProjectRef = draftSession
    ? scopeProjectRef(draftSession.environmentId, draftSession.projectId)
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
        thread: null,
        draftThread: draftSession
          ? {
              workspaceId: null,
              branch: draftSession.branch,
              worktreePath: draftSession.worktreePath,
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
    [activeProject, draftSession, linkedWorkspace],
  );
  const activeWorkspaceRoot = effectiveGitContext.worktreePath ?? activeProject?.cwd ?? null;

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
      search,
    });
  }, [canonicalThreadRef, navigate, search]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      if (useComposerDraftStore.getState().getDraftSession(draftId) || canonicalThreadRef) {
        return;
      }
      void navigate({ to: "/", replace: true });
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [canonicalThreadRef, draftId, draftSession, navigate]);

  if (canonicalThreadRef) {
    return null;
  }

  if (!draftSession) {
    return null;
  }

  return (
    <ThreadWorkspaceShell
      routeKind="draft"
      environmentId={draftSession.environmentId}
      threadId={draftSession.threadId}
      draftId={draftId}
      activeWorkspaceRoot={activeWorkspaceRoot}
      search={search}
    />
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  ...threadWorkspaceSearchConfig,
  component: DraftChatThreadRouteView,
});
