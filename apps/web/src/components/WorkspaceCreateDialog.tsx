"use client";

import type { EnvironmentId, GitBranch, ProjectId } from "@capycode/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  GitBranchIcon,
  Loader2Icon,
  PlusIcon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { readEnvironmentApi } from "~/environmentApi";
import { cn } from "~/lib/utils";
import { gitBranchSearchInfiniteQueryOptions } from "~/lib/gitReactQuery";
import { useGitStatus } from "~/lib/gitStatusState";

import {
  buildWorkspaceCreateSubmission,
  createInitialWorkspaceCreateDraft,
  deriveWorkspaceAutoName,
  resolveWorkspaceCreateDefaultBranch,
  type WorkspaceCreateDialogMode,
  type WorkspaceCreateDraft,
} from "./WorkspaceCreateDialog.logic";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "./ui/combobox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

interface WorkspaceCreateDialogProject {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly cwd: string;
}

interface WorkspaceCreateDialogProps {
  readonly open: boolean;
  readonly mode: WorkspaceCreateDialogMode;
  readonly project: WorkspaceCreateDialogProject;
  readonly activeWorkspaceBranch: string | null;
  readonly threadBranch: string | null;
  readonly workspaceCount: number;
  readonly onCreated: () => Promise<void>;
  readonly onOpenChange: (open: boolean) => void;
}

