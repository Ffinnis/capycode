import type { WorkspaceCreateInput } from "@capycode/contracts";

export type WorkspaceCreateDialogMode = "branch" | "worktree";

export interface WorkspaceCreateDraft {
  readonly mode: WorkspaceCreateDialogMode;
  readonly workspaceName: string;
  readonly branchName: string;
  readonly baseBranch: string | null;
  readonly selectedBranch: string | null;
}

export interface WorkspaceCreateResolvedDefaults {
  readonly defaultBranch: string;
}

export type WorkspaceCreateValidationResult =
  | {
      readonly ok: true;
      readonly payload: WorkspaceCreateInput;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

export function resolveWorkspaceCreateDefaultBranch(input: {
  activeWorkspaceBranch: string | null;
  threadBranch: string | null;
  currentGitBranch: string | null;
  branches: ReadonlyArray<{
    name: string;
    isDefault: boolean;
  }>;
}): string {
  return (
    normalizeOptionalString(input.activeWorkspaceBranch) ??
    normalizeOptionalString(input.threadBranch) ??
    normalizeOptionalString(input.currentGitBranch) ??
    input.branches.find((branch) => branch.isDefault)?.name ??
    "main"
  );
}

export function createInitialWorkspaceCreateDraft(input: {
  mode: WorkspaceCreateDialogMode;
  defaultBranch: string;
  now?: number;
}): WorkspaceCreateDraft {
  return input.mode === "worktree"
    ? {
        mode: "worktree",
        workspaceName: "",
        branchName: `workspace-${(input.now ?? Date.now()).toString(36)}`,
        baseBranch: input.defaultBranch,
        selectedBranch: null,
      }
    : {
        mode: "branch",
        workspaceName: "",
        branchName: "",
        baseBranch: null,
        selectedBranch: input.defaultBranch,
      };
}

export function deriveWorkspaceAutoName(input: {
  mode: WorkspaceCreateDialogMode;
  branchName: string;
  projectName: string;
  workspaceCount: number;
}): string {
  const fallbackIndex = input.workspaceCount + 1;
  const fallbackName =
    input.mode === "worktree"
      ? `Workspace ${fallbackIndex}`
      : `${input.projectName} ${fallbackIndex}`;
  const normalizedBranchName = normalizeOptionalString(input.branchName);
  if (!normalizedBranchName) {
    return fallbackName;
  }

  const branchSegment = normalizedBranchName.split("/").findLast((segment) => segment.length > 0);
  const candidate = branchSegment?.replaceAll(/[-_]+/g, " ").replaceAll(/\s+/g, " ").trim();
  if (!candidate) {
    return fallbackName;
  }

  return candidate.charAt(0).toUpperCase() + candidate.slice(1);
}

export function buildWorkspaceCreateSubmission(input: {
  draft: WorkspaceCreateDraft;
  projectId: string;
  projectName: string;
  workspaceCount: number;
  availableBranchNames: ReadonlySet<string>;
}): WorkspaceCreateValidationResult {
  const workspaceName = normalizeOptionalString(input.draft.workspaceName);

  if (input.draft.mode === "worktree") {
    const branch = normalizeOptionalString(input.draft.branchName);
    if (!branch) {
      return { ok: false, error: "Enter a branch name." };
    }

    const baseBranch = normalizeOptionalString(input.draft.baseBranch);
    if (!baseBranch) {
      return { ok: false, error: "Select a base branch." };
    }

    return {
      ok: true,
      payload: {
        projectId: input.projectId as WorkspaceCreateInput["projectId"],
        type: "worktree",
        name: resolveWorkspaceName({
          explicitName: workspaceName,
          branchName: branch,
          mode: "worktree",
          projectName: input.projectName,
          workspaceCount: input.workspaceCount,
        }),
        branch,
        baseBranch,
      },
    };
  }

  const branch = normalizeOptionalString(input.draft.selectedBranch);
  if (!branch || !input.availableBranchNames.has(branch)) {
    return { ok: false, error: "Select an existing branch." };
  }

  return {
    ok: true,
    payload: {
      projectId: input.projectId as WorkspaceCreateInput["projectId"],
      type: "branch",
      name: resolveWorkspaceName({
        explicitName: workspaceName,
        branchName: branch,
        mode: "branch",
        projectName: input.projectName,
        workspaceCount: input.workspaceCount,
      }),
      branch,
    },
  };
}

function resolveWorkspaceName(input: {
  explicitName: string | null;
  branchName: string;
  mode: WorkspaceCreateDialogMode;
  projectName: string;
  workspaceCount: number;
}): string {
  return (
    input.explicitName ??
    deriveWorkspaceAutoName({
      mode: input.mode,
      branchName: input.branchName,
      projectName: input.projectName,
      workspaceCount: input.workspaceCount,
    })
  );
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
