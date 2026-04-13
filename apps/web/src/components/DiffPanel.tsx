import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { scopeThreadRef } from "@capycode/client-runtime";
import type {
  EnvironmentId,
  GitChangedFile,
  GitDiffCategory,
  GitRepositoryEntry,
  TurnId,
} from "@capycode/contracts";
import type { DiffPanelMode as ClientDiffPanelMode } from "@capycode/contracts/settings";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  GitCommitHorizontalIcon,
  GitBranchIcon,
  Rows3Icon,
  TextWrapIcon,
} from "lucide-react";
import {
  type RefObject,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openInPreferredEditor } from "../editorPreferences";
import { useGitStatus } from "~/lib/gitStatusState";
import { resolveEffectiveGitContext } from "~/lib/gitContext";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import {
  gitCommitFilesQueryOptions,
  gitFileDiffQueryOptions,
  gitListRepositoriesQueryOptions,
  gitListCommitsQueryOptions,
  gitReviewStatusQueryOptions,
} from "~/lib/gitReactQuery";
import { useUiStateStore } from "~/uiStateStore";
import { cn } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { resolvePathLinkTarget } from "../terminal-links";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useTheme } from "../hooks/useTheme";
import type { ColorScheme } from "../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { buildPatchCacheKey, resolveDiffThemeName } from "../lib/diffRendering";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { selectEnvironmentState, selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { formatShortTimestamp } from "../timestampFormat";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import GitActionsControl from "./GitActionsControl";
import { Checkbox } from "./ui/checkbox";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { ToggleGroup, Toggle } from "./ui/toggle-group";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";
type GitFilterMode = "all-changes" | "uncommitted" | "commit";

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

type GitPreviewSelection = {
  path: string;
  oldPath?: string;
  category: GitDiffCategory;
  commitHash?: string;
};

type GitFileListEntry = {
  key: string;
  file: GitChangedFile;
  category: GitDiffCategory;
  label: string;
};

