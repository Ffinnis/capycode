import { type EnvironmentId, type ThreadId } from "@capycode/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { retainSearchParams, useNavigate } from "@tanstack/react-router";
import {
  Suspense,
  lazy,
  startTransition,
  type ReactNode,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import ChatView from "./ChatView";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import { PersistentThreadTerminalSurface } from "./PersistentThreadTerminalSurface";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "./DiffPanelShell";
import { FilePreviewPanel } from "./files/FilePreviewPanel";
import { FileTreePanel } from "./files/FileTreePanel";
import { WorkspaceShell } from "./WorkspaceShell";
import { getWorkspaceTerminalSurfaceState } from "./workspaceTerminalSurfaceState";
import { type DraftId } from "~/composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "~/diffRouteSearch";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { FILE_PREVIEW_MAX_BYTES } from "~/lib/filePreview";
import { projectReadFileQueryOptions } from "~/lib/projectReactQuery";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "~/threadRoutes";
import {
  getWorkspaceDockScopeKey,
  getWorkspaceDockScopeState,
  useWorkspaceDockStore,
} from "~/workspaceDockStore";
import { hasDirtyWorkspaceBuffersForScope, useWorkspaceEditorStore } from "~/workspaceEditorStore";
import { SidebarInset } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("./DiffPanel"));
const WORKSPACE_SHEET_MEDIA_QUERY = "(max-width: 1180px)";
function mapRelativePathPrefix(
  relativePath: string | null,
  fromRelativePath: string,
  toRelativePath: string,
): string | null {
  if (!relativePath) {
    return null;
  }
  if (relativePath === fromRelativePath) {
    return toRelativePath;
  }
  if (!relativePath.startsWith(`${fromRelativePath}/`)) {
    return relativePath;
  }
  return `${toRelativePath}${relativePath.slice(fromRelativePath.length)}`;
}

function isPathWithinPrefix(relativePath: string | null, prefix: string): boolean {
  return relativePath === prefix || Boolean(relativePath?.startsWith(`${prefix}/`));
}

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