export function WorkspaceCreateDialog({
  open,
  mode,
  project,
  activeWorkspaceBranch,
  threadBranch,
  workspaceCount,
  onCreated,
  onOpenChange,
}: WorkspaceCreateDialogProps) {
  const queryClient = useQueryClient();
  const gitStatus = useGitStatus({ environmentId: project.environmentId, cwd: project.cwd });

  const [branchQuery, setBranchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkspaceCreateDraft>(() =>
    createInitialWorkspaceCreateDraft({ mode, defaultBranch: "main" }),
  );

  const deferredBranchQuery = useDeferredValue(branchQuery.trim());
  const branchQueryResult = useInfiniteQuery(
    gitBranchSearchInfiniteQueryOptions({
      environmentId: project.environmentId,
      cwd: project.cwd,
      query: deferredBranchQuery,
      enabled: open,
    }),
  );
  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending: isBranchesPending,
  } = branchQueryResult;

  const branches = useMemo(
    () => branchQueryResult.data?.pages.flatMap((page) => page.branches) ?? [],
    [branchQueryResult.data?.pages],
  );
  const currentGitBranch = gitStatus.data?.branch ?? null;
  const defaultBranch = useMemo(
    () =>
      resolveWorkspaceCreateDefaultBranch({
        activeWorkspaceBranch,
        threadBranch,
        currentGitBranch,
        branches,
      }),
    [activeWorkspaceBranch, branches, currentGitBranch, threadBranch],
  );
  const previousDefaultBranchRef = useRef(defaultBranch);

  const derivedAutoName = useMemo(
    () =>
      deriveWorkspaceAutoName({
        mode,
        branchName: mode === "worktree" ? draft.branchName : (draft.selectedBranch ?? ""),
        projectName: project.name,
        workspaceCount,
      }),
    [mode, draft.branchName, draft.selectedBranch, project.name, workspaceCount],
  );

  const resetSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      resetSignatureRef.current = null;
      previousDefaultBranchRef.current = defaultBranch;
      return;
    }

    const resetSignature = `${project.environmentId}:${project.id}:${mode}`;
    if (resetSignatureRef.current === resetSignature) {
      return;
    }

    resetSignatureRef.current = resetSignature;
    previousDefaultBranchRef.current = defaultBranch;
    setDraft(createInitialWorkspaceCreateDraft({ mode, defaultBranch }));
    setBranchQuery("");
    setSubmitError(null);
    void queryClient.prefetchInfiniteQuery(
      gitBranchSearchInfiniteQueryOptions({
        environmentId: project.environmentId,
        cwd: project.cwd,
        query: "",
      }),
    );
  }, [defaultBranch, mode, open, project.cwd, project.environmentId, project.id, queryClient]);

  useEffect(() => {
    if (!open) {
      previousDefaultBranchRef.current = defaultBranch;
      return;
    }

    const previousDefaultBranch = previousDefaultBranchRef.current;
    previousDefaultBranchRef.current = defaultBranch;
    if (previousDefaultBranch === defaultBranch) {
      return;
    }

    setDraft((current) => {
      if (
        current.mode === "worktree" &&
        (current.baseBranch === null || current.baseBranch === previousDefaultBranch)
      ) {
        return { ...current, baseBranch: defaultBranch };
      }

      if (
        current.mode === "branch" &&
        (current.selectedBranch === null || current.selectedBranch === previousDefaultBranch)
      ) {
        return { ...current, selectedBranch: defaultBranch };
      }

      return current;
    });
  }, [defaultBranch, open]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const api = readEnvironmentApi(project.environmentId);
    if (!api) {
      setSubmitError("Workspace API unavailable.");
      return;
    }

    const submission = buildWorkspaceCreateSubmission({
      draft,
      projectId: project.id,
      projectName: project.name,
      workspaceCount,
    });
    if (!submission.ok) {
      setSubmitError(submission.error);
      return;
    }

    setIsSubmitting(true);
    try {
      await api.workspaces.create(submission.payload);
      onOpenChange(false);

      try {
        await onCreated();
      } catch (error) {
        setSubmitError(
          error instanceof Error ? error.message : "Failed to refresh after creation.",
        );
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to create workspace.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton={false}>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{mode === "worktree" ? "Create worktree" : "Switch branch"}</DialogTitle>
            <DialogDescription>{project.name}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Workspace name
                {!draft.workspaceName.trim() && (
                  <span className="ml-1.5 font-normal text-muted-foreground/60">
                    → {derivedAutoName}
                  </span>
                )}
              </span>
              <Input
                aria-label="Workspace name"
                autoFocus
                placeholder={derivedAutoName}
                value={draft.workspaceName}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, workspaceName: event.target.value }));
                  setSubmitError(null);
                }}
              />
            </label>

            {mode === "worktree" ? (
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">Branch name</span>
                <Input
                  aria-label="Branch name"
                  className="font-mono"
                  placeholder="feature/new-workspace"
                  value={draft.branchName}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, branchName: event.target.value }));
                    setSubmitError(null);
                  }}
                />
              </label>
            ) : null}

            <WorkspaceBranchPicker
              branches={branches}
              fetchNextPage={fetchNextPage}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              isPending={isBranchesPending}
              label={mode === "worktree" ? "From branch" : "Branch"}
              placeholder={mode === "worktree" ? "Select base branch" : "Select branch"}
              query={branchQuery}
              selectedBranch={mode === "worktree" ? draft.baseBranch : draft.selectedBranch}
              onQueryChange={(value) => {
                setBranchQuery(value);
                setSubmitError(null);
              }}
              onSelect={(branch) => {
                setDraft((current) =>
                  current.mode === "worktree"
                    ? { ...current, baseBranch: branch }
                    : { ...current, selectedBranch: branch },
                );
                setBranchQuery("");
                setSubmitError(null);
              }}
            />

            {submitError ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">{submitError}</p>
              </div>
            ) : null}
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" className="min-w-32" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <PlusIcon className="size-4" />
                  Create workspace
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function WorkspaceBranchPicker(input: {
  readonly branches: ReadonlyArray<GitBranch>;
  readonly fetchNextPage: () => Promise<unknown>;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isPending: boolean;
  readonly label: string;
  readonly placeholder: string;
  readonly query: string;
  readonly selectedBranch: string | null;
  readonly onQueryChange: (value: string) => void;
  readonly onSelect: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const branchListScrollElementRef = useRef<HTMLDivElement | null>(null);
  const branchStatusText = input.isPending
    ? "Loading branches..."
    : input.isFetchingNextPage
      ? "Loading more branches..."
      : input.hasNextPage
        ? `Showing ${input.branches.length} branches`
        : input.branches.length > 0
          ? `Showing ${input.branches.length} branches`
          : "";

  const maybeFetchNextBranchPage = useCallback(() => {
    if (!open || !input.hasNextPage || input.isFetchingNextPage) {
      return;
    }

    const scrollElement = branchListScrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const distanceFromBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
    if (distanceFromBottom > 96) {
      return;
    }

    void input.fetchNextPage().catch(() => undefined);
  }, [input, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const scrollElement = branchListScrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const handleScroll = () => {
      maybeFetchNextBranchPage();
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [maybeFetchNextBranchPage, open]);

  useEffect(() => {
    maybeFetchNextBranchPage();
  }, [input.branches.length, maybeFetchNextBranchPage]);

  const setBranchListRef = useCallback((element: HTMLDivElement | null) => {
    branchListScrollElementRef.current = (element?.parentElement as HTMLDivElement | null) ?? null;
  }, []);

  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground">{input.label}</span>
      <Combobox
        items={input.branches.map((branch) => branch.name)}
        filteredItems={input.branches.map((branch) => branch.name)}
        autoHighlight
        open={open}
        value={input.selectedBranch ?? ""}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            input.onQueryChange("");
          }
        }}
      >
        <ComboboxTrigger
          aria-label={input.label}
          className="w-full justify-between"
          render={<Button variant="outline" />}
        >
          <span
            className={cn(
              "truncate text-left",
              input.selectedBranch
                ? "font-mono text-[13px] text-foreground"
                : "text-muted-foreground",
            )}
          >
            {input.selectedBranch ?? input.placeholder}
          </span>
          <ChevronDownIcon />
        </ComboboxTrigger>
        <ComboboxPopup className="w-(--anchor-width)">
          <div className="border-b p-1">
            <ComboboxInput
              className="[&_input]:font-sans rounded-md"
              inputClassName="ring-0"
              placeholder="Search branches..."
              showTrigger={false}
              size="sm"
              value={input.query}
              onChange={(event) => input.onQueryChange(event.target.value)}
            />
          </div>
          <ComboboxEmpty>No branches found.</ComboboxEmpty>
          <ComboboxList ref={setBranchListRef} className="max-h-56">
            {input.branches.map((branch, index) => {
              const badge = branch.current
                ? "current"
                : branch.isDefault
                  ? "default"
                  : branch.isRemote
                    ? "remote"
                    : null;
              return (
                <ComboboxItem
                  hideIndicator
                  key={branch.name}
                  index={index}
                  value={branch.name}
                  onClick={() => {
                    input.onSelect(branch.name);
                    setOpen(false);
                  }}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <GitBranchIcon
                        className={cn(
                          "size-3.5 shrink-0",
                          branch.current
                            ? "text-emerald-500"
                            : branch.isDefault
                              ? "text-primary/70"
                              : "opacity-40",
                        )}
                      />
                      <span className="truncate font-mono text-[13px]">{branch.name}</span>
                    </span>
                    {badge ? (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          badge === "current" &&
                            "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
                          badge === "default" && "bg-primary/10 text-primary",
                          badge === "remote" && "bg-muted text-muted-foreground",
                        )}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </div>
                </ComboboxItem>
              );
            })}
          </ComboboxList>
          {branchStatusText ? <ComboboxStatus>{branchStatusText}</ComboboxStatus> : null}
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}
