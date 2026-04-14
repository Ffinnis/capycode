import { describe, expect, it } from "vitest";

import { resolveNewThreadShortcutOptions } from "./_chat";

describe("resolveNewThreadShortcutOptions", () => {
  it("forces local env mode for chat.newLocal", () => {
    expect(
      resolveNewThreadShortcutOptions({
        command: "chat.newLocal",
        branch: "feature/legacy",
        worktreePath: "/tmp/legacy-worktree",
      }),
    ).toEqual({ envMode: "local" });
  });

  it("preserves branch context while forcing local env mode for chat.new", () => {
    expect(
      resolveNewThreadShortcutOptions({
        command: "chat.new",
        branch: "feature/current",
        worktreePath: "/tmp/current-worktree",
      }),
    ).toEqual({
      branch: "feature/current",
      worktreePath: "/tmp/current-worktree",
      envMode: "local",
    });
  });

  it("returns null for unrelated shortcuts", () => {
    expect(
      resolveNewThreadShortcutOptions({
        command: null,
        branch: "feature/current",
        worktreePath: "/tmp/current-worktree",
      }),
    ).toBeNull();
  });
});
