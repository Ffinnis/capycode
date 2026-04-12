import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { scopeThreadRef } from "@capycode/client-runtime";
import type { GitChangedFile, GitDiffCategory, TurnId } from "@capycode/contracts";
import type { DiffPanelMode as ClientDiffPanelMode } from "@capycode/contracts/settings";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  GitCommitHorizontalIcon,
  Rows3Icon,
  TextWrapIcon,
} from "lucide-react";
import {
  type RefObject,
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
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import {
  gitCommitFilesQueryOptions,
  gitFileDiffQueryOptions,
  gitListCommitsQueryOptions,
  gitReviewStatusQueryOptions,
} from "~/lib/gitReactQuery";
import { cn } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { resolvePathLinkTarget } from "../terminal-links";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useTheme } from "../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { buildPatchCacheKey, resolveDiffThemeName } from "../lib/diffRendering";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { formatShortTimestamp } from "../timestampFormat";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
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

function formatGitFileStatus(status: GitChangedFile["status"]): string {
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

function renderChangeCount(additions: number, deletions: number) {
  if (additions === 0 && deletions === 0) {
    return "0";
  }
  return `+${additions} / -${deletions}`;
}

function GitFileRow(props: {
  entry: GitFileListEntry;
  selected: boolean;
  onSelect: (selection: GitPreviewSelection) => void;
}) {
  const { entry, selected, onSelect } = props;
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-border bg-accent text-accent-foreground"
          : "border-border/60 bg-background/40 hover:border-border hover:bg-accent/40",
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
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[11px]">{entry.file.path}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground/80">
          <span>{formatGitFileStatus(entry.file.status)}</span>
          {entry.file.oldPath ? <span>{entry.file.oldPath}</span> : null}
          <span>{entry.label}</span>
        </div>
      </div>
      <div className="shrink-0 text-[10px] text-muted-foreground/75">
        {renderChangeCount(entry.file.additions, entry.file.deletions)}
      </div>
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
        "flex w-full items-start gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
        props.selected
          ? "border-border bg-accent text-accent-foreground"
          : "border-border/60 bg-background/40 hover:border-border hover:bg-accent/40",
      )}
      onClick={props.onSelect}
      data-testid={`git-commit-row-${props.hash}`}
    >
      <GitCommitHorizontalIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium">{props.message || props.shortHash}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground/75">
          <span className="font-mono">{props.shortHash}</span>
          <span>{props.author}</span>
          <span>{formatShortTimestamp(props.date, "locale")}</span>
        </div>
      </div>
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
                  theme: resolveDiffThemeName(props.resolvedTheme),
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
  selectedTurn: {
    turnId: TurnId;
    completedAt: string;
    checkpointTurnCount?: number | undefined;
  } | undefined;
  settingsTimestampFormat: "locale" | "12-hour" | "24-hour";
  onSelectTurn: (turnId: TurnId) => void;
  onSelectWholeConversation: () => void;
  patch: string | undefined;
  isLoading: boolean;
  error: string | null;
  diffRenderMode: DiffRenderMode;
  diffWordWrap: boolean;
  resolvedTheme: DiffThemeType;
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
  isGitRepo: boolean;
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
  ) => (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">
          {title}
        </h3>
        <span className="text-[10px] text-muted-foreground/60">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-[11px] text-muted-foreground/70">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-1.5">
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
              onSelect={props.onSelectFile}
            />
          ))}
        </div>
      )}
    </section>
  );

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
      <div className="grid shrink-0 gap-2 border-b border-border/70 px-3 py-2 sm:grid-cols-2">
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
            <div className="space-y-4">
              {renderFileSection("Staged", props.staged, "No staged changes.")}
              {renderFileSection("Unstaged", props.unstaged, "No unstaged changes.")}
            </div>
          ) : (
            <div className="space-y-4">
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">
                    Ahead of {props.baseBranch ?? "base"}
                  </h3>
                  <span className="text-[10px] text-muted-foreground/60">{props.commits.length}</span>
                </div>
                {props.commits.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-[11px] text-muted-foreground/70">
                    No commits ahead of the selected base branch.
                  </div>
                ) : (
                  <div className="space-y-1.5">
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
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">
                      Commit files
                    </h3>
                    <span className="text-[10px] text-muted-foreground/60">
                      {props.commitFiles.length}
                    </span>
                  </div>
                  {props.commitFilesLoading ? (
                    <DiffPanelLoadingState label="Loading commit files..." />
                  ) : props.commitFilesError ? (
                    <div className="rounded-md border border-red-500/30 bg-red-500/6 px-3 py-2 text-[11px] text-red-500/85">
                      {props.commitFilesError}
                    </div>
                  ) : props.commitFiles.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-[11px] text-muted-foreground/70">
                      This commit does not change any files.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
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
  const { resolvedTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("stacked");
  const [diffWordWrap, setDiffWordWrap] = useState(settings.diffWordWrap);
  const [panelMode, setPanelMode] = useState<ClientDiffPanelMode>(settings.diffPanelMode);
  const [gitFilterMode, setGitFilterMode] = useState<GitFilterMode>("all-changes");
  const [selectedGitBaseBranch, setSelectedGitBaseBranch] = useState<string | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [selectedGitPreview, setSelectedGitPreview] = useState<GitPreviewSelection | null>(null);
  const patchViewportRef = useRef<HTMLDivElement>(null);
  const previousDiffOpenRef = useRef(false);
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const diffSearch = useSearch({ strict: false, select: (search) => parseDiffRouteSearch(search) });
  const diffOpen = diffSearch.diff === "1";
  const activeThreadId = routeThreadRef?.threadId ?? null;
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
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
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
  const activeCheckpointRange = selectedTurn ? selectedCheckpointRange : conversationCheckpointRange;
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
    if (diffOpen && !previousDiffOpenRef.current) {
      setDiffWordWrap(settings.diffWordWrap);
      setPanelMode(settings.diffPanelMode);
    }
    previousDiffOpenRef.current = diffOpen;
  }, [diffOpen, settings.diffPanelMode, settings.diffWordWrap]);

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
    selectedGitBaseBranch ?? reviewStatusQuery.data?.baseBranch ?? commitsQuery.data?.baseBranch ?? null;
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
    [reviewStatusQuery.data?.againstBase, reviewStatusQuery.data?.staged, reviewStatusQuery.data?.unstaged],
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

  const selectPanelMode = useCallback(
    (nextMode: ClientDiffPanelMode) => {
      setPanelMode(nextMode);
      updateSettings({ diffPanelMode: nextMode });
    },
    [updateSettings],
  );

  const selectGitBaseBranch = useCallback((branch: string) => {
    startTransition(() => {
      setSelectedGitBaseBranch(branch);
      setSelectedCommitHash(null);
      setSelectedGitPreview(null);
    });
  }, []);

  const selectGitFilterMode = useCallback((nextMode: GitFilterMode) => {
    startTransition(() => {
      setGitFilterMode(nextMode);
      setSelectedCommitHash(null);
      setSelectedGitPreview(null);
    });
  }, []);

  const selectCommit = useCallback((hash: string) => {
    startTransition(() => {
      setSelectedCommitHash(hash);
      setSelectedGitPreview(null);
    });
  }, []);

  const selectGitFile = useCallback((selection: GitPreviewSelection) => {
    startTransition(() => {
      setSelectedGitPreview(selection);
    });
  }, []);

  const showDiffRenderControls = panelMode === "iterations" || selectedGitPreview !== null;
  const modeToggleValue = [panelMode];
  const headerRow = (
    <>
      <ToggleGroup
        className="shrink-0"
        variant="outline"
        size="xs"
        value={modeToggleValue}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "iterations" || next === "git") {
            selectPanelMode(next);
          }
        }}
      >
        <Toggle aria-label="Iterations diff mode" value="iterations">
          Iterations
        </Toggle>
        <Toggle aria-label="Git diff mode" value="git">
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
          selectedFilePath={selectedFilePath}
          patchViewportRef={patchViewportRef}
          onOpenFileInEditor={openDiffFileInEditor}
        />
      ) : (
        <GitDiffView
          hasActiveThread={Boolean(activeThread)}
          activeCwd={activeCwd}
          isGitRepo={reviewStatusQuery.data?.isRepo ?? isGitRepo}
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
          patchViewportRef={patchViewportRef}
          onOpenFileInEditor={openDiffFileInEditor}
        />
      )}
    </DiffPanelShell>
  );
}