function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "diff-panel",
): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    if (files.length > 0) {
      return { kind: "files", files };
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

function getRenderableFiles(renderablePatch: RenderablePatch | null): FileDiffMetadata[] {
  if (!renderablePatch || renderablePatch.kind !== "files") {
    return [];
  }

  return renderablePatch.files.toSorted((left, right) =>
    resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function getGitFileEntryKey(file: GitChangedFile, category: GitDiffCategory, commitHash?: string) {
  return `${category}:${commitHash ?? "current"}:${file.oldPath ?? "none"}:${file.path}`;
}

function buildAllChangesEntries(input: {
  againstBase: ReadonlyArray<GitChangedFile>;
  staged: ReadonlyArray<GitChangedFile>;
  unstaged: ReadonlyArray<GitChangedFile>;
}): GitFileListEntry[] {
  const entries = new Map<string, GitFileListEntry>();
  const mergeEntries = (
    files: ReadonlyArray<GitChangedFile>,
    category: GitDiffCategory,
    label: string,
  ) => {
    for (const file of files) {
      entries.set(file.path, {
        key: getGitFileEntryKey(file, category),
        file,
        category,
        label,
      });
    }
  };

  mergeEntries(input.againstBase, "against-base", "Base");
  mergeEntries(input.staged, "staged", "Staged");
  mergeEntries(input.unstaged, "unstaged", "Unstaged");

  return [...entries.values()].toSorted((left, right) =>
    left.file.path.localeCompare(right.file.path, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function _formatGitFileStatus(status: GitChangedFile["status"]): string {
  switch (status) {
    case "added":
      return "Added";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    case "copied":
      return "Copied";
    case "untracked":
      return "Untracked";
    default:
      return "Modified";
  }
}

function _renderChangeCount(additions: number, deletions: number) {
  if (additions === 0 && deletions === 0) {
    return "0";
  }
  return `+${additions} / -${deletions}`;
}

function getFileStatusColor(status: GitChangedFile["status"]): string {
  switch (status) {
    case "added":
    case "untracked":
      return "bg-success";
    case "deleted":
      return "bg-destructive";
    case "renamed":
    case "copied":
      return "bg-info";
    default:
      return "bg-warning";
  }
}

function formatSubmoduleSummary(file: Pick<GitChangedFile, "submodule">): string | null {
  if (!file.submodule) {
    return null;
  }

  const parts = [
    file.submodule.commitChanged ? "commit" : null,
    file.submodule.trackedChanges ? "tracked" : null,
    file.submodule.untrackedChanges ? "untracked" : null,
  ].filter((value): value is string => value !== null);

  return parts.length > 0 ? parts.join(" + ") : "repository";
}

function formatRepositoryKind(kind: GitRepositoryEntry["kind"]): string {
  switch (kind) {
    case "root":
      return "Root";
    case "submodule":
      return "Submodule";
    default:
      return "Nested";
  }
}

function GitRepositoryRow(props: {
  repository: GitRepositoryEntry;
  environmentId: EnvironmentId | null;
  selected: boolean;
  onSelect: (cwd: string) => void;
}) {
  const status = useGitStatus({
    environmentId: props.environmentId,
    cwd: props.repository.cwd,
  });
  const dirty = status.data?.hasWorkingTreeChanges ?? false;
  const branch = status.data?.branch ?? "(detached HEAD)";
  const prOpen = status.data?.pr?.state === "open";

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        props.selected
          ? "bg-accent text-accent-foreground"
          : "text-foreground/90 hover:bg-accent/50",
      )}
      style={{ paddingLeft: `${8 + props.repository.depth * 14}px` }}
      onClick={() => props.onSelect(props.repository.cwd)}
      data-testid={`git-repository-row-${props.repository.cwd}`}
    >
      <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11px] font-medium">{props.repository.name}</span>
          <span className="shrink-0 rounded border border-border/70 px-1 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
            {formatRepositoryKind(props.repository.kind)}
          </span>
          {dirty ? <span className="shrink-0 text-[10px] text-warning">dirty</span> : null}
          {prOpen ? <span className="shrink-0 text-[10px] text-primary">PR open</span> : null}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground/65">
          <span className="truncate font-mono">{props.repository.relativePath}</span>
          <span className="shrink-0 font-mono">{branch}</span>
          {status.data ? (
            <span className="shrink-0 font-mono">
              ↑{status.data.aheadCount} ↓{status.data.behindCount}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function GitFileRow(props: {
  entry: GitFileListEntry;
  selected: boolean;
  selectedForAction?: boolean;
  selectable?: boolean;
  onSelect: (selection: GitPreviewSelection) => void;
  onToggleSelectedForAction?: (path: string) => void;
}) {
  const { entry, selected, onSelect } = props;
  const submoduleSummary =
    entry.file.kind === "submodule" ? formatSubmoduleSummary(entry.file) : null;
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "text-foreground/90 hover:bg-accent/50",
      )}
      onClick={() =>
        onSelect({
          path: entry.file.path,
          category: entry.category,
          ...(entry.file.oldPath ? { oldPath: entry.file.oldPath } : {}),
        })
      }
      data-testid={`git-file-row-${entry.file.path}`}
    >
      {props.selectable ? (
        <Checkbox
          checked={props.selectedForAction ?? false}
          aria-label={
            props.selectedForAction
              ? `Exclude ${entry.file.path} from commit selection`
              : `Select ${entry.file.path} for commit`
          }
          className="shrink-0"
          onClick={(event) => {
            event.stopPropagation();
          }}
          onCheckedChange={() => {
            props.onToggleSelectedForAction?.(entry.file.path);
          }}
          data-testid={`git-file-select-${entry.file.path}`}
        />
      ) : null}
      <span
        className={cn(
          "mt-px size-1.5 shrink-0 rounded-full",
          getFileStatusColor(entry.file.status),
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[11px]">{entry.file.path}</span>
          {entry.file.kind === "submodule" ? (
            <span className="shrink-0 rounded border border-border/70 px-1 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
              Repo
            </span>
          ) : null}
        </div>
        {submoduleSummary ? (
          <div className="truncate text-[10px] text-muted-foreground/60">{submoduleSummary}</div>
        ) : null}
      </div>
      {entry.file.additions > 0 || entry.file.deletions > 0 ? (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/65">
          {entry.file.additions > 0 ? (
            <span className="text-success/80">+{entry.file.additions}</span>
          ) : null}
          {entry.file.additions > 0 && entry.file.deletions > 0 ? " " : null}
          {entry.file.deletions > 0 ? (
            <span className="text-destructive/80">-{entry.file.deletions}</span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

function CommitRow(props: {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        props.selected
          ? "bg-accent text-accent-foreground"
          : "text-foreground/90 hover:bg-accent/50",
      )}
      onClick={props.onSelect}
      data-testid={`git-commit-row-${props.hash}`}
    >
      <GitCommitHorizontalIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
      <span className="min-w-0 flex-1 truncate text-[11px]">
        {props.message || props.shortHash}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/55">
        {props.shortHash}
      </span>
    </button>
  );
}

function PatchPreview(props: {
  patch: string | undefined;
  isLoading: boolean;
  error: string | null;
  emptyLabel: string;
  cacheScope: string;
  diffRenderMode: DiffRenderMode;
  diffWordWrap: boolean;
  resolvedTheme: DiffThemeType;
  colorScheme: ColorScheme;
  patchViewportRef?: RefObject<HTMLDivElement | null>;
  onOpenFileInEditor?: (filePath: string) => void;
}) {
  const renderablePatch = useMemo(
    () => getRenderablePatch(props.patch, props.cacheScope),
    [props.cacheScope, props.patch],
  );
  const renderableFiles = useMemo(() => getRenderableFiles(renderablePatch), [renderablePatch]);

  if (props.error && !renderablePatch) {
    return (
      <div className="px-3 py-2">
        <p className="text-[11px] text-red-500/80">{props.error}</p>
      </div>
    );
  }

  if (!renderablePatch) {
    return props.isLoading ? (
      <DiffPanelLoadingState label="Loading diff..." />
    ) : (
      <div className="flex h-full items-center justify-center px-4 py-3 text-center text-xs text-muted-foreground/70">
        {props.emptyLabel}
      </div>
    );
  }

  if (renderablePatch.kind === "raw") {
    return (
      <div className="h-full overflow-auto p-2">
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
          <pre
            className={cn(
              "rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90",
              props.diffWordWrap
                ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                : "overflow-auto",
            )}
          >
            {renderablePatch.text}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div ref={props.patchViewportRef} className="h-full min-h-0 overflow-hidden">
      <Virtualizer
        className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
        config={{
          overscrollSize: 600,
          intersectionObserverMargin: 1200,
        }}
      >
        {renderableFiles.map((fileDiff) => {
          const filePath = resolveFileDiffPath(fileDiff);
          const themedFileKey = `${buildFileDiffRenderKey(fileDiff)}:${props.resolvedTheme}`;
          return (
            <div
              key={themedFileKey}
              data-diff-file-path={filePath}
              className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
              onClickCapture={(event) => {
                if (!props.onOpenFileInEditor) return;
                const nativeEvent = event.nativeEvent as MouseEvent;
                const composedPath = nativeEvent.composedPath?.() ?? [];
                const clickedHeader = composedPath.some((node) => {
                  if (!(node instanceof Element)) return false;
                  return node.hasAttribute("data-title");
                });
                if (!clickedHeader) return;
                props.onOpenFileInEditor?.(filePath);
              }}
            >
              <FileDiff
                fileDiff={fileDiff}
                options={{
                  diffStyle: props.diffRenderMode === "split" ? "split" : "unified",
                  lineDiffType: "none",
                  overflow: props.diffWordWrap ? "wrap" : "scroll",
                  theme: resolveDiffThemeName(props.resolvedTheme, props.colorScheme),
                  themeType: props.resolvedTheme,
                  unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                }}
              />
            </div>
          );
        })}
      </Virtualizer>
    </div>
  );
}

export function IterationsDiffView(props: {
  activeThread: boolean;
  isGitRepo: boolean;
  orderedTurnDiffSummaries: Array<{
    turnId: TurnId;
    completedAt: string;
    checkpointTurnCount?: number | undefined;
  }>;
  inferredCheckpointTurnCountByTurnId: Record<string, number | undefined>;
  selectedTurnId: TurnId | null;
  selectedTurn:
    | {
        turnId: TurnId;
        completedAt: string;
        checkpointTurnCount?: number | undefined;
      }
    | undefined;
  settingsTimestampFormat: "locale" | "12-hour" | "24-hour";
  onSelectTurn: (turnId: TurnId) => void;
  onSelectWholeConversation: () => void;
  patch: string | undefined;
  isLoading: boolean;
  error: string | null;
  diffRenderMode: DiffRenderMode;
  diffWordWrap: boolean;
  resolvedTheme: DiffThemeType;
  colorScheme: ColorScheme;
  selectedFilePath: string | null;
  patchViewportRef: RefObject<HTMLDivElement | null>;
  onOpenFileInEditor: (filePath: string) => void;
}) {
  const turnStripRef = useRef<HTMLDivElement>(null);
  const [canScrollTurnStripLeft, setCanScrollTurnStripLeft] = useState(false);
  const [canScrollTurnStripRight, setCanScrollTurnStripRight] = useState(false);
  const renderableFiles = useMemo(
    () => getRenderableFiles(getRenderablePatch(props.patch, `iterations:${props.resolvedTheme}`)),
    [props.patch, props.resolvedTheme],
  );
  const hasNoNetChanges = typeof props.patch === "string" && props.patch.trim().length === 0;

  const updateTurnStripScrollState = useCallback(() => {
    const element = turnStripRef.current;
    if (!element) {
      setCanScrollTurnStripLeft(false);
      setCanScrollTurnStripRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setCanScrollTurnStripLeft(element.scrollLeft > 4);
    setCanScrollTurnStripRight(element.scrollLeft < maxScrollLeft - 4);
  }, []);

  const scrollTurnStripBy = useCallback((offset: number) => {
    const element = turnStripRef.current;
    if (!element) return;
    element.scrollBy({ left: offset, behavior: "smooth" });
  }, []);

  const onTurnStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = turnStripRef.current;
    if (!element) return;
    if (element.scrollWidth <= element.clientWidth + 1) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    event.preventDefault();
    element.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, []);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    const onScroll = () => updateTurnStripScrollState();

    element.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => updateTurnStripScrollState());
    resizeObserver.observe(element);

    return () => {
      window.cancelAnimationFrame(frameId);
      element.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [updateTurnStripScrollState]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [props.orderedTurnDiffSummaries, props.selectedTurnId, updateTurnStripScrollState]);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;
    const selectedChip = element.querySelector<HTMLElement>("[data-turn-chip-selected='true']");
    selectedChip?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [props.selectedTurn?.turnId, props.selectedTurnId]);

  useEffect(() => {
    if (!props.selectedFilePath || !props.patchViewportRef.current) {
      return;
    }

    const target = Array.from(
      props.patchViewportRef.current.querySelectorAll<HTMLElement>("[data-diff-file-path]"),
    ).find((element) => element.dataset.diffFilePath === props.selectedFilePath);
    target?.scrollIntoView({ block: "nearest" });
  }, [props.patchViewportRef, props.selectedFilePath, renderableFiles]);

  if (!props.activeThread) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        Select a thread to inspect turn diffs.
      </div>
    );
  }

  if (!props.isGitRepo) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        Turn diffs are unavailable because this project is not a git repository.
      </div>
    );
  }

  if (props.orderedTurnDiffSummaries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        No completed turns yet.
      </div>
    );
  }

  return (
    <>
      <div className="relative border-b border-border/70 px-2 py-1.5">
        {canScrollTurnStripLeft ? (
          <div className="pointer-events-none absolute inset-y-0 left-10 z-10 w-7 bg-linear-to-r from-card to-transparent" />
        ) : null}
        {canScrollTurnStripRight ? (
          <div className="pointer-events-none absolute inset-y-0 right-10 z-10 w-7 bg-linear-to-l from-card to-transparent" />
        ) : null}
        <button
          type="button"
          className={cn(
            "absolute left-2 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripLeft
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(-180)}
          disabled={!canScrollTurnStripLeft}
          aria-label="Scroll turn list left"
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(
            "absolute right-2 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripRight
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(180)}
          disabled={!canScrollTurnStripRight}
          aria-label="Scroll turn list right"
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
        <div
          ref={turnStripRef}
          className="turn-chip-strip flex gap-1 overflow-x-auto px-8 py-0.5"
          onWheel={onTurnStripWheel}
        >
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={props.onSelectWholeConversation}
            data-turn-chip-selected={props.selectedTurnId === null}
          >
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-left transition-colors",
                props.selectedTurnId === null
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
              )}
            >
              <div className="text-[10px] leading-tight font-medium">All turns</div>
            </div>
          </button>
          {props.orderedTurnDiffSummaries.map((summary) => (
            <button
              key={summary.turnId}
              type="button"
              className="shrink-0 rounded-md"
              onClick={() => props.onSelectTurn(summary.turnId)}
              title={summary.turnId}
              data-turn-chip-selected={summary.turnId === props.selectedTurn?.turnId}
            >
              <div
                className={cn(
                  "rounded-md border px-2 py-1 text-left transition-colors",
                  summary.turnId === props.selectedTurn?.turnId
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
                )}
              >
                <div className="flex items-center gap-1">
                  <span className="text-[10px] leading-tight font-medium">
                    Turn{" "}
                    {summary.checkpointTurnCount ??
                      props.inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                      "?"}
                  </span>
                  <span className="text-[9px] leading-tight opacity-70">
                    {formatShortTimestamp(summary.completedAt, props.settingsTimestampFormat)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <PatchPreview
          patch={props.patch}
          isLoading={props.isLoading}
          error={props.error}
          emptyLabel={
            hasNoNetChanges
              ? "No net changes in this selection."
              : "No patch available for this selection."
          }
          cacheScope={`iterations:${props.resolvedTheme}`}
          diffRenderMode={props.diffRenderMode}
          diffWordWrap={props.diffWordWrap}
          resolvedTheme={props.resolvedTheme}
          colorScheme={props.colorScheme}
          patchViewportRef={props.patchViewportRef}
          onOpenFileInEditor={props.onOpenFileInEditor}
        />
      </div>
    </>
  );
}

export function GitDiffView(props: {
  hasActiveThread: boolean;
  activeCwd: string | null;
  environmentId: EnvironmentId | null;
  isGitRepo: boolean;
  repositories: ReadonlyArray<GitRepositoryEntry>;
  repositoriesLoading: boolean;
  repositoriesError: string | null;
  selectedRepositoryCwd: string | null;
  onSelectRepository: (cwd: string) => void;
  actionBar?: ReactNode;
  baseBranch: string | null;
  baseBranchOptions: ReadonlyArray<string>;
  filterMode: GitFilterMode;
  onSelectBaseBranch: (branch: string) => void;
  onSelectFilterMode: (mode: GitFilterMode) => void;
  allChanges: ReadonlyArray<GitFileListEntry>;
  staged: ReadonlyArray<GitFileListEntry>;
  unstaged: ReadonlyArray<GitFileListEntry>;
  commits: ReadonlyArray<{
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
  }>;
  selectedCommitHash: string | null;
  onSelectCommit: (hash: string) => void;
  commitFiles: ReadonlyArray<GitFileListEntry>;
  selectedPreview: GitPreviewSelection | null;
  onSelectFile: (selection: GitPreviewSelection) => void;
  selectedFilePaths?: ReadonlySet<string>;
  onToggleFileSelection?: (path: string) => void;
  onBatchToggleFiles?: (paths: ReadonlyArray<string>, selected: boolean) => void;
  reviewStatusLoading: boolean;
  reviewStatusError: string | null;
  commitsLoading: boolean;
  commitsError: string | null;
  commitFilesLoading: boolean;
  commitFilesError: string | null;
  diffPatch: string | undefined;
  diffLoading: boolean;
  diffError: string | null;
  diffRenderMode: DiffRenderMode;
  diffWordWrap: boolean;
  resolvedTheme: DiffThemeType;
  colorScheme: ColorScheme;
  patchViewportRef: RefObject<HTMLDivElement | null>;
  onOpenFileInEditor: (filePath: string) => void;
}) {
  const reviewLoading = props.reviewStatusLoading || props.commitsLoading;
  const selectedPreviewKey =
    props.selectedPreview === null
      ? null
      : `${props.selectedPreview.category}:${props.selectedPreview.commitHash ?? ""}:${props.selectedPreview.oldPath ?? ""}:${props.selectedPreview.path}`;

  const renderFileSection = (
    title: string,
    entries: ReadonlyArray<GitFileListEntry>,
    emptyLabel: string,
  ) => {
    const isSelectable = props.filterMode !== "commit";
    const selectablePaths = isSelectable
      ? entries.filter((e) => e.category !== "committed").map((e) => e.file.path)
      : [];
    const selectedCount = selectablePaths.filter((p) => props.selectedFilePaths?.has(p)).length;
    const allSectionSelected =
      selectablePaths.length > 0 && selectedCount === selectablePaths.length;
    const someSectionSelected = selectedCount > 0 && !allSectionSelected;

    return (
      <section>
        <div className="flex items-center gap-2 px-2 py-1">
          {selectablePaths.length > 0 && props.onBatchToggleFiles ? (
            <Checkbox
              checked={allSectionSelected}
              indeterminate={someSectionSelected}
              onCheckedChange={() => {
                props.onBatchToggleFiles!(selectablePaths, !allSectionSelected);
              }}
              aria-label={`Select all ${title.toLowerCase()} files`}
            />
          ) : null}
          <h3 className="flex-1 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
            {title}
          </h3>
          <span className="text-[10px] tabular-nums text-muted-foreground/50">
            {entries.length}
          </span>
        </div>
        {entries.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-muted-foreground/50">{emptyLabel}</div>
        ) : (
          <div className="space-y-px">
            {entries.map((entry) => (
              <GitFileRow
                key={entry.key}
                entry={entry}
                selected={
                  selectedPreviewKey ===
                  `${entry.category}:${
                    props.selectedPreview?.commitHash ?? ""
                  }:${entry.file.oldPath ?? ""}:${entry.file.path}`
                }
                selectable={entry.category !== "committed" && props.filterMode !== "commit"}
                selectedForAction={props.selectedFilePaths?.has(entry.file.path) ?? false}
                onSelect={props.onSelectFile}
                {...(props.onToggleFileSelection
                  ? { onToggleSelectedForAction: props.onToggleFileSelection }
                  : {})}
              />
            ))}
          </div>
        )}
      </section>
    );
  };

  if (!props.hasActiveThread) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        Select a thread to inspect git changes.
      </div>
    );
  }

  if (!props.activeCwd) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        This thread does not have a repository checkout yet.
      </div>
    );
  }

  if (!props.isGitRepo) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        Git review is unavailable because this checkout is not a git repository.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <Select
          value={props.baseBranch ?? ""}
          onValueChange={(value) => {
            if (value) props.onSelectBaseBranch(value);
          }}
        >
          <SelectTrigger size="xs" aria-label="Git diff base branch">
            <SelectValue>{props.baseBranch ?? "Select base branch"}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {props.baseBranchOptions.length > 0 ? (
              props.baseBranchOptions.map((branch) => (
                <SelectItem hideIndicator key={branch} value={branch}>
                  {branch}
                </SelectItem>
              ))
            ) : (
              <SelectItem hideIndicator value="">
                No branches
              </SelectItem>
            )}
          </SelectPopup>
        </Select>

        <Select
          value={props.filterMode}
          onValueChange={(value) => {
            if (value === "all-changes" || value === "uncommitted" || value === "commit") {
              props.onSelectFilterMode(value);
            }
          }}
        >
          <SelectTrigger size="xs" aria-label="Git diff filter">
            <SelectValue>
              {props.filterMode === "all-changes"
                ? "All changes"
                : props.filterMode === "uncommitted"
                  ? "Uncommitted"
                  : "Commit"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="all-changes">
              All changes
            </SelectItem>
            <SelectItem hideIndicator value="uncommitted">
              Uncommitted
            </SelectItem>
            <SelectItem hideIndicator value="commit">
              Commit
            </SelectItem>
          </SelectPopup>
        </Select>
      </div>

      {props.repositories.length > 1 || props.repositoriesLoading || props.repositoriesError ? (
        <div className="shrink-0 border-b border-border/70 px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
              Repositories
            </h3>
            {props.repositories.length > 0 ? (
              <span className="text-[10px] tabular-nums text-muted-foreground/50">
                {props.repositories.length}
              </span>
            ) : null}
          </div>
          {props.repositoriesLoading ? (
            <DiffPanelLoadingState label="Loading repositories..." />
          ) : props.repositoriesError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/6 px-3 py-2 text-[11px] text-destructive/85">
              {props.repositoriesError}
            </div>
          ) : (
            <div className="space-y-px">
              {props.repositories.map((repository) => (
                <GitRepositoryRow
                  key={repository.cwd}
                  repository={repository}
                  environmentId={props.environmentId}
                  selected={props.selectedRepositoryCwd === repository.cwd}
                  onSelect={props.onSelectRepository}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {props.actionBar ? (
        <div className="shrink-0 border-b border-border/70 px-3 py-2">{props.actionBar}</div>
      ) : null}

      <div className="min-h-0 basis-[40%] shrink-0 overflow-hidden border-b border-border/70">
        <div className="h-full overflow-y-auto px-3 py-3">
          {reviewLoading ? (
            <DiffPanelLoadingState label="Loading git review status..." />
          ) : props.reviewStatusError || props.commitsError ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/6 px-3 py-2 text-[11px] text-red-500/85">
              {props.reviewStatusError ?? props.commitsError}
            </div>
          ) : props.filterMode === "all-changes" ? (
            renderFileSection("All changes", props.allChanges, "No changes to review.")
          ) : props.filterMode === "uncommitted" ? (
            <div className="space-y-3">
              {renderFileSection("Staged", props.staged, "No staged changes.")}
              {renderFileSection("Unstaged", props.unstaged, "No unstaged changes.")}
            </div>
          ) : (
            <div className="space-y-3">
              <section>
                <div className="flex items-center gap-2 px-2 py-1">
                  <h3 className="flex-1 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                    Ahead of {props.baseBranch ?? "base"}
                  </h3>
                  <span className="text-[10px] tabular-nums text-muted-foreground/50">
                    {props.commits.length}
                  </span>
                </div>
                {props.commits.length === 0 ? (
                  <div className="px-2 py-2 text-[11px] text-muted-foreground/50">
                    No commits ahead of the selected base branch.
                  </div>
                ) : (
                  <div className="space-y-px">
                    {props.commits.map((commit) => (
                      <CommitRow
                        key={commit.hash}
                        hash={commit.hash}
                        shortHash={commit.shortHash}
                        message={commit.message}
                        author={commit.author}
                        date={commit.date}
                        selected={commit.hash === props.selectedCommitHash}
                        onSelect={() => props.onSelectCommit(commit.hash)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {props.selectedCommitHash ? (
                <section>
                  <div className="flex items-center gap-2 px-2 py-1">
                    <h3 className="flex-1 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                      Commit files
                    </h3>
                    <span className="text-[10px] tabular-nums text-muted-foreground/50">
                      {props.commitFiles.length}
                    </span>
                  </div>
                  {props.commitFilesLoading ? (
                    <DiffPanelLoadingState label="Loading commit files..." />
                  ) : props.commitFilesError ? (
                    <div className="px-2 py-2 text-[11px] text-destructive/85">
                      {props.commitFilesError}
                    </div>
                  ) : props.commitFiles.length === 0 ? (
                    <div className="px-2 py-2 text-[11px] text-muted-foreground/50">
                      This commit does not change any files.
                    </div>
                  ) : (
                    <div className="space-y-px">
                      {props.commitFiles.map((entry) => (
                        <GitFileRow
                          key={entry.key}
                          entry={entry}
                          selected={
                            selectedPreviewKey ===
                            `${entry.category}:${props.selectedCommitHash}:${entry.file.oldPath ?? ""}:${entry.file.path}`
                          }
                          onSelect={(selection) =>
                            props.onSelectFile({
                              ...(props.selectedCommitHash
                                ? { commitHash: props.selectedCommitHash }
                                : {}),
                              ...selection,
                            })
                          }
                          selectable={false}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <PatchPreview
          patch={props.diffPatch}
          isLoading={props.diffLoading}
          error={props.diffError}
          emptyLabel={
            props.selectedPreview
              ? "No patch available for the selected file."
              : "Select a file to preview its diff."
          }
          cacheScope={`git:${props.resolvedTheme}`}
          diffRenderMode={props.diffRenderMode}
          diffWordWrap={props.diffWordWrap}
          resolvedTheme={props.resolvedTheme}
          colorScheme={props.colorScheme}
          patchViewportRef={props.patchViewportRef}
          onOpenFileInEditor={props.onOpenFileInEditor}
        />
      </div>
    </div>
  );
}

interface DiffPanelProps {
  mode?: DiffPanelMode;
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({ mode = "inline" }: DiffPanelProps) {
  const navigate = useNavigate();
  const { resolvedTheme, colorScheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("stacked");
  const [diffWordWrap, setDiffWordWrap] = useState(settings.diffWordWrap);
  const panelMode = settings.diffPanelMode;
  const [gitFilterMode, setGitFilterMode] = useState<GitFilterMode>("all-changes");
  const [selectedGitBaseBranch, setSelectedGitBaseBranch] = useState<string | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [selectedGitPreview, setSelectedGitPreview] = useState<GitPreviewSelection | null>(null);
  const [selectedGitFilePaths, setSelectedGitFilePaths] = useState<ReadonlySet<string>>(new Set());
  const patchViewportRef = useRef<HTMLDivElement>(null);
  const previousDiffOpenRef = useRef(false);
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const diffSearch = useSearch({ strict: false, select: (search) => parseDiffRouteSearch(search) });
  const diffOpen = diffSearch.diff === "1";
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const routeThreadKey =
    routeThreadRef !== null ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}` : null;
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeThread && activeProjectId
      ? selectProjectByRef(store, {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        })
      : undefined,
  );
  const linkedWorkspace = useStore(
    useMemo(
      () => (store) =>
        activeThread?.workspaceId
          ? selectEnvironmentState(store, activeThread.environmentId).workspaceById[
              activeThread.workspaceId
            ]
          : undefined,
      [activeThread?.environmentId, activeThread?.workspaceId],
    ),
  );
  const effectiveGitContext = useMemo(
    () =>
      resolveEffectiveGitContext({
        project: activeProject ? { cwd: activeProject.cwd } : null,
        thread: activeThread
          ? {
              workspaceId: activeThread.workspaceId ?? null,
              branch: activeThread.branch,
              worktreePath: activeThread.worktreePath,
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
    [activeProject, activeThread, linkedWorkspace],
  );
  const selectedRepositoryCwd = useUiStateStore((state) =>
    routeThreadKey ? (state.selectedGitRepositoryCwdByThreadId[routeThreadKey] ?? null) : null,
  );
  const setSelectedGitRepositoryCwd = useUiStateStore((state) => state.setSelectedGitRepositoryCwd);
  const catalogCwd = effectiveGitContext.cwd;
  const repositoriesQuery = useQuery(
    gitListRepositoriesQueryOptions({
      environmentId: activeThread?.environmentId ?? null,
      cwd: catalogCwd,
      enabled: panelMode === "git",
    }),
  );
  const rootRepositoryCwd = repositoriesQuery.data?.rootCwd ?? catalogCwd ?? null;
  const effectiveSelectedRepositoryCwd = useMemo(() => {
    if (!rootRepositoryCwd) {
      return null;
    }
    const availableRepositoryCwds = new Set(
      (repositoriesQuery.data?.repositories ?? []).map((repository) => repository.cwd),
    );
    if (
      selectedRepositoryCwd &&
      (availableRepositoryCwds.size === 0 || availableRepositoryCwds.has(selectedRepositoryCwd))
    ) {
      return selectedRepositoryCwd;
    }
    return rootRepositoryCwd;
  }, [repositoriesQuery.data?.repositories, rootRepositoryCwd, selectedRepositoryCwd]);
  const activeCwd =
    panelMode === "git" ? (effectiveSelectedRepositoryCwd ?? catalogCwd) : catalogCwd;
  const gitStatusQuery = useGitStatus({
    environmentId: activeThread?.environmentId ?? null,
    cwd: activeCwd,
  });
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  const selectedTurnId = diffSearch.diffTurnId ?? null;
  const selectedFilePath = selectedTurnId !== null ? (diffSearch.diffFilePath ?? null) : null;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts = orderedTurnDiffSummaries
      .map(
        (summary) =>
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
      )
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) {
      return undefined;
    }
    const latest = Math.max(...turnCounts);
    return latest > 0 ? latest : undefined;
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
  const conversationCheckpointRange = useMemo(
    () =>
      !selectedTurn && typeof conversationCheckpointTurnCount === "number"
        ? {
            fromTurnCount: 0,
            toTurnCount: conversationCheckpointTurnCount,
          }
        : null,
    [conversationCheckpointTurnCount, selectedTurn],
  );
  const activeCheckpointRange = selectedTurn
    ? selectedCheckpointRange
    : conversationCheckpointRange;
  const conversationCacheScope = useMemo(() => {
    if (selectedTurn || orderedTurnDiffSummaries.length === 0) {
      return null;
    }
    return `conversation:${orderedTurnDiffSummaries.map((summary) => summary.turnId).join(",")}`;
  }, [orderedTurnDiffSummaries, selectedTurn]);
  const activeCheckpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : conversationCacheScope,
      enabled: isGitRepo,
    }),
  );
  const selectedPatch = selectedTurn
    ? activeCheckpointDiffQuery.data?.diff
    : activeCheckpointDiffQuery.data?.diff;
  const checkpointDiffError =
    activeCheckpointDiffQuery.error instanceof Error
      ? activeCheckpointDiffQuery.error.message
      : activeCheckpointDiffQuery.error
        ? "Failed to load checkpoint diff."
        : null;

  useEffect(() => {
    if (!routeThreadKey) {
      return;
    }
    if (!effectiveSelectedRepositoryCwd) {
      setSelectedGitRepositoryCwd(routeThreadKey, null);
      return;
    }
    if (selectedRepositoryCwd !== effectiveSelectedRepositoryCwd) {
      setSelectedGitRepositoryCwd(routeThreadKey, effectiveSelectedRepositoryCwd);
    }
  }, [
    effectiveSelectedRepositoryCwd,
    routeThreadKey,
    selectedRepositoryCwd,
    setSelectedGitRepositoryCwd,
  ]);

  useEffect(() => {
    if (diffOpen && !previousDiffOpenRef.current) {
      setDiffWordWrap(settings.diffWordWrap);
    }
    previousDiffOpenRef.current = diffOpen;
  }, [diffOpen, settings.diffWordWrap]);

  useEffect(() => {
    startTransition(() => {
      setSelectedGitBaseBranch(null);
      setSelectedCommitHash(null);
      setSelectedGitPreview(null);
      setSelectedGitFilePaths(new Set());
    });
  }, [activeCwd]);

  const openDiffFileInEditor = useCallback(
    (filePath: string) => {
      const api = readLocalApi();
      if (!api) return;
      const targetPath = activeCwd ? resolvePathLinkTarget(filePath, activeCwd) : filePath;
      void openInPreferredEditor(api, targetPath).catch((error) => {
        console.warn("Failed to open diff file in editor.", error);
      });
    },
    [activeCwd],
  );

  const selectTurn = useCallback(
    (turnId: TurnId) => {
      if (!activeThread) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(activeThread.environmentId, activeThread.id)),
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return { ...rest, diff: "1", diffTurnId: turnId };
        },
      });
    },
    [activeThread, navigate],
  );

  const selectWholeConversation = useCallback(() => {
    if (!activeThread) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(activeThread.environmentId, activeThread.id)),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [activeThread, navigate]);

  const reviewStatusQuery = useQuery(
    gitReviewStatusQueryOptions({
      environmentId: activeThread?.environmentId ?? null,
      cwd: activeCwd,
      baseBranch: selectedGitBaseBranch,
      enabled: panelMode === "git",
    }),
  );
  const commitsQuery = useQuery(
    gitListCommitsQueryOptions({
      environmentId: activeThread?.environmentId ?? null,
      cwd: activeCwd,
      baseBranch: selectedGitBaseBranch,
      enabled: panelMode === "git",
    }),
  );
  const effectiveGitBaseBranch =
    selectedGitBaseBranch ??
    reviewStatusQuery.data?.baseBranch ??
    commitsQuery.data?.baseBranch ??
    null;
  const commitFilesQuery = useQuery(
    gitCommitFilesQueryOptions({
      environmentId: activeThread?.environmentId ?? null,
      cwd: activeCwd,
      commitHash: gitFilterMode === "commit" ? selectedCommitHash : null,
      enabled: panelMode === "git" && gitFilterMode === "commit" && selectedCommitHash !== null,
    }),
  );
  const gitFileDiffQuery = useQuery(
    gitFileDiffQueryOptions({
      environmentId: activeThread?.environmentId ?? null,
      cwd: activeCwd,
      path: selectedGitPreview?.path ?? null,
      oldPath: selectedGitPreview?.oldPath ?? null,
      category: selectedGitPreview?.category ?? null,
      baseBranch: effectiveGitBaseBranch,
      commitHash: selectedGitPreview?.commitHash ?? null,
      enabled: panelMode === "git" && selectedGitPreview !== null,
    }),
  );

  const repositoriesError =
    repositoriesQuery.error instanceof Error
      ? repositoriesQuery.error.message
      : repositoriesQuery.error
        ? "Failed to load repositories."
        : null;
  const reviewStatusError =
    reviewStatusQuery.error instanceof Error
      ? reviewStatusQuery.error.message
      : reviewStatusQuery.error
        ? "Failed to load git review status."
        : null;
  const commitsError =
    commitsQuery.error instanceof Error
      ? commitsQuery.error.message
      : commitsQuery.error
        ? "Failed to load commit history."
        : null;
  const commitFilesError =
    commitFilesQuery.error instanceof Error
      ? commitFilesQuery.error.message
      : commitFilesQuery.error
        ? "Failed to load commit files."
        : null;
  const gitFileDiffError =
    gitFileDiffQuery.error instanceof Error
      ? gitFileDiffQuery.error.message
      : gitFileDiffQuery.error
        ? "Failed to load file diff."
        : null;

  const allChangeEntries = useMemo(
    () =>
      buildAllChangesEntries({
        againstBase: reviewStatusQuery.data?.againstBase ?? [],
        staged: reviewStatusQuery.data?.staged ?? [],
        unstaged: reviewStatusQuery.data?.unstaged ?? [],
      }),
    [
      reviewStatusQuery.data?.againstBase,
      reviewStatusQuery.data?.staged,
      reviewStatusQuery.data?.unstaged,
    ],
  );
  const stagedEntries = useMemo(
    () =>
      (reviewStatusQuery.data?.staged ?? []).map((file) => ({
        key: getGitFileEntryKey(file, "staged"),
        file,
        category: "staged" as const,
        label: "Staged",
      })),
    [reviewStatusQuery.data?.staged],
  );
  const unstagedEntries = useMemo(
    () =>
      (reviewStatusQuery.data?.unstaged ?? []).map((file) => ({
        key: getGitFileEntryKey(file, "unstaged"),
        file,
        category: "unstaged" as const,
        label: "Unstaged",
      })),
    [reviewStatusQuery.data?.unstaged],
  );
  const commitFileEntries = useMemo(
    () =>
      (commitFilesQuery.data?.files ?? []).map((file) => ({
        key: getGitFileEntryKey(file, "committed", selectedCommitHash ?? undefined),
        file,
        category: "committed" as const,
        label: "Commit",
      })),
    [commitFilesQuery.data?.files, selectedCommitHash],
  );

  useEffect(() => {
    if (gitFilterMode !== "commit" || !selectedCommitHash) {
      return;
    }

    const commitExists = (commitsQuery.data?.commits ?? []).some(
      (commit) => commit.hash === selectedCommitHash,
    );
    if (!commitExists) {
      setSelectedCommitHash(null);
      setSelectedGitPreview(null);
    }
  }, [commitsQuery.data?.commits, gitFilterMode, selectedCommitHash]);

  useEffect(() => {
    setSelectedGitFilePaths((current) => {
      if (current.size === 0) {
        return current;
      }
      const selectablePaths = new Set(
        [...allChangeEntries, ...stagedEntries, ...unstagedEntries].map((entry) => entry.file.path),
      );
      const next = [...current].filter((path) => selectablePaths.has(path));
      return next.length === current.size ? current : new Set(next);
    });
  }, [allChangeEntries, stagedEntries, unstagedEntries]);

  const selectPanelMode = useCallback(
    (nextMode: ClientDiffPanelMode) => {
      updateSettings({ diffPanelMode: nextMode });
    },
    [updateSettings],
  );

  const selectGitBaseBranch = useCallback((branch: string) => {
    startTransition(() => {
      setSelectedGitBaseBranch(branch);
      setSelectedCommitHash(null);
      setSelectedGitPreview(null);
      setSelectedGitFilePaths(new Set());
    });
  }, []);

  const selectGitFilterMode = useCallback((nextMode: GitFilterMode) => {
    startTransition(() => {
      setGitFilterMode(nextMode);
      setSelectedCommitHash(null);
      setSelectedGitPreview(null);
      if (nextMode === "commit") {
        setSelectedGitFilePaths(new Set());
      }
    });
  }, []);

  const selectRepository = useCallback(
    (cwd: string) => {
      if (!routeThreadKey) {
        return;
      }
      startTransition(() => {
        setSelectedGitRepositoryCwd(routeThreadKey, cwd);
      });
    },
    [routeThreadKey, setSelectedGitRepositoryCwd],
  );

  const selectCommit = useCallback((hash: string) => {
    startTransition(() => {
      setSelectedCommitHash(hash);
      setSelectedGitPreview(null);
      setSelectedGitFilePaths(new Set());
    });
  }, []);

  const selectGitFile = useCallback((selection: GitPreviewSelection) => {
    startTransition(() => {
      setSelectedGitPreview(selection);
    });
  }, []);

  const toggleSelectedGitFilePath = useCallback((path: string) => {
    startTransition(() => {
      setSelectedGitFilePaths((current) => {
        const next = new Set(current);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    });
  }, []);

  const batchToggleGitFiles = useCallback((paths: ReadonlyArray<string>, selected: boolean) => {
    startTransition(() => {
      setSelectedGitFilePaths((current) => {
        const next = new Set(current);
        for (const path of paths) {
          if (selected) {
            next.add(path);
          } else {
            next.delete(path);
          }
        }
        return next;
      });
    });
  }, []);

  const selectedGitFilePathList = useMemo(() => [...selectedGitFilePaths], [selectedGitFilePaths]);
  const selectedGitFilesCount = selectedGitFilePathList.length;
  const gitActionSelectionSummary =
    gitFilterMode === "commit"
      ? null
      : selectedGitFilesCount > 0
        ? `Commit ${selectedGitFilesCount} selected ${selectedGitFilesCount === 1 ? "file" : "files"}`
        : "Commit all changes";
  const gitActionSelectedFileProps =
    gitFilterMode === "commit" ? {} : { selectedFilePaths: selectedGitFilePathList };

  const showDiffRenderControls = panelMode === "iterations" || selectedGitPreview !== null;
  const modeToggleValue = [panelMode];
  const headerRow = (
    <>
      <ToggleGroup
        className="shrink-0 rounded-lg bg-muted/50 p-0.5"
        size="xs"
        value={modeToggleValue}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "iterations" || next === "git") {
            selectPanelMode(next);
          }
        }}
      >
        <Toggle
          aria-label="Iterations diff mode"
          value="iterations"
          className="data-pressed:bg-background data-pressed:shadow-sm"
        >
          Iterations
        </Toggle>
        <Toggle
          aria-label="Git diff mode"
          value="git"
          className="data-pressed:bg-background data-pressed:shadow-sm"
        >
          Git
        </Toggle>
      </ToggleGroup>
      {showDiffRenderControls ? (
        <div className="flex shrink-0 items-center gap-1">
          <ToggleGroup
            className="shrink-0"
            variant="outline"
            size="xs"
            value={[diffRenderMode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stacked" || next === "split") {
                setDiffRenderMode(next);
              }
            }}
          >
            <Toggle aria-label="Stacked diff view" value="stacked">
              <Rows3Icon className="size-3" />
            </Toggle>
            <Toggle aria-label="Split diff view" value="split">
              <Columns2Icon className="size-3" />
            </Toggle>
          </ToggleGroup>
          <Toggle
            aria-label={diffWordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
            title={diffWordWrap ? "Disable line wrapping" : "Enable line wrapping"}
            variant="outline"
            size="xs"
            pressed={diffWordWrap}
            onPressedChange={(pressed) => {
              setDiffWordWrap(Boolean(pressed));
            }}
          >
            <TextWrapIcon className="size-3" />
          </Toggle>
        </div>
      ) : null}
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {panelMode === "iterations" ? (
        <IterationsDiffView
          activeThread={Boolean(activeThread)}
          isGitRepo={isGitRepo}
          orderedTurnDiffSummaries={orderedTurnDiffSummaries}
          inferredCheckpointTurnCountByTurnId={inferredCheckpointTurnCountByTurnId}
          selectedTurnId={selectedTurnId}
          selectedTurn={selectedTurn}
          settingsTimestampFormat={settings.timestampFormat}
          onSelectTurn={selectTurn}
          onSelectWholeConversation={selectWholeConversation}
          patch={selectedPatch}
          isLoading={activeCheckpointDiffQuery.isLoading}
          error={checkpointDiffError}
          diffRenderMode={diffRenderMode}
          diffWordWrap={diffWordWrap}
          resolvedTheme={resolvedTheme as DiffThemeType}
          colorScheme={colorScheme}
          selectedFilePath={selectedFilePath}
          patchViewportRef={patchViewportRef}
          onOpenFileInEditor={openDiffFileInEditor}
        />
      ) : (
        <GitDiffView
          hasActiveThread={Boolean(activeThread)}
          activeCwd={activeCwd}
          environmentId={activeThread?.environmentId ?? null}
          isGitRepo={reviewStatusQuery.data?.isRepo ?? isGitRepo}
          repositories={repositoriesQuery.data?.repositories ?? []}
          repositoriesLoading={repositoriesQuery.isLoading}
          repositoriesError={repositoriesError}
          selectedRepositoryCwd={effectiveSelectedRepositoryCwd}
          onSelectRepository={selectRepository}
          actionBar={
            activeThread ? (
              <GitActionsControl
                variant="panel"
                gitCwd={activeCwd}
                activeThreadRef={scopeThreadRef(activeThread.environmentId, activeThread.id)}
                effectiveBranch={effectiveGitContext.branch}
                {...gitActionSelectedFileProps}
                selectionSummary={gitActionSelectionSummary}
                enableAmbientSync={false}
              />
            ) : null
          }
          baseBranch={effectiveGitBaseBranch}
          baseBranchOptions={reviewStatusQuery.data?.baseBranchOptions ?? []}
          filterMode={gitFilterMode}
          onSelectBaseBranch={selectGitBaseBranch}
          onSelectFilterMode={selectGitFilterMode}
          allChanges={allChangeEntries}
          staged={stagedEntries}
          unstaged={unstagedEntries}
          commits={commitsQuery.data?.commits ?? []}
          selectedCommitHash={selectedCommitHash}
          onSelectCommit={selectCommit}
          commitFiles={commitFileEntries}
          selectedPreview={selectedGitPreview}
          onSelectFile={selectGitFile}
          selectedFilePaths={selectedGitFilePaths}
          onToggleFileSelection={toggleSelectedGitFilePath}
          onBatchToggleFiles={batchToggleGitFiles}
          reviewStatusLoading={reviewStatusQuery.isLoading}
          reviewStatusError={reviewStatusError}
          commitsLoading={commitsQuery.isLoading}
          commitsError={commitsError}
          commitFilesLoading={commitFilesQuery.isLoading}
          commitFilesError={commitFilesError}
          diffPatch={gitFileDiffQuery.data?.patch}
          diffLoading={gitFileDiffQuery.isLoading}
          diffError={gitFileDiffError}
          diffRenderMode={diffRenderMode}
          diffWordWrap={diffWordWrap}
          resolvedTheme={resolvedTheme as DiffThemeType}
          colorScheme={colorScheme}
          patchViewportRef={patchViewportRef}
          onOpenFileInEditor={openDiffFileInEditor}
        />
      )}
    </DiffPanelShell>
  );
}
