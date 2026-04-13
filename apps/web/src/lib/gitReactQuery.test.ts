import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("../environmentApi", () => ({
  ensureEnvironmentApi: vi.fn(),
}));

vi.mock("../environments/runtime", () => ({
  requireEnvironmentConnection: vi.fn(() => ({
    client: {
      git: {
        runStackedAction: vi.fn(),
      },
    },
  })),
}));

import type { InfiniteData } from "@tanstack/react-query";
import {
  EnvironmentId,
  type GitGetCommitFilesResult,
  type GitGetFileDiffResult,
  type GitListBranchesResult,
  type GitListCommitsResult,
  type GitReviewStatusResult,
} from "@capycode/contracts";
import { ensureEnvironmentApi } from "../environmentApi";

import {
  gitBranchSearchInfiniteQueryOptions,
  gitCommitFilesQueryOptions,
  gitFileDiffQueryOptions,
  gitListCommitsQueryOptions,
  gitMutationKeys,
  gitPreparePullRequestThreadMutationOptions,
  gitPullMutationOptions,
  gitReviewStatusQueryOptions,
  gitRunStackedActionMutationOptions,
  gitQueryKeys,
  invalidateGitQueries,
} from "./gitReactQuery";

const BRANCH_QUERY_RESULT: GitListBranchesResult = {
  branches: [],
  isRepo: true,
  hasOriginRemote: true,
  nextCursor: null,
  totalCount: 0,
};

const BRANCH_SEARCH_RESULT: InfiniteData<GitListBranchesResult, number> = {
  pages: [BRANCH_QUERY_RESULT],
  pageParams: [0],
};
const ENVIRONMENT_A = EnvironmentId.make("environment-a");
const ENVIRONMENT_B = EnvironmentId.make("environment-b");

const REVIEW_STATUS_RESULT: GitReviewStatusResult = {
  isRepo: true,
  branch: "feature/diff-panel",
  baseBranch: "main",
  baseBranchOptions: ["main"],
  againstBase: [],
  staged: [],
  unstaged: [],
};

const COMMITS_RESULT: GitListCommitsResult = {
  baseBranch: "main",
  commits: [],
};

const COMMIT_FILES_RESULT: GitGetCommitFilesResult = {
  files: [],
};

const FILE_DIFF_RESULT: GitGetFileDiffResult = {
  patch: "",
};

describe("gitMutationKeys", () => {
  it("scopes stacked action keys by cwd", () => {
    expect(gitMutationKeys.runStackedAction(ENVIRONMENT_A, "/repo/a")).not.toEqual(
      gitMutationKeys.runStackedAction(ENVIRONMENT_A, "/repo/b"),
    );
  });

  it("scopes pull keys by cwd", () => {
    expect(gitMutationKeys.pull(ENVIRONMENT_A, "/repo/a")).not.toEqual(
      gitMutationKeys.pull(ENVIRONMENT_A, "/repo/b"),
    );
  });

  it("scopes pull request thread preparation keys by cwd", () => {
    expect(gitMutationKeys.preparePullRequestThread(ENVIRONMENT_A, "/repo/a")).not.toEqual(
      gitMutationKeys.preparePullRequestThread(ENVIRONMENT_A, "/repo/b"),
    );
  });
});

describe("git mutation options", () => {
  const queryClient = new QueryClient();

  it("attaches cwd-scoped mutation key for runStackedAction", () => {
    const options = gitRunStackedActionMutationOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      queryClient,
    });
    expect(options.mutationKey).toEqual(gitMutationKeys.runStackedAction(ENVIRONMENT_A, "/repo/a"));
  });

  it("attaches cwd-scoped mutation key for pull", () => {
    const options = gitPullMutationOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      queryClient,
    });
    expect(options.mutationKey).toEqual(gitMutationKeys.pull(ENVIRONMENT_A, "/repo/a"));
  });

  it("attaches cwd-scoped mutation key for preparePullRequestThread", () => {
    const options = gitPreparePullRequestThreadMutationOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      queryClient,
    });
    expect(options.mutationKey).toEqual(
      gitMutationKeys.preparePullRequestThread(ENVIRONMENT_A, "/repo/a"),
    );
  });
});

