import { scopeProjectRef } from "@capycode/client-runtime";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { FilePreviewPanel } from "../components/files/FilePreviewPanel";
import { FileTreePanel } from "../components/files/FileTreePanel";
import { WorkspaceShell } from "../components/WorkspaceShell";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useTheme } from "../hooks/useTheme";
import { resolveEffectiveGitContext } from "../lib/gitContext";
import {
  selectActiveWorkspaceForProjectRef,
  selectEnvironmentState,
  selectThreadExistsByRef,
  useStore,
} from "../store";
import { createProjectSelectorByRef, createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef, buildThreadRouteParams } from "../threadRoutes";
import { SidebarInset } from "~/components/ui/sidebar";
import {
  getWorkspaceDockScopeKey,
  getWorkspaceDockScopeState,
  useWorkspaceDockStore,
} from "~/workspaceDockStore";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const WORKSPACE_SHEET_MEDIA_QUERY = "(max-width: 1180px)";

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

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
  const diffOpen = search.diff === "1";
  const filesOpen = search.files === "1";
  const activeFilePath = search.file ?? null;
  const shouldUseSheet = useMediaQuery(WORKSPACE_SHEET_MEDIA_QUERY);
  const { resolvedTheme } = useTheme();
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedDiff: diffOpen,
  }));
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
    [
      activeProject?.cwd,
      linkedWorkspace?.branch,
      linkedWorkspace?.id,
      linkedWorkspace?.worktreePath,
      serverThread?.branch,
      serverThread?.workspaceId,
      serverThread?.worktreePath,
    ],
  );
  const activeWorkspaceRoot = effectiveGitContext.worktreePath ?? activeProject?.cwd ?? null;
  const workspaceDockScopeKey = useMemo(
    () =>
      threadRef && activeWorkspaceRoot
        ? getWorkspaceDockScopeKey({
            environmentId: threadRef.environmentId,
            threadId: threadRef.threadId,
            cwd: activeWorkspaceRoot,
          })
        : null,
    [activeWorkspaceRoot, threadRef],
  );
  const workspaceDockState = useWorkspaceDockStore(
    useMemo(
      () => (state) => getWorkspaceDockScopeState(state, workspaceDockScopeKey),
      [workspaceDockScopeKey],
    ),
  );
  const openWorkspaceDockFile = useWorkspaceDockStore((state) => state.openFile);
  const hasOpenedDiff =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedDiff
      : diffOpen;

  const markDiffOpened = useCallback(() => {
    setDiffPanelMountState((previous) => {
      if (previous.threadKey === currentThreadKey && previous.hasOpenedDiff) {
        return previous;
      }
      return {
        threadKey: currentThreadKey,
        hasOpenedDiff: true,
      };
    });
  }, [currentThreadKey]);

  const updateWorkspaceSearch = useCallback(
    (
      previous: Record<string, unknown>,
      overrides: Partial<{
        diff: "1" | undefined;
        diffTurnId: DiffRouteSearch["diffTurnId"];
        diffFilePath: string | undefined;
        files: "1" | undefined;
        file: string | undefined;
      }>,
    ) => {
      const current = parseDiffRouteSearch(previous);
      const nextDiff = Object.prototype.hasOwnProperty.call(overrides, "diff")
        ? overrides.diff
        : current.diff;
      const nextFiles = Object.prototype.hasOwnProperty.call(overrides, "files")
        ? overrides.files
        : current.files;
      const nextFile = Object.prototype.hasOwnProperty.call(overrides, "file")
        ? overrides.file
        : current.file;
      const nextDiffTurnId = nextDiff
        ? Object.prototype.hasOwnProperty.call(overrides, "diffTurnId")
          ? overrides.diffTurnId
          : current.diffTurnId
        : undefined;
      const nextDiffFilePath = nextDiff
        ? Object.prototype.hasOwnProperty.call(overrides, "diffFilePath")
          ? overrides.diffFilePath
          : current.diffFilePath
        : undefined;
      const rest = stripDiffSearchParams(previous);
      return {
        ...rest,
        ...(nextDiff ? { diff: nextDiff } : {}),
        ...(nextFiles ? { files: nextFiles } : {}),
        ...(nextDiffTurnId ? { diffTurnId: nextDiffTurnId } : {}),
        ...(nextDiffFilePath ? { diffFilePath: nextDiffFilePath } : {}),
        ...(nextFile ? { file: nextFile } : {}),
      };
    },
    [],
  );

  const closeSheet = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      replace: true,
      search: (previous) =>
        updateWorkspaceSearch(previous, {
          diff: undefined,
          files: undefined,
          file: undefined,
        }),
    });
  }, [navigate, threadRef, updateWorkspaceSearch]);

  const openWorkspaceFile = useCallback(
    (relativePath: string) => {
      if (!threadRef || !workspaceDockScopeKey) {
        return;
      }
      openWorkspaceDockFile(workspaceDockScopeKey, relativePath);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
        replace: true,
        search: (previous) =>
          updateWorkspaceSearch(previous, {
            files: "1",
            file: relativePath,
          }),
      });
    },
    [navigate, openWorkspaceDockFile, threadRef, updateWorkspaceSearch, workspaceDockScopeKey],
  );

  const closeFilePreview = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      replace: true,
      search: (previous) =>
        updateWorkspaceSearch(previous, {
          files: filesOpen ? "1" : undefined,
          file: undefined,
        }),
    });
  }, [filesOpen, navigate, threadRef, updateWorkspaceSearch]);

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

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const showDiffContext = diffOpen && workspaceDockState.activeContext === "diff";
  const showFilePreview = Boolean(activeFilePath) && (!diffOpen || !showDiffContext);
  const previewFilePath = showFilePreview ? activeFilePath : null;
  const contextOpen = showDiffContext || showFilePreview;
  const sheetOpen = diffOpen || filesOpen || activeFilePath !== null;

  const main = (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <ChatView
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
        onDiffPanelOpen={markDiffOpened}
        routeKind="server"
      />
    </SidebarInset>
  );

  const filesPanel =
    filesOpen && activeWorkspaceRoot ? (
      <FileTreePanel
        environmentId={threadRef.environmentId}
        cwd={activeWorkspaceRoot}
        scopeKey={workspaceDockScopeKey}
        selectedFilePath={activeFilePath}
        resolvedTheme={resolvedTheme}
        onOpenFile={openWorkspaceFile}
      />
    ) : undefined;

  const contextPanel = showDiffContext ? (
    shouldRenderDiffContent ? (
      <LazyDiffPanel mode="sidebar" />
    ) : null
  ) : previewFilePath && activeWorkspaceRoot ? (
    <FilePreviewPanel
      environmentId={threadRef.environmentId}
      cwd={activeWorkspaceRoot}
      relativePath={previewFilePath}
    />
  ) : null;

  const sheetContent: ReactNode = showDiffContext ? (
    shouldRenderDiffContent ? (
      <LazyDiffPanel mode="sheet" />
    ) : null
  ) : previewFilePath && activeWorkspaceRoot ? (
    <FilePreviewPanel
      environmentId={threadRef.environmentId}
      cwd={activeWorkspaceRoot}
      relativePath={previewFilePath}
      onBack={closeFilePreview}
    />
  ) : filesOpen && activeWorkspaceRoot ? (
    <FileTreePanel
      environmentId={threadRef.environmentId}
      cwd={activeWorkspaceRoot}
      scopeKey={workspaceDockScopeKey}
      selectedFilePath={activeFilePath}
      resolvedTheme={resolvedTheme}
      onOpenFile={openWorkspaceFile}
    />
  ) : null;

  return (
    <WorkspaceShell
      main={main}
      filesOpen={filesOpen}
      contextOpen={contextOpen}
      filesPanel={filesPanel}
      contextPanel={contextPanel}
      useSheet={shouldUseSheet}
      sheetOpen={sheetOpen}
      sheetContent={sheetContent}
      onCloseSheet={closeSheet}
    />
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [
      retainSearchParams<DiffRouteSearch>(["diff", "diffTurnId", "diffFilePath", "files", "file"]),
    ],
  },
  component: ChatThreadRouteView,
});
