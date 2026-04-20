import { scopedProjectKey, scopeProjectRef } from "@capycode/client-runtime";
import { DEFAULT_RUNTIME_MODE, type ScopedProjectRef } from "@capycode/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import { startTransition, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import { deriveLogicalProjectKey } from "../logicalProject";
import type { NewThreadLatencyTracker } from "../perf/newThreadLatency";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";

function useNewThreadState() {
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const projectsByScopedKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project,
        ]),
      ),
    [projects],
  );
  const router = useRouter();
  const getCurrentRouteTarget = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteTarget(currentRouteParams);
  }, [router]);
  const runTransition = useCallback(
    <T>(work: () => Promise<T> | T) =>
      new Promise<T>((resolve, reject) => {
        startTransition(() => {
          Promise.resolve().then(work).then(resolve).catch(reject);
        });
      }),
    [],
  );

  return useCallback(
    (
      projectRef: ScopedProjectRef,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
        latencyTracker?: NewThreadLatencyTracker | null;
      },
    ): Promise<void> => {
      const {
        createOrReuseProjectDraft,
        getDraftSessionByLogicalProjectKey,
        getDraftSession,
        getDraftThread,
      } = useComposerDraftStore.getState();
      const latencyTracker = options?.latencyTracker ?? null;
      const currentRouteTarget = getCurrentRouteTarget();
      const project = projectsByScopedKey.get(scopedProjectKey(projectRef));
      const logicalProjectKey = project
        ? deriveLogicalProjectKey(project)
        : scopedProjectKey(projectRef);
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const storedDraftThread = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      const latestActiveDraftThread: DraftThreadState | null = currentRouteTarget
        ? currentRouteTarget.kind === "server"
          ? getDraftThread(currentRouteTarget.threadRef)
          : getDraftSession(currentRouteTarget.draftId)
        : null;
      if (storedDraftThread) {
        return (async () => {
          createOrReuseProjectDraft({
            logicalProjectKey,
            projectRef,
            draftId: storedDraftThread.draftId,
            options: {
              threadId: storedDraftThread.threadId,
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            },
          });
          latencyTracker?.markDraftMutationComplete();
          if (
            currentRouteTarget?.kind === "draft" &&
            currentRouteTarget.draftId === storedDraftThread.draftId
          ) {
            latencyTracker?.markRouteReady();
            return;
          }
          await runTransition(() =>
            router.navigate({
              to: "/draft/$draftId",
              params: { draftId: storedDraftThread.draftId },
            }),
          );
          latencyTracker?.markRouteReady();
        })();
      }

      if (
        latestActiveDraftThread &&
        currentRouteTarget?.kind === "draft" &&
        latestActiveDraftThread.logicalProjectKey === logicalProjectKey
      ) {
        createOrReuseProjectDraft({
          logicalProjectKey,
          projectRef,
          draftId: currentRouteTarget.draftId,
          options: {
            threadId: latestActiveDraftThread.threadId,
            createdAt: latestActiveDraftThread.createdAt,
            runtimeMode: latestActiveDraftThread.runtimeMode,
            interactionMode: latestActiveDraftThread.interactionMode,
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          },
        });
        latencyTracker?.markDraftMutationComplete();
        latencyTracker?.markRouteReady();
        return Promise.resolve();
      }

      const draftId = newDraftId();
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async () => {
        createOrReuseProjectDraft({
          logicalProjectKey,
          projectRef,
          draftId,
          options: {
            threadId,
            createdAt,
            branch: options?.branch ?? null,
            worktreePath: options?.worktreePath ?? null,
            envMode: options?.envMode ?? "local",
            runtimeMode: DEFAULT_RUNTIME_MODE,
          },
          applyStickyState: true,
        });
        latencyTracker?.markDraftMutationComplete();
        await runTransition(() =>
          router.navigate({
            to: "/draft/$draftId",
            params: { draftId },
          }),
        );
        latencyTracker?.markRouteReady();
      })();
    },
    [getCurrentRouteTarget, projectsByScopedKey, router, runTransition],
  );
}

export function useNewThreadHandler() {
  const handleNewThread = useNewThreadState();

  return {
    handleNewThread,
  };
}

export function useHandleNewThread() {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const activeDraftThread = useComposerDraftStore(() =>
    routeTarget
      ? routeTarget.kind === "server"
        ? getDraftThread(routeTarget.threadRef)
        : useComposerDraftStore.getState().getDraftSession(routeTarget.draftId)
      : null,
  );
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: (project) => scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
    });
  }, [projectOrder, projects]);
  const handleNewThread = useNewThreadState();

  return {
    activeDraftThread,
    activeThread,
    defaultProjectRef: orderedProjects[0]
      ? scopeProjectRef(orderedProjects[0].environmentId, orderedProjects[0].id)
      : null,
    handleNewThread,
    routeThreadRef,
  };
}
