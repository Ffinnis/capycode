import { scopeThreadRef } from "@capycode/client-runtime";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@capycode/contracts";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { buildThreadRouteParams } from "../threadRoutes";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  isLatestTurnSettled,
} from "../session-logic";
import { selectThreadsAcrossEnvironments, type AppState, useStore } from "../store";
import type { Thread } from "../types";

interface ThreadNotificationSnapshot {
  threadRef: ScopedThreadRef;
  threadTitle: string;
  projectName: string;
  workspaceName: string | null;
  session: Thread["session"];
  activeTurnId: string | null;
  latestTurnSettled: boolean;
  approvalIds: Set<string>;
  userInputIds: Set<string>;
}

function resolveCurrentThreadRef(pathname: string): ScopedThreadRef | null {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)$/);
  if (!match) {
    return null;
  }

  const environmentId = match[1];
  if (environmentId === "pair" || environmentId === "settings" || environmentId === "draft") {
    return null;
  }

  return scopeThreadRef(match[1] as EnvironmentId, match[2] as ThreadId);
}

function buildThreadNotificationSnapshot(
  thread: Thread,
  environmentStateById: AppState["environmentStateById"],
): ThreadNotificationSnapshot {
  const environmentState = environmentStateById[thread.environmentId];
  const projectName = environmentState?.projectById[thread.projectId]?.name ?? "Project";
  const workspaceName =
    thread.workspaceId && environmentState?.workspaceById[thread.workspaceId]
      ? (environmentState.workspaceById[thread.workspaceId]?.name ?? null)
      : null;
  const pendingApprovals = derivePendingApprovals(thread.activities);
  const pendingUserInput = derivePendingUserInputs(thread.activities);

  return {
    threadRef: scopeThreadRef(thread.environmentId, thread.id),
    threadTitle: thread.title || "Thread",
    projectName,
    workspaceName,
    session: thread.session,
    activeTurnId: thread.session?.activeTurnId ?? null,
    latestTurnSettled: isLatestTurnSettled(thread.latestTurn, thread.session),
    approvalIds: new Set(pendingApprovals.map((entry) => entry.requestId)),
    userInputIds: new Set(pendingUserInput.map((entry) => entry.requestId)),
  };
}

function shouldSuppressNotification(
  currentThreadRef: ScopedThreadRef | null,
  snapshot: ThreadNotificationSnapshot,
): boolean {
  if (!document.hasFocus() || !currentThreadRef) {
    return false;
  }

  return (
    currentThreadRef.environmentId === snapshot.threadRef.environmentId &&
    currentThreadRef.threadId === snapshot.threadRef.threadId
  );
}

export function DesktopNotificationsCoordinator() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const threads = useStore(useShallow(selectThreadsAcrossEnvironments));
  const environmentStateById = useStore((state) => state.environmentStateById);
  const previousSnapshotByThreadKeyRef = useRef(new Map<string, ThreadNotificationSnapshot>());

  const handleNotificationAction = useEffectEvent(
    (action: { environmentId: string; threadId: string }) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(
          scopeThreadRef(EnvironmentId.make(action.environmentId), ThreadId.make(action.threadId)),
        ),
      });
    },
  );

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) {
      return;
    }

    return bridge.onDesktopNotificationAction(handleNotificationAction);
  }, [handleNotificationAction]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) {
      return;
    }

    const currentThreadRef = resolveCurrentThreadRef(pathname);
    const nextSnapshotByThreadKey = new Map<string, ThreadNotificationSnapshot>();

    for (const thread of threads) {
      const snapshot = buildThreadNotificationSnapshot(thread, environmentStateById);
      const key = `${thread.environmentId}:${thread.id}`;
      const previous = previousSnapshotByThreadKeyRef.current.get(key);

      if (previous && !shouldSuppressNotification(currentThreadRef, snapshot)) {
        const latestTurn = thread.latestTurn;
        const shouldNotifyCompletion =
          previous.session?.orchestrationStatus === "running" &&
          previous.activeTurnId !== null &&
          latestTurn?.turnId === previous.activeTurnId &&
          snapshot.latestTurnSettled &&
          latestTurn?.completedAt !== null &&
          latestTurn?.completedAt !== undefined &&
          (latestTurn.state === "completed" ||
            latestTurn.state === "error" ||
            latestTurn.state === "interrupted");

        if (shouldNotifyCompletion) {
          void bridge.showDesktopNotification({
            kind: "completion",
            environmentId: thread.environmentId,
            threadId: thread.id,
            projectName: snapshot.projectName,
            workspaceName: snapshot.workspaceName,
            threadTitle: snapshot.threadTitle,
            dedupeKey: `${thread.environmentId}:${thread.id}:completion:${latestTurn.turnId}:${latestTurn.completedAt}`,
          });
        }

        for (const approvalId of snapshot.approvalIds) {
          if (previous.approvalIds.has(approvalId)) {
            continue;
          }
          void bridge.showDesktopNotification({
            kind: "attention",
            environmentId: thread.environmentId,
            threadId: thread.id,
            projectName: snapshot.projectName,
            workspaceName: snapshot.workspaceName,
            threadTitle: snapshot.threadTitle,
            dedupeKey: `${thread.environmentId}:${thread.id}:approval:${approvalId}`,
          });
        }

        for (const requestId of snapshot.userInputIds) {
          if (previous.userInputIds.has(requestId)) {
            continue;
          }
          void bridge.showDesktopNotification({
            kind: "attention",
            environmentId: thread.environmentId,
            threadId: thread.id,
            projectName: snapshot.projectName,
            workspaceName: snapshot.workspaceName,
            threadTitle: snapshot.threadTitle,
            dedupeKey: `${thread.environmentId}:${thread.id}:user-input:${requestId}`,
          });
        }
      }

      nextSnapshotByThreadKey.set(key, snapshot);
    }

    previousSnapshotByThreadKeyRef.current = nextSnapshotByThreadKey;
  }, [environmentStateById, pathname, threads]);

  return null;
}
