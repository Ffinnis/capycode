import {
  type EnvironmentId,
  type GitActionProgressEvent,
  type GitStackedAction,
} from "@capycode/contracts";
import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { ensureEnvironmentApi } from "../environmentApi";
import { requireEnvironmentConnection } from "../environments/runtime";

const GIT_BRANCHES_STALE_TIME_MS = 15_000;
const GIT_BRANCHES_REFETCH_INTERVAL_MS = 60_000;
const GIT_BRANCHES_PAGE_SIZE = 100;

export const gitQueryKeys = {
  all: ["git"] as const,
  scope: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", environmentId ?? null, cwd] as const,
  repositories: (environmentId: EnvironmentId | null, cwd: string | null) =>
    [...gitQueryKeys.scope(environmentId, cwd), "repositories"] as const,
  branches: (environmentId: EnvironmentId | null, cwd: string | null) =>
    [...gitQueryKeys.scope(environmentId, cwd), "branches"] as const,
  branchSearch: (environmentId: EnvironmentId | null, cwd: string | null, query: string) =>
    [...gitQueryKeys.branches(environmentId, cwd), "search", query] as const,
  reviewStatus: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    baseBranch: string | null,
  ) => [...gitQueryKeys.scope(environmentId, cwd), "review-status", baseBranch] as const,
  commits: (environmentId: EnvironmentId | null, cwd: string | null, baseBranch: string | null) =>
    [...gitQueryKeys.scope(environmentId, cwd), "commits", baseBranch] as const,
  commitFiles: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    commitHash: string | null,
  ) => [...gitQueryKeys.scope(environmentId, cwd), "commit-files", commitHash] as const,
  fileDiff: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    params: {
      path: string | null;
      oldPath: string | null;
      category: string | null;
      baseBranch: string | null;
      commitHash: string | null;
    },
  ) =>
    [
      ...gitQueryKeys.scope(environmentId, cwd),
      "file-diff",
      params.category,
      params.baseBranch,
      params.commitHash,
      params.oldPath,
      params.path,
    ] as const,
};

export const gitMutationKeys = {
  init: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", "mutation", "init", environmentId ?? null, cwd] as const,
  checkout: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", "mutation", "checkout", environmentId ?? null, cwd] as const,
  runStackedAction: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", "mutation", "run-stacked-action", environmentId ?? null, cwd] as const,
  pull: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", "mutation", "pull", environmentId ?? null, cwd] as const,
};

export function invalidateGitQueries(
  queryClient: QueryClient,
  input?: { environmentId?: EnvironmentId | null; cwd?: string | null },
) {
  const environmentId = input?.environmentId ?? null;
  const cwd = input?.cwd ?? null;
  if (cwd !== null) {
    return queryClient.invalidateQueries({ queryKey: gitQueryKeys.scope(environmentId, cwd) });
  }

  return queryClient.invalidateQueries({ queryKey: gitQueryKeys.all });
}

export function gitBranchSearchInfiniteQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  query: string;
  enabled?: boolean;
}) {
  const normalizedQuery = input.query.trim();

  return infiniteQueryOptions({
    queryKey: gitQueryKeys.branchSearch(input.environmentId, input.cwd, normalizedQuery),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!input.cwd) throw new Error("Git branches are unavailable.");
      if (!input.environmentId) throw new Error("Git branches are unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.listBranches({
        cwd: input.cwd,
        ...(normalizedQuery.length > 0 ? { query: normalizedQuery } : {}),
        cursor: pageParam,
        limit: GIT_BRANCHES_PAGE_SIZE,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: input.cwd !== null && (input.enabled ?? true),
    staleTime: GIT_BRANCHES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_BRANCHES_REFETCH_INTERVAL_MS,
  });
}

