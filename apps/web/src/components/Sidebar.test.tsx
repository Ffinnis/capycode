import { ThreadId } from "@capycode/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SidebarThreadProviderIcon,
  draftSessionMatchesWorkspace,
  resolveWorkspaceThreadLaunchInput,
} from "./Sidebar";

describe("SidebarThreadProviderIcon", () => {
  it("renders the Codex provider icon", () => {
    const threadId = ThreadId.make("thread-codex");
    const html = renderToStaticMarkup(
      <SidebarThreadProviderIcon provider="codex" threadId={threadId} />,
    );

    expect(html).toContain(`data-testid="thread-provider-icon-${threadId}"`);
    expect(html).toContain("text-muted-foreground/70");
  });

  it("renders the Claude provider icon with the brand tint", () => {
    const threadId = ThreadId.make("thread-claude");
    const html = renderToStaticMarkup(
      <SidebarThreadProviderIcon provider="claudeAgent" threadId={threadId} />,
    );

    expect(html).toContain(`data-testid="thread-provider-icon-${threadId}"`);
    expect(html).toContain("text-[#d97757]");
  });
});

describe("draftSessionMatchesWorkspace", () => {
  it("matches root workspaces by environment and project instead of branch identity", () => {
    expect(
      draftSessionMatchesWorkspace(
        {
          environmentId: "env-1" as never,
          projectId: "project-1" as never,
          branch: "feature/from-draft",
          worktreePath: null,
        } as never,
        {
          environmentId: "env-1" as never,
          projectId: "project-1" as never,
          branch: "main",
          worktreePath: null,
          isDefault: true,
          type: "root",
        } as never,
      ),
    ).toBe(true);
  });

  it("still matches worktree workspaces by worktree path", () => {
    expect(
      draftSessionMatchesWorkspace(
        {
          environmentId: "env-1" as never,
          projectId: "project-1" as never,
          branch: "feature/from-draft",
          worktreePath: "/tmp/worktree-a",
        } as never,
        {
          environmentId: "env-1" as never,
          projectId: "project-1" as never,
          branch: "feature/worktree",
          worktreePath: "/tmp/worktree-b",
          isDefault: false,
          type: "worktree",
        } as never,
      ),
    ).toBe(false);
  });
});

describe("resolveWorkspaceThreadLaunchInput", () => {
  it("uses live git branch metadata for root workspaces", () => {
    expect(
      resolveWorkspaceThreadLaunchInput(
        {
          branch: "stale-workspace-branch",
          worktreePath: null,
          type: "root",
        } as never,
        "feature/live-root",
      ),
    ).toEqual({
      branch: "feature/live-root",
      worktreePath: null,
      envMode: "local",
    });
  });

  it("keeps worktree branch metadata unchanged", () => {
    expect(
      resolveWorkspaceThreadLaunchInput(
        {
          branch: "feature/worktree",
          worktreePath: "/tmp/worktree",
          type: "worktree",
        } as never,
        "ignored-root-branch",
      ),
    ).toEqual({
      branch: "feature/worktree",
      worktreePath: "/tmp/worktree",
      envMode: "worktree",
    });
  });
});
