"use client";

import type { EnvironmentId, ProjectId } from "@capycode/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircleIcon, GitBranchIcon, Loader2Icon } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { readEnvironmentApi } from "~/environmentApi";
import { gitBranchSearchInfiniteQueryOptions } from "~/lib/gitReactQuery";
import { useGitStatus } from "~/lib/gitStatusState";

import {
  buildWorkspaceCreateSubmission,
  createInitialWorkspaceCreateDraft,
  deriveWorkspaceAutoName,
  resolveWorkspaceCreateDefaultBranch,
  type WorkspaceCreateDraft,
} from "./WorkspaceCreateDialog.logic";
import { GitBranchPicker } from "./GitBranchPicker";
import { Button } from "./ui/button";
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
  readonly project: WorkspaceCreateDialogProject;
  readonly activeWorkspaceBranch: string | null;
  readonly threadBranch: string | null;
  readonly workspaceCount: number;
  readonly onCreated: () => Promise<void>;
  readonly onOpenChange: (open: boolean) => void;
}

export function WorkspaceCreateDialog({
  open,
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
    createInitialWorkspaceCreateDraft({ defaultBranch: "main" }),
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
  const resetSignatureRef = useRef<string | null>(null);

  const derivedAutoName = useMemo(
    () =>
      deriveWorkspaceAutoName({
        branchName: draft.branchName,
        workspaceCount,
      }),
    [draft.branchName, workspaceCount],
  );

  useEffect(() => {
    if (!open) {
      resetSignatureRef.current = null;
      previousDefaultBranchRef.current = defaultBranch;
      return;
    }

    const resetSignature = `${project.environmentId}:${project.id}:worktree-create`;
    if (resetSignatureRef.current === resetSignature) {
      return;
    }

    resetSignatureRef.current = resetSignature;
    previousDefaultBranchRef.current = defaultBranch;
    setDraft(createInitialWorkspaceCreateDraft({ defaultBranch }));
    setBranchQuery("");
    setSubmitError(null);
    void queryClient.prefetchInfiniteQuery(
      gitBranchSearchInfiniteQueryOptions({
        environmentId: project.environmentId,
        cwd: project.cwd,
        query: "",
      }),
    );
  }, [defaultBranch, open, project.cwd, project.environmentId, project.id, queryClient]);

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
      if (current.baseBranch === null || current.baseBranch === previousDefaultBranch) {
        return { ...current, baseBranch: defaultBranch };
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
            <DialogTitle>Create worktree</DialogTitle>
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

            <GitBranchPicker
              branches={branches}
              fetchNextPage={fetchNextPage}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              isPending={isBranchesPending}
              label="From branch"
              placeholder="Select base branch"
              query={branchQuery}
              selectedBranch={draft.baseBranch}
              onQueryChange={(value) => {
                setBranchQuery(value);
                setSubmitError(null);
              }}
              onSelect={(branch) => {
                setDraft((current) => ({ ...current, baseBranch: branch }));
                setBranchQuery("");
                setSubmitError(null);
              }}
            />

            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <GitBranchIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                Current branch:{" "}
                <span className="font-mono text-foreground">{currentGitBranch ?? "Unknown"}</span>
              </span>
            </div>

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
                  <GitBranchIcon className="size-4" />
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
