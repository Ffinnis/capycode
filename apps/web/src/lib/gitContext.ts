interface GitContextProjectLike {
  cwd: string;
}

interface GitContextThreadLike {
  workspaceId?: string | null;
  branch: string | null;
  worktreePath: string | null;
}

interface GitContextWorkspaceLike {
  id: string;
  branch: string | null;
  worktreePath: string | null;
}

export interface EffectiveGitContext {
  cwd: string | null;
  worktreePath: string | null;
  workspaceId: string | null;
  branch: string | null;
}

export function resolveEffectiveGitContext(input: {
  project: GitContextProjectLike | null | undefined;
  thread: GitContextThreadLike | null | undefined;
  draftThread?: GitContextThreadLike | null | undefined;
  linkedWorkspace?: GitContextWorkspaceLike | null | undefined;
}): EffectiveGitContext {
  const effectiveThread = input.thread ?? input.draftThread ?? null;
  const explicitWorktreePath = effectiveThread?.worktreePath ?? null;
  const linkedWorkspace =
    effectiveThread?.workspaceId && input.linkedWorkspace?.id === effectiveThread.workspaceId
      ? input.linkedWorkspace
      : null;

  const worktreePath = explicitWorktreePath ?? linkedWorkspace?.worktreePath ?? null;

  return {
    cwd: worktreePath ?? input.project?.cwd ?? null,
    worktreePath,
    workspaceId: effectiveThread?.workspaceId ?? linkedWorkspace?.id ?? null,
    branch: effectiveThread?.branch ?? linkedWorkspace?.branch ?? null,
  };
}
