import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  Workspace,
  WorkspaceCreateInput,
  WorkspaceDeletePreview,
  WorkspaceOpenCandidates,
} from "./workspace";

const decodeWorkspaceDeletePreview = Schema.decodeUnknownSync(WorkspaceDeletePreview);
const decodeWorkspace = Schema.decodeUnknownSync(Workspace);
const decodeWorkspaceCreateInput = Schema.decodeUnknownSync(WorkspaceCreateInput);
const decodeWorkspaceOpenCandidates = Schema.decodeUnknownSync(WorkspaceOpenCandidates);

describe("WorkspaceDeletePreview", () => {
  it("decodes branch deletion details for capycode-managed worktree cleanup", () => {
    const parsed = decodeWorkspaceDeletePreview({
      workspaceId: "workspace-1",
      activeThreadCount: 0,
      archivedThreadCount: 0,
      totalThreadCount: 0,
      deletesWorktreePath: true,
      worktreePath: "/tmp/worktree",
      deletesBranch: true,
      branchToDelete: "feature/workspace",
    });

    expect(parsed.deletesBranch).toBe(true);
    expect(parsed.branchToDelete).toBe("feature/workspace");
  });
});

describe("Workspace", () => {
  it("decodes a root workspace snapshot", () => {
    const parsed = decodeWorkspace({
      id: "workspace-root",
      projectId: "project-1",
      worktreeId: null,
      type: "root",
      name: "Workspace",
      branch: "main",
      worktreePath: null,
      sectionId: null,
      tabOrder: 0,
      isDefault: true,
      isActive: true,
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
      lastOpenedAt: "2026-04-17T00:00:00.000Z",
      deletingAt: null,
    });

    expect(parsed.type).toBe("root");
    expect(parsed.name).toBe("Workspace");
  });
});

describe("WorkspaceCreateInput", () => {
  it("accepts worktree creation without an explicit type", () => {
    const parsed = decodeWorkspaceCreateInput({
      projectId: "project-1",
      name: "Feature A",
      branch: "feature/a",
      baseBranch: "main",
    });

    expect(parsed.branch).toBe("feature/a");
    expect(parsed.baseBranch).toBe("main");
  });

  it("rejects legacy branch-workspace creation payloads", () => {
    expect(() =>
      decodeWorkspaceCreateInput({
        projectId: "project-1",
        name: "Release 2026",
        type: "branch",
        branch: "release/2026",
      }),
    ).toThrow();
  });
});

describe("WorkspaceOpenCandidates", () => {
  it("decodes worktree-only open candidates without a main repo branch", () => {
    const parsed = decodeWorkspaceOpenCandidates({
      projectId: "project-1",
      trackedWorktrees: [
        {
          worktreeId: "worktree-1",
          projectId: "project-1",
          path: "/tmp/project-1-feature-a",
          branch: "feature/a",
          baseBranch: "main",
        },
      ],
      externalWorktrees: [
        {
          projectId: "project-1",
          path: "/tmp/project-1-feature-b",
          branch: "feature/b",
        },
      ],
    });

    expect(parsed.trackedWorktrees).toHaveLength(1);
    expect(parsed.externalWorktrees).toHaveLength(1);
  });
});