export function gitListRepositoriesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.repositories(input.environmentId, input.cwd),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Git repositories are unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.listRepositories({ cwd: input.cwd });
    },
    enabled: input.environmentId !== null && input.cwd !== null && (input.enabled ?? true),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function gitReviewStatusQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  baseBranch: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.reviewStatus(input.environmentId, input.cwd, input.baseBranch),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Git review status is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.getReviewStatus({
        cwd: input.cwd,
        ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
      });
    },
    enabled: input.environmentId !== null && input.cwd !== null && (input.enabled ?? true),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function gitListCommitsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  baseBranch: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.commits(input.environmentId, input.cwd, input.baseBranch),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Git commit history is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.listCommits({
        cwd: input.cwd,
        ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
      });
    },
    enabled: input.environmentId !== null && input.cwd !== null && (input.enabled ?? true),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function gitCommitFilesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  commitHash: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.commitFiles(input.environmentId, input.cwd, input.commitHash),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || !input.commitHash) {
        throw new Error("Commit files are unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.getCommitFiles({
        cwd: input.cwd,
        commitHash: input.commitHash,
      });
    },
    enabled:
      input.environmentId !== null &&
      input.cwd !== null &&
      input.commitHash !== null &&
      (input.enabled ?? true),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitFileDiffQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  path: string | null;
  oldPath?: string | null;
  category: "against-base" | "staged" | "unstaged" | "committed" | null;
  baseBranch?: string | null;
  commitHash?: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.fileDiff(input.environmentId, input.cwd, {
      path: input.path,
      oldPath: input.oldPath ?? null,
      category: input.category,
      baseBranch: input.baseBranch ?? null,
      commitHash: input.commitHash ?? null,
    }),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || !input.path || !input.category) {
        throw new Error("File diff is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.getFileDiff({
        cwd: input.cwd,
        path: input.path,
        ...(input.oldPath ? { oldPath: input.oldPath } : {}),
        category: input.category,
        ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
        ...(input.commitHash ? { commitHash: input.commitHash } : {}),
      });
    },
    enabled:
      input.environmentId !== null &&
      input.cwd !== null &&
      input.path !== null &&
      input.category !== null &&
      (input.enabled ?? true),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function gitInitMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.init(input.environmentId, input.cwd),
    mutationFn: async () => {
      if (!input.cwd || !input.environmentId) throw new Error("Git init is unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.init({ cwd: input.cwd });
    },
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient, {
        environmentId: input.environmentId,
        cwd: input.cwd,
      });
    },
  });
}

export function gitCheckoutMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.checkout(input.environmentId, input.cwd),
    mutationFn: async (branch: string) => {
      if (!input.cwd || !input.environmentId) throw new Error("Git checkout is unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.checkout({ cwd: input.cwd, branch });
    },
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient, {
        environmentId: input.environmentId,
        cwd: input.cwd,
      });
    },
  });
}

export function gitRunStackedActionMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.runStackedAction(input.environmentId, input.cwd),
    mutationFn: async ({
      actionId,
      action,
      commitMessage,
      featureBranch,
      filePaths,
      onProgress,
    }: {
      actionId: string;
      action: GitStackedAction;
      commitMessage?: string;
      featureBranch?: boolean;
      filePaths?: string[];
      onProgress?: (event: GitActionProgressEvent) => void;
    }) => {
      if (!input.cwd || !input.environmentId) throw new Error("Git action is unavailable.");
      return requireEnvironmentConnection(input.environmentId).client.git.runStackedAction(
        {
          action,
          actionId,
          cwd: input.cwd,
          ...(commitMessage ? { commitMessage } : {}),
          ...(featureBranch ? { featureBranch: true } : {}),
          ...(filePaths && filePaths.length > 0 ? { filePaths } : {}),
        },
        ...(onProgress ? [{ onProgress }] : []),
      );
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient, {
        environmentId: input.environmentId,
        cwd: input.cwd,
      });
    },
  });
}

export function gitPullMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.pull(input.environmentId, input.cwd),
    mutationFn: async () => {
      if (!input.cwd || !input.environmentId) throw new Error("Git pull is unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.pull({ cwd: input.cwd });
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient, {
        environmentId: input.environmentId,
        cwd: input.cwd,
      });
    },
  });
}

export function gitCreateWorktreeMutationOptions(input: {
  environmentId: EnvironmentId | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: ["git", "mutation", "create-worktree", input.environmentId ?? null] as const,
    mutationFn: (
      args: Parameters<ReturnType<typeof ensureEnvironmentApi>["git"]["createWorktree"]>[0],
    ) => {
      if (!input.environmentId) {
        throw new Error("Worktree creation is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).git.createWorktree(args);
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient, { environmentId: input.environmentId });
    },
  });
}

export function gitRemoveWorktreeMutationOptions(input: {
  environmentId: EnvironmentId | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: ["git", "mutation", "remove-worktree", input.environmentId ?? null] as const,
    mutationFn: (
      args: Parameters<ReturnType<typeof ensureEnvironmentApi>["git"]["removeWorktree"]>[0],
    ) => {
      if (!input.environmentId) {
        throw new Error("Worktree removal is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).git.removeWorktree(args);
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient, { environmentId: input.environmentId });
    },
  });
}