export function ThreadWorkspaceShell(props: {
  routeKind: "server" | "draft";
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  activeWorkspaceId: string | null;
  activeWorkspaceRoot: string | null;
  search: DiffRouteSearch;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shouldUseSheet = useMediaQuery(WORKSPACE_SHEET_MEDIA_QUERY);
  const { resolvedTheme } = useTheme();
  const workspaceDockScopeKey = useMemo(
    () =>
      props.activeWorkspaceRoot
        ? getWorkspaceDockScopeKey({
            environmentId: props.environmentId,
            threadId: props.threadId,
            workspaceId: props.activeWorkspaceId,
            cwd: props.activeWorkspaceRoot,
          })
        : null,
    [props.activeWorkspaceId, props.activeWorkspaceRoot, props.environmentId, props.threadId],
  );
  const workspaceDockState = useWorkspaceDockStore(
    useMemo(
      () => (state) => getWorkspaceDockScopeState(state, workspaceDockScopeKey),
      [workspaceDockScopeKey],
    ),
  );
  const openWorkspaceDockFile = useWorkspaceDockStore((state) => state.openFile);
  const diffOpen = props.search.diff === "1";
  const filesOpen = props.search.files === "1";
  const terminalOpen = props.search.terminal === "1";
  const activeFilePath = props.search.file ?? null;
  const hasDirtyWorkspaceBuffersRef = useRef(
    hasDirtyWorkspaceBuffersForScope(useWorkspaceEditorStore.getState(), workspaceDockScopeKey),
  );
  const currentThreadKey = `${props.environmentId}:${props.threadId}`;
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedDiff: diffOpen,
  }));
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
        terminal: "1" | undefined;
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
      const nextTerminal = Object.prototype.hasOwnProperty.call(overrides, "terminal")
        ? overrides.terminal
        : current.terminal;
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
        diff: nextDiff,
        files: nextFiles,
        terminal: nextTerminal,
        diffTurnId: nextDiffTurnId,
        diffFilePath: nextDiffFilePath,
        file: nextFile,
      };
    },
    [],
  );

  const navigateWithinThreadRoute = useCallback(
    (
      overrides: Partial<{
        diff: "1" | undefined;
        diffTurnId: DiffRouteSearch["diffTurnId"];
        diffFilePath: string | undefined;
        files: "1" | undefined;
        terminal: "1" | undefined;
        file: string | undefined;
      }>,
    ) => {
      startTransition(() => {
        if (props.routeKind === "draft" && props.draftId) {
          void navigate({
            to: "/draft/$draftId",
            params: buildDraftThreadRouteParams(props.draftId),
            replace: true,
            search: (previous) => updateWorkspaceSearch(previous, overrides),
          });
          return;
        }
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams({
            environmentId: props.environmentId,
            threadId: props.threadId,
          }),
          replace: true,
          search: (previous) => updateWorkspaceSearch(previous, overrides),
        });
      });
    },
    [
      navigate,
      props.draftId,
      props.environmentId,
      props.routeKind,
      props.threadId,
      updateWorkspaceSearch,
    ],
  );

  const closeSheet = useCallback(() => {
    navigateWithinThreadRoute({
      diff: undefined,
      files: undefined,
      terminal: undefined,
      file: undefined,
    });
  }, [navigateWithinThreadRoute]);

  const prefetchWorkspaceFilePreview = useCallback(
    (relativePath: string) => {
      if (!props.environmentId || !props.activeWorkspaceRoot) {
        return;
      }
      void queryClient.prefetchQuery(
        projectReadFileQueryOptions({
          environmentId: props.environmentId,
          cwd: props.activeWorkspaceRoot,
          relativePath,
          maxBytes: FILE_PREVIEW_MAX_BYTES,
        }),
      );
    },
    [props.activeWorkspaceRoot, props.environmentId, queryClient],
  );

  const openWorkspaceFile = useCallback(
    (relativePath: string) => {
      if (!workspaceDockScopeKey) {
        return;
      }
      prefetchWorkspaceFilePreview(relativePath);
      openWorkspaceDockFile(workspaceDockScopeKey, relativePath);
      navigateWithinThreadRoute({
        files: "1",
        terminal: undefined,
        file: relativePath,
      });
    },
    [
      navigateWithinThreadRoute,
      openWorkspaceDockFile,
      prefetchWorkspaceFilePreview,
      workspaceDockScopeKey,
    ],
  );

  const closeFilePreview = useCallback(() => {
    navigateWithinThreadRoute({
      files: filesOpen ? "1" : undefined,
      terminal: undefined,
      file: undefined,
    });
  }, [filesOpen, navigateWithinThreadRoute]);

  const handleMovedPath = useCallback(
    (fromRelativePath: string, toRelativePath: string) => {
      const nextFilePath = mapRelativePathPrefix(activeFilePath, fromRelativePath, toRelativePath);
      if (nextFilePath === activeFilePath) {
        return;
      }
      navigateWithinThreadRoute({
        files: "1",
        file: nextFilePath ?? undefined,
      });
    },
    [activeFilePath, navigateWithinThreadRoute],
  );

  const handleDeletedPath = useCallback(
    (relativePath: string) => {
      if (!isPathWithinPrefix(activeFilePath, relativePath)) {
        return;
      }
      navigateWithinThreadRoute({
        file: undefined,
      });
    },
    [activeFilePath, navigateWithinThreadRoute],
  );

  useEffect(() => {
    hasDirtyWorkspaceBuffersRef.current = hasDirtyWorkspaceBuffersForScope(
      useWorkspaceEditorStore.getState(),
      workspaceDockScopeKey,
    );

    return useWorkspaceEditorStore.subscribe((state) => {
      hasDirtyWorkspaceBuffersRef.current = hasDirtyWorkspaceBuffersForScope(
        state,
        workspaceDockScopeKey,
      );
    });
  }, [workspaceDockScopeKey]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyWorkspaceBuffersRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const previewFilePath = activeFilePath;
  const contextOpen = diffOpen;
  const { mounted: terminalSurfaceMounted, active: terminalSurfaceActive } =
    getWorkspaceTerminalSurfaceState({
      terminalSurfaceOpen: terminalOpen,
      terminalTabOpen: workspaceDockState.terminalTabOpen,
      activeTab: workspaceDockState.activeTab,
    });
  const sheetOpen = diffOpen || filesOpen || terminalSurfaceActive || activeFilePath !== null;
  const workspaceSurfaceContent =
    previewFilePath && props.activeWorkspaceRoot ? (
      <FilePreviewPanel
        environmentId={props.environmentId}
        cwd={props.activeWorkspaceRoot}
        scopeKey={workspaceDockScopeKey}
        relativePath={previewFilePath}
        variant="main"
      />
    ) : undefined;

  const main = (
    <SidebarInset className="h-full min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      {props.routeKind === "draft" && props.draftId ? (
        <ChatView
          draftId={props.draftId}
          environmentId={props.environmentId}
          threadId={props.threadId}
          onDiffPanelOpen={markDiffOpened}
          routeKind="draft"
          workspaceSurfaceContent={workspaceSurfaceContent}
        />
      ) : (
        <ChatView
          environmentId={props.environmentId}
          threadId={props.threadId}
          onDiffPanelOpen={markDiffOpened}
          routeKind="server"
          workspaceSurfaceContent={workspaceSurfaceContent}
        />
      )}
    </SidebarInset>
  );

  const filesPanel =
    filesOpen && props.activeWorkspaceRoot ? (
      <FileTreePanel
        environmentId={props.environmentId}
        cwd={props.activeWorkspaceRoot}
        scopeKey={workspaceDockScopeKey}
        selectedFilePath={activeFilePath}
        resolvedTheme={resolvedTheme}
        onOpenFile={openWorkspaceFile}
        onMovedPath={handleMovedPath}
        onDeletedPath={handleDeletedPath}
      />
    ) : undefined;

  const contextPanel = diffOpen ? (
    shouldRenderDiffContent ? (
      <LazyDiffPanel mode="sidebar" />
    ) : null
  ) : null;

  const nonTerminalSheetContent =
    previewFilePath && props.activeWorkspaceRoot && workspaceDockState.activeContext !== "diff" ? (
      <FilePreviewPanel
        environmentId={props.environmentId}
        cwd={props.activeWorkspaceRoot}
        scopeKey={workspaceDockScopeKey}
        relativePath={previewFilePath}
        onBack={closeFilePreview}
        variant="main"
      />
    ) : diffOpen && workspaceDockState.activeContext === "diff" ? (
      shouldRenderDiffContent ? (
        <LazyDiffPanel mode="sheet" />
      ) : null
    ) : filesOpen && props.activeWorkspaceRoot ? (
      <FileTreePanel
        environmentId={props.environmentId}
        cwd={props.activeWorkspaceRoot}
        scopeKey={workspaceDockScopeKey}
        selectedFilePath={activeFilePath}
        resolvedTheme={resolvedTheme}
        onOpenFile={openWorkspaceFile}
        onMovedPath={handleMovedPath}
        onDeletedPath={handleDeletedPath}
      />
    ) : null;
  const sheetContent: ReactNode = terminalSurfaceMounted ? (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      {nonTerminalSheetContent ? (
        <div
          className={cn(
            "flex h-full min-h-0 flex-1 flex-col",
            terminalSurfaceActive && "pointer-events-none invisible",
          )}
        >
          {nonTerminalSheetContent}
        </div>
      ) : null}
      <div
        className={cn(
          "absolute inset-0 flex min-h-0 flex-col",
          !terminalSurfaceActive && "pointer-events-none invisible",
        )}
      >
        <PersistentThreadTerminalSurface
          threadRef={{ environmentId: props.environmentId, threadId: props.threadId }}
          threadId={props.threadId}
          visible={terminalSurfaceActive}
          mode="surface"
          launchContext={null}
          focusRequestId={0}
          onDockToDrawer={() => {
            navigateWithinThreadRoute({ terminal: undefined });
          }}
        />
      </div>
    </div>
  ) : (
    nonTerminalSheetContent
  );

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

export const threadWorkspaceSearchConfig = {
  validateSearch: (search: Record<string, unknown>) => parseDiffRouteSearch(search),
  search: {
    middlewares: [
      retainSearchParams<DiffRouteSearch>([
        "diff",
        "diffTurnId",
        "diffFilePath",
        "files",
        "terminal",
        "file",
      ]),
    ],
  },
};
