import { type MessageId } from "@capycode/contracts";
import { type TimelineEntry, type WorkLogEntry } from "../../session-logic";
import { buildTurnDiffTree, type TurnDiffTreeNode } from "../../lib/turnDiffTree";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import { estimateTimelineMessageHeight } from "../timelineHeight";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showCompletionDivider: boolean;
      showAssistantCopyButton: boolean;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      kind: "working";
      id: string;
      createdAt: string | null;
      recentEntries: WorkLogEntry[];
    };

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const hasText = text !== null && text.trim().length > 0;
  return {
    text: hasText ? text : null,
    visible: showCopyButton && hasText && !streaming,
  };
}

function deriveTerminalAssistantMessageIds(timelineEntries: ReadonlyArray<TimelineEntry>) {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>();
  let nullTurnResponseIndex = 0;

  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") {
      continue;
    }
    const { message } = timelineEntry;
    if (message.role === "user") {
      nullTurnResponseIndex += 1;
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`;
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id);
  }

  return new Set(lastAssistantMessageIdByResponseKey.values());
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  completionDividerBeforeEntryId: string | null;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  extendedTraceMode?: boolean;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const activeWorkEntries: WorkLogEntry[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries);
  const activeTurnStartedAtMs =
    typeof input.activeTurnStartedAt === "string"
      ? Date.parse(input.activeTurnStartedAt)
      : Number.NaN;
  const shouldLiftActiveTrace =
    input.extendedTraceMode &&
    input.isWorking &&
    input.activeTurnStartedAt !== null &&
    !Number.isNaN(activeTurnStartedAtMs);

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      if (shouldLiftActiveTrace) {
        const workCreatedAtMs = Date.parse(timelineEntry.createdAt);
        if (!Number.isNaN(workCreatedAtMs) && workCreatedAtMs >= activeTurnStartedAtMs) {
          activeWorkEntries.push(timelineEntry.entry);
          continue;
        }
      }
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        if (shouldLiftActiveTrace) {
          const nextCreatedAtMs = Date.parse(nextEntry.createdAt);
          if (!Number.isNaN(nextCreatedAtMs) && nextCreatedAtMs >= activeTurnStartedAtMs) {
            break;
          }
        }
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      nextRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
      });
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showCompletionDivider:
        timelineEntry.message.role === "assistant" &&
        input.completionDividerBeforeEntryId === timelineEntry.id,
      showAssistantCopyButton:
        timelineEntry.message.role === "assistant" &&
        terminalAssistantMessageIds.has(timelineEntry.message.id),
    });
  }

  if (input.isWorking) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
      recentEntries: activeWorkEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES),
    });
  }

  return nextRows;
}

export function estimateMessagesTimelineRowHeight(
  row: MessagesTimelineRow,
  input: {
    timelineWidthPx: number | null;
    extendedTraceMode?: boolean;
    expandedWorkGroups?: Readonly<Record<string, boolean>>;
    turnDiffSummaryByAssistantMessageId?: ReadonlyMap<MessageId, TurnDiffSummary>;
  },
): number {
  switch (row.kind) {
    case "work":
      return estimateWorkRowHeight(row, input);
    case "proposed-plan":
      return estimateTimelineProposedPlanHeight(row.proposedPlan);
    case "working":
      return estimateWorkingRowHeight(row, input);
    case "message": {
      let estimate = estimateTimelineMessageHeight(row.message, {
        timelineWidthPx: input.timelineWidthPx,
      });
      const turnDiffSummary = input.turnDiffSummaryByAssistantMessageId?.get(row.message.id);
      if (turnDiffSummary && turnDiffSummary.files.length > 0) {
        estimate += estimateChangedFilesCardHeight(turnDiffSummary);
      }
      return estimate;
    }
  }
}

function estimateWorkingRowHeight(
  row: Extract<MessagesTimelineRow, { kind: "working" }>,
  input: {
    timelineWidthPx: number | null;
    extendedTraceMode?: boolean;
  },
): number {
  if (!input.extendedTraceMode || row.recentEntries.length === 0) {
    return 40;
  }

  const traceHeight = row.recentEntries.reduce((total, entry) => {
    if (entry.tone !== "thinking") {
      return total + 32;
    }
    return total + estimateReasoningEntryHeight(entry.detail ?? entry.label, input.timelineWidthPx);
  }, 0);

  return 56 + 28 + traceHeight;
}

function estimateWorkRowHeight(
  row: Extract<MessagesTimelineRow, { kind: "work" }>,
  input: {
    extendedTraceMode?: boolean;
    expandedWorkGroups?: Readonly<Record<string, boolean>>;
    timelineWidthPx?: number | null;
  },
): number {
  const isExpanded = input.extendedTraceMode
    ? (input.expandedWorkGroups?.[row.id] ?? true)
    : (input.expandedWorkGroups?.[row.id] ?? false);
  const hasOverflow = row.groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
  const visibleEntries =
    hasOverflow && !isExpanded ? MAX_VISIBLE_WORK_LOG_ENTRIES : row.groupedEntries.length;
  const onlyToolEntries = row.groupedEntries.every((entry) => entry.tone === "tool");
  const showHeader = hasOverflow || !onlyToolEntries;
  const startIndex = hasOverflow && !isExpanded ? row.groupedEntries.length - visibleEntries : 0;
  const bodyHeight = row.groupedEntries.slice(startIndex).reduce((total, entry) => {
    if (!input.extendedTraceMode || entry.tone !== "thinking") {
      return total + 32;
    }
    return total + estimateReasoningEntryHeight(entry.detail ?? entry.label, input.timelineWidthPx);
  }, 0);

  return 28 + (showHeader ? 26 : 0) + bodyHeight;
}

function estimateReasoningEntryHeight(text: string, timelineWidthPx: number | null | undefined) {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return 48;
  }

  const contentWidthPx =
    timelineWidthPx === null || timelineWidthPx === undefined
      ? 520
      : Math.max(timelineWidthPx - 116, 220);
  const estimatedCharactersPerLine = Math.max(28, Math.floor(contentWidthPx / 7));
  const estimatedLines = Math.max(1, Math.ceil(normalized.length / estimatedCharactersPerLine));

  // Match the actual extended-trace rendering closely enough that the
  // virtualizer does not need large post-measure corrections.
  return 34 + estimatedLines * 20;
}

function estimateTimelineProposedPlanHeight(proposedPlan: ProposedPlan): number {
  const estimatedLines = Math.max(1, Math.ceil(proposedPlan.planMarkdown.length / 72));
  return 120 + Math.min(estimatedLines * 22, 880);
}

function estimateChangedFilesCardHeight(turnDiffSummary: TurnDiffSummary): number {
  const treeNodes = buildTurnDiffTree(turnDiffSummary.files);
  const visibleNodeCount = countTurnDiffTreeNodes(treeNodes);

  // Card chrome: top/bottom padding, header row, and tree spacing.
  return 60 + visibleNodeCount * 25;
}

function countTurnDiffTreeNodes(nodes: ReadonlyArray<TurnDiffTreeNode>): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.kind === "directory") {
      count += countTurnDiffTreeNodes(node.children);
    }
  }
  return count;
}
