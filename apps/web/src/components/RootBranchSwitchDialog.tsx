"use client";

import type { EnvironmentId, ProjectId } from "@capycode/contracts";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircleIcon, GitBranchIcon, Loader2Icon } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  gitBranchSearchInfiniteQueryOptions,
  gitCheckoutMutationOptions,
} from "~/lib/gitReactQuery";

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

interface RootBranchSwitchDialogProject {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly cwd: string;
}

interface RootBranchSwitchDialogProps {
  readonly open: boolean;
  readonly project: RootBranchSwitchDialogProject;
  readonly currentBranch: string | null;
  readonly onSwitched: () => Promise<void>;
  readonly onOpenChange: (open: boolean) => void;
}

export function RootBranchSwitchDialog({
  open,
  project,
  currentBranch,
  onSwitched,
  onOpenChange,
}: RootBranchSwitchDialogProps) {
  const queryClient = useQueryClient();
  const [branchQuery, setBranchQuery] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(currentBranch);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const deferredBranchQuery = useDeferredValue(branchQuery.trim());
  const checkoutMutation = useMutation(
    gitCheckoutMutationOptions({
      environmentId: project.environmentId,
      cwd: project.cwd,
      queryClient,
    }),
  );

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
  const defaultBranch = useMemo(
    () =>
      currentBranch ??
      branches.find((branch) => branch.isDefault)?.name ??
      branches[0]?.name ??
      null,
    [branches, currentBranch],
  );
  const previousDefaultBranchRef = useRef<string | null>(defaultBranch);
  const resetSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      resetSignatureRef.current = null;
      previousDefaultBranchRef.current = defaultBranch;
      return;
    }

    const resetSignature = `${project.environmentId}:${project.id}:root-branch-switch`;
    if (resetSignatureRef.current === resetSignature) {
      return;
    }

    resetSignatureRef.current = resetSignature;
    previousDefaultBranchRef.current = defaultBranch;
    setSelectedBranch(defaultBranch);
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

    setSelectedBranch((current) =>
      current === null || current === previousDefaultBranch ? defaultBranch : current,
    );
  }, [defaultBranch, open]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const nextBranch = selectedBranch?.trim() ?? "";
    if (!nextBranch) {
      setSubmitError("Select a branch.");
      return;
    }

    if (nextBranch === currentBranch) {
      onOpenChange(false);
      return;
    }

    try {
      await checkoutMutation.mutateAsync(nextBranch);
      onOpenChange(false);
      await onSwitched();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to switch branch.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!checkoutMutation.isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton={false}>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Switch branch</DialogTitle>
            <DialogDescription>{project.name}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <GitBranchIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                Current branch:{" "}
                <span className="font-mono text-foreground">{currentBranch ?? "Unknown"}</span>
              </span>
            </div>

            <GitBranchPicker
              branches={branches}
              fetchNextPage={fetchNextPage}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              isPending={isBranchesPending}
              label="Branch"
              placeholder="Select branch"
              query={branchQuery}
              selectedBranch={selectedBranch}
              onQueryChange={(value) => {
                setBranchQuery(value);
                setSubmitError(null);
              }}
              onSelect={(branch) => {
                setSelectedBranch(branch);
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
              disabled={checkoutMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" className="min-w-32" disabled={checkoutMutation.isPending}>
              {checkoutMutation.isPending ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Switching...
                </>
              ) : (
                <>
                  <GitBranchIcon className="size-4" />
                  Switch branch
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
