import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  GitGetCommitFilesResult,
  GitGetFileDiffResult,
  GitListCommitsResult,
  GitReviewStatusResult,
  GitCreateWorktreeInput,
  GitPreparePullRequestThreadInput,
  GitRunStackedActionResult,
  GitRunStackedActionInput,
  GitResolvePullRequestResult,
} from "./git";

const decodeCreateWorktreeInput = Schema.decodeUnknownSync(GitCreateWorktreeInput);
const decodePreparePullRequestThreadInput = Schema.decodeUnknownSync(
  GitPreparePullRequestThreadInput,
);
const decodeRunStackedActionInput = Schema.decodeUnknownSync(GitRunStackedActionInput);
const decodeRunStackedActionResult = Schema.decodeUnknownSync(GitRunStackedActionResult);
const decodeResolvePullRequestResult = Schema.decodeUnknownSync(GitResolvePullRequestResult);
const decodeReviewStatusResult = Schema.decodeUnknownSync(GitReviewStatusResult);
const decodeListCommitsResult = Schema.decodeUnknownSync(GitListCommitsResult);
const decodeGetCommitFilesResult = Schema.decodeUnknownSync(GitGetCommitFilesResult);
const decodeGetFileDiffResult = Schema.decodeUnknownSync(GitGetFileDiffResult);

describe("GitCreateWorktreeInput", () => {
  it("accepts omitted newBranch for existing-branch worktrees", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      branch: "feature/existing",
      path: "/tmp/worktree",
    });

    expect(parsed.newBranch).toBeUndefined();
    expect(parsed.branch).toBe("feature/existing");
  });
});

describe("GitPreparePullRequestThreadInput", () => {
  it("accepts pull request references and mode", () => {
    const parsed = decodePreparePullRequestThreadInput({
      cwd: "/repo",
      reference: "#42",
      mode: "worktree",
    });

    expect(parsed.reference).toBe("#42");
    expect(parsed.mode).toBe("worktree");
  });
});

describe("GitResolvePullRequestResult", () => {
  it("decodes resolved pull request metadata", () => {
    const parsed = decodeResolvePullRequestResult({
      pullRequest: {
        number: 42,
        title: "PR threads",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseBranch: "main",
        headBranch: "feature/pr-threads",
        state: "open",
      },
    });

    expect(parsed.pullRequest.number).toBe(42);
    expect(parsed.pullRequest.headBranch).toBe("feature/pr-threads");
  });
});

describe("GitRunStackedActionInput", () => {
  it("accepts explicit stacked actions and requires a client-provided actionId", () => {
    const parsed = decodeRunStackedActionInput({
      actionId: "action-1",
      cwd: "/repo",
      action: "create_pr",
    });

    expect(parsed.actionId).toBe("action-1");
    expect(parsed.action).toBe("create_pr");
  });
});

describe("GitRunStackedActionResult", () => {
  it("decodes a server-authored completion toast", () => {
    const parsed = decodeRunStackedActionResult({
      action: "commit_push",
      branch: {
        status: "created",
        name: "feature/server-owned-toast",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: move toast state into git manager",
      },
      push: {
        status: "pushed",
        branch: "feature/server-owned-toast",
        upstreamBranch: "origin/feature/server-owned-toast",
      },
      pr: {
        status: "skipped_not_requested",
      },
      toast: {
        title: "Pushed 89abcde to origin/feature/server-owned-toast",
        description: "feat: move toast state into git manager",
        cta: {
          kind: "run_action",
          label: "Create PR",
          action: {
            kind: "create_pr",
          },
        },
      },
    });

    expect(parsed.toast.cta.kind).toBe("run_action");
    if (parsed.toast.cta.kind === "run_action") {
      expect(parsed.toast.cta.action.kind).toBe("create_pr");
    }
  });
});

describe("Git review contracts", () => {
  it("decodes git review status results", () => {
    const parsed = decodeReviewStatusResult({
      isRepo: true,
      branch: "feature/diff-panel",
      baseBranch: "main",
      baseBranchOptions: ["main", "release"],
      againstBase: [
        {
          path: "src/DiffPanel.tsx",
          status: "modified",
          additions: 120,
          deletions: 24,
        },
      ],
      staged: [
        {
          path: "src/git.ts",
          status: "added",
          additions: 12,
          deletions: 0,
        },
      ],
      unstaged: [
        {
          path: "src/untracked.ts",
          status: "untracked",
          additions: 0,
          deletions: 0,
        },
      ],
    });

    expect(parsed.baseBranchOptions).toContain("main");
    expect(parsed.unstaged[0]?.status).toBe("untracked");
  });

  it("decodes commit listings and file diff payloads", () => {
    const commits = decodeListCommitsResult({
      baseBranch: "main",
      commits: [
        {
          hash: "1234567890abcdef",
          shortHash: "1234567",
          message: "feat: add git diff panel",
          author: "Capy Coder",
          date: "2026-04-12T10:00:00.000Z",
        },
      ],
    });
    const files = decodeGetCommitFilesResult({
      files: [
        {
          path: "src/DiffPanel.tsx",
          oldPath: "src/LegacyDiffPanel.tsx",
          status: "renamed",
          additions: 42,
          deletions: 8,
        },
      ],
    });
    const diff = decodeGetFileDiffResult({
      patch: "diff --git a/src/DiffPanel.tsx b/src/DiffPanel.tsx\n",
    });

    expect(commits.commits[0]?.shortHash).toBe("1234567");
    expect(files.files[0]?.oldPath).toBe("src/LegacyDiffPanel.tsx");
    expect(diff.patch).toContain("diff --git");
  });
});