describe("invalidateGitQueries", () => {
  it("can invalidate a single cwd without blasting other git query scopes", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(
      gitBranchSearchInfiniteQueryOptions({
        environmentId: ENVIRONMENT_A,
        cwd: "/repo/a",
        query: "feature",
      }).queryKey,
      BRANCH_SEARCH_RESULT,
    );
    queryClient.setQueryData(
      gitBranchSearchInfiniteQueryOptions({
        environmentId: ENVIRONMENT_B,
        cwd: "/repo/b",
        query: "feature",
      }).queryKey,
      BRANCH_SEARCH_RESULT,
    );

    await invalidateGitQueries(queryClient, { environmentId: ENVIRONMENT_A, cwd: "/repo/a" });

    expect(
      queryClient.getQueryState(
        gitBranchSearchInfiniteQueryOptions({
          environmentId: ENVIRONMENT_A,
          cwd: "/repo/a",
          query: "feature",
        }).queryKey,
      )?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        gitBranchSearchInfiniteQueryOptions({
          environmentId: ENVIRONMENT_B,
          cwd: "/repo/b",
          query: "feature",
        }).queryKey,
      )?.isInvalidated,
    ).toBe(false);
  });
});

describe("git review query options", () => {
  it("calls the environment API for review status, commits, files, and file diffs", async () => {
    vi.mocked(ensureEnvironmentApi).mockReturnValue({
      git: {
        getReviewStatus: vi.fn().mockResolvedValue(REVIEW_STATUS_RESULT),
        listCommits: vi.fn().mockResolvedValue(COMMITS_RESULT),
        getCommitFiles: vi.fn().mockResolvedValue(COMMIT_FILES_RESULT),
        getFileDiff: vi.fn().mockResolvedValue(FILE_DIFF_RESULT),
      },
    } as never);

    const reviewOptions = gitReviewStatusQueryOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      baseBranch: "main",
    });
    const commitsOptions = gitListCommitsQueryOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      baseBranch: "main",
    });
    const commitFilesOptions = gitCommitFilesQueryOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      commitHash: "abc123",
    });
    const fileDiffOptions = gitFileDiffQueryOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      path: "src/DiffPanel.tsx",
      category: "staged",
    });

    await expect(reviewOptions.queryFn!({} as never)).resolves.toEqual(REVIEW_STATUS_RESULT);
    await expect(commitsOptions.queryFn!({} as never)).resolves.toEqual(COMMITS_RESULT);
    await expect(commitFilesOptions.queryFn!({} as never)).resolves.toEqual(COMMIT_FILES_RESULT);
    await expect(fileDiffOptions.queryFn!({} as never)).resolves.toEqual(FILE_DIFF_RESULT);
  });

  it("invalidates git review queries for a single repo scope", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(
      gitQueryKeys.reviewStatus(ENVIRONMENT_A, "/repo/a", "main"),
      REVIEW_STATUS_RESULT,
    );
    queryClient.setQueryData(
      gitQueryKeys.commits(ENVIRONMENT_A, "/repo/a", "main"),
      COMMITS_RESULT,
    );
    queryClient.setQueryData(
      gitQueryKeys.reviewStatus(ENVIRONMENT_B, "/repo/b", "main"),
      REVIEW_STATUS_RESULT,
    );

    await invalidateGitQueries(queryClient, { environmentId: ENVIRONMENT_A, cwd: "/repo/a" });

    expect(
      queryClient.getQueryState(gitQueryKeys.reviewStatus(ENVIRONMENT_A, "/repo/a", "main"))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(gitQueryKeys.commits(ENVIRONMENT_A, "/repo/a", "main"))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(gitQueryKeys.reviewStatus(ENVIRONMENT_B, "/repo/b", "main"))
        ?.isInvalidated,
    ).toBe(false);
  });
});
