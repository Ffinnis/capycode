import { describe, expect, it } from "vitest";

import { resolveEffectiveGitContext } from "./gitContext";

describe("resolveEffectiveGitContext", () => {
  it("prefers explicit thread worktree paths over workspace-backed paths", () => {
    expect(
      resolveEffectiveGitContext({
        project: { cwd: "/repo" },
        thread: {
          workspaceId: "workspace-1",
          branch: "feature/explicit",
          worktreePath: "/repo/worktrees/explicit",
        },
        linkedWorkspace: {
          id: "workspace-1",
          branch: "feature/workspace",
          worktreePath: "/repo/workspaces/workspace-1",
        },
      }),
    ).toEqual({
      cwd: "/repo/worktrees/explicit",
      worktreePath: "/repo/worktrees/explicit",
      workspaceId: "workspace-1",
      branch: "feature/explicit",
    });
  });

  it("falls back to the linked workspace for workspace-backed threads", () => {
    expect(
      resolveEffectiveGitContext({
        project: { cwd: "/repo" },
        thread: {
          workspaceId: "workspace-1",
          branch: null,
          worktreePath: null,
        },
        linkedWorkspace: {
          id: "workspace-1",
          branch: "feature/workspace",
          worktreePath: "/repo/workspaces/workspace-1",
        },
      }),
    ).toEqual({
      cwd: "/repo/workspaces/workspace-1",
      worktreePath: "/repo/workspaces/workspace-1",
      workspaceId: "workspace-1",
      branch: "feature/workspace",
    });
  });

  it("falls back to the project cwd when no worktree path is available", () => {
    expect(
      resolveEffectiveGitContext({
        project: { cwd: "/repo" },
        thread: {
          workspaceId: "workspace-missing",
          branch: null,
          worktreePath: null,
        },
        linkedWorkspace: null,
      }),
    ).toEqual({
      cwd: "/repo",
      worktreePath: null,
      workspaceId: "workspace-missing",
      branch: null,
    });
  });

  it("uses the draft thread when no active server thread exists", () => {
    expect(
      resolveEffectiveGitContext({
        project: { cwd: "/repo" },
        thread: null,
        draftThread: {
          branch: "feature/draft",
          worktreePath: "/repo/worktrees/draft",
        },
      }),
    ).toEqual({
      cwd: "/repo/worktrees/draft",
      worktreePath: "/repo/worktrees/draft",
      workspaceId: null,
      branch: "feature/draft",
    });
  });
});
