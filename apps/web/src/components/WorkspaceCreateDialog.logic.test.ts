import type { GitBranch } from "@capycode/contracts";
import { describe, expect, it } from "vitest";

import {
  buildWorkspaceCreateSubmission,
  createInitialWorkspaceCreateDraft,
  deriveWorkspaceAutoName,
  resolveWorkspaceCreateDefaultBranch,
} from "./WorkspaceCreateDialog.logic";

function makeBranch(name: string, overrides: Partial<GitBranch> = {}): GitBranch {
  return {
    name,
    current: false,
    isDefault: false,
    worktreePath: null,
    ...overrides,
  };
}

describe("resolveWorkspaceCreateDefaultBranch", () => {
  it("prefers the active workspace branch over git status and fetched branches", () => {
    expect(
      resolveWorkspaceCreateDefaultBranch({
        activeWorkspaceBranch: "feature/active",
        threadBranch: "feature/thread",
        currentGitBranch: "feature/current",
        branches: [makeBranch("main", { isDefault: true })],
      }),
    ).toBe("feature/active");
  });

  it("prefers a project thread branch when no active workspace branch is available", () => {
    expect(
      resolveWorkspaceCreateDefaultBranch({
        activeWorkspaceBranch: null,
        threadBranch: "feature/thread",
        currentGitBranch: "feature/current",
        branches: [makeBranch("main", { isDefault: true })],
      }),
    ).toBe("feature/thread");
  });

  it("falls back from current git branch to fetched default branch to main", () => {
    expect(
      resolveWorkspaceCreateDefaultBranch({
        activeWorkspaceBranch: null,
        threadBranch: null,
        currentGitBranch: "feature/current",
        branches: [makeBranch("main", { isDefault: true })],
      }),
    ).toBe("feature/current");

    expect(
      resolveWorkspaceCreateDefaultBranch({
        activeWorkspaceBranch: null,
        threadBranch: null,
        currentGitBranch: null,
        branches: [makeBranch("develop"), makeBranch("main", { isDefault: true })],
      }),
    ).toBe("main");

    expect(
      resolveWorkspaceCreateDefaultBranch({
        activeWorkspaceBranch: null,
        threadBranch: null,
        currentGitBranch: null,
        branches: [],
      }),
    ).toBe("main");
  });
});

describe("createInitialWorkspaceCreateDraft", () => {
  it("initializes worktree mode with a generated branch and default base branch", () => {
    expect(
      createInitialWorkspaceCreateDraft({
        mode: "worktree",
        defaultBranch: "main",
        now: 1_234_567_890,
      }),
    ).toEqual({
      mode: "worktree",
      workspaceName: "",
      branchName: "workspace-kf12oi",
      baseBranch: "main",
      selectedBranch: null,
    });
  });

  it("initializes branch mode with the resolved branch selection", () => {
    expect(
      createInitialWorkspaceCreateDraft({
        mode: "branch",
        defaultBranch: "release/2026",
        now: 1_234_567_890,
      }),
    ).toEqual({
      mode: "branch",
      workspaceName: "",
      branchName: "",
      baseBranch: null,
      selectedBranch: "release/2026",
    });
  });
});

describe("deriveWorkspaceAutoName", () => {
  it("derives a clean workspace name from the branch slug", () => {
    expect(
      deriveWorkspaceAutoName({
        mode: "worktree",
        branchName: "feature/refactor_workspace-flow",
        projectName: "Capycode",
        workspaceCount: 2,
      }),
    ).toBe("Refactor workspace flow");
  });

  it("falls back to suffix-based names when the branch-derived name is unusable", () => {
    expect(
      deriveWorkspaceAutoName({
        mode: "worktree",
        branchName: "///",
        projectName: "Capycode",
        workspaceCount: 2,
      }),
    ).toBe("Workspace 3");

    expect(
      deriveWorkspaceAutoName({
        mode: "branch",
        branchName: "___",
        projectName: "Capycode",
        workspaceCount: 4,
      }),
    ).toBe("Capycode 5");
  });
});

describe("buildWorkspaceCreateSubmission", () => {
  it("builds the expected payload for worktree mode", () => {
    expect(
      buildWorkspaceCreateSubmission({
        draft: {
          mode: "worktree",
          workspaceName: "  Experimental Workspace  ",
          branchName: "  feature/ai-modal  ",
          baseBranch: "  main  ",
          selectedBranch: null,
        },
        projectId: "project-1",
        projectName: "Capycode",
        workspaceCount: 2,
        availableBranchNames: new Set(["main", "feature/ai-modal"]),
      }),
    ).toEqual({
      ok: true,
      payload: {
        projectId: "project-1",
        type: "worktree",
        name: "Experimental Workspace",
        branch: "feature/ai-modal",
        baseBranch: "main",
      },
    });
  });

  it("builds the expected payload for branch mode", () => {
    expect(
      buildWorkspaceCreateSubmission({
        draft: {
          mode: "branch",
          workspaceName: "",
          branchName: "",
          baseBranch: null,
          selectedBranch: "release/2026",
        },
        projectId: "project-1",
        projectName: "Capycode",
        workspaceCount: 4,
        availableBranchNames: new Set(["main", "release/2026"]),
      }),
    ).toEqual({
      ok: true,
      payload: {
        projectId: "project-1",
        type: "branch",
        name: "2026",
        branch: "release/2026",
      },
    });
  });

  it("rejects invalid submit states", () => {
    expect(
      buildWorkspaceCreateSubmission({
        draft: {
          mode: "worktree",
          workspaceName: "",
          branchName: "   ",
          baseBranch: null,
          selectedBranch: null,
        },
        projectId: "project-1",
        projectName: "Capycode",
        workspaceCount: 1,
        availableBranchNames: new Set(["main"]),
      }),
    ).toEqual({
      ok: false,
      error: "Enter a branch name.",
    });

    expect(
      buildWorkspaceCreateSubmission({
        draft: {
          mode: "branch",
          workspaceName: "",
          branchName: "",
          baseBranch: null,
          selectedBranch: "missing-branch",
        },
        projectId: "project-1",
        projectName: "Capycode",
        workspaceCount: 1,
        availableBranchNames: new Set(["main"]),
      }),
    ).toEqual({
      ok: false,
      error: "Select an existing branch.",
    });
  });
});
