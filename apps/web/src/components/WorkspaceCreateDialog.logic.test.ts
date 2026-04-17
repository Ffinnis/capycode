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
        defaultBranch: "main",
        now: 1_234_567_890,
      }),
    ).toEqual({
      workspaceName: "",
      branchName: "workspace-kf12oi",
      baseBranch: "main",
    });
  });
});

describe("deriveWorkspaceAutoName", () => {
  it("derives a clean workspace name from the branch slug", () => {
    expect(
      deriveWorkspaceAutoName({
        branchName: "feature/refactor_workspace-flow",
        workspaceCount: 2,
      }),
    ).toBe("Refactor workspace flow");
  });

  it("falls back to suffix-based names when the branch-derived name is unusable", () => {
    expect(
      deriveWorkspaceAutoName({
        branchName: "///",
        workspaceCount: 2,
      }),
    ).toBe("Workspace 3");
  });
});

describe("buildWorkspaceCreateSubmission", () => {
  it("builds the expected payload for worktree mode", () => {
    expect(
      buildWorkspaceCreateSubmission({
        draft: {
          workspaceName: "  Experimental Workspace  ",
          branchName: "  feature/ai-modal  ",
          baseBranch: "  main  ",
        },
        projectId: "project-1",
        projectName: "Capycode",
        workspaceCount: 2,
      }),
    ).toEqual({
      ok: true,
      payload: {
        projectId: "project-1",
        name: "Experimental Workspace",
        branch: "feature/ai-modal",
        baseBranch: "main",
      },
    });
  });

  it("rejects invalid submit states", () => {
    expect(
      buildWorkspaceCreateSubmission({
        draft: {
          workspaceName: "",
          branchName: "   ",
          baseBranch: null,
        },
        projectId: "project-1",
        projectName: "Capycode",
        workspaceCount: 1,
      }),
    ).toEqual({
      ok: false,
      error: "Enter a branch name.",
    });
  });
});
