import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { WorkspaceDeletePreview } from "./workspace";

const decodeWorkspaceDeletePreview = Schema.decodeUnknownSync(WorkspaceDeletePreview);

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
