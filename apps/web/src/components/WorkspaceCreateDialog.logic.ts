import type { WorkspaceCreateInput } from "@capycode/contracts";

export interface WorkspaceCreateDraft {
  readonly workspaceName: string;
  readonly branchName: string;
  readonly baseBranch: string | null;
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
  defaultBranch: string;
  now?: number;
}): WorkspaceCreateDraft {
  return {
    workspaceName: "",
    branchName: `workspace-${(input.now ?? Date.now()).toString(36)}`,
    baseBranch: input.defaultBranch,
  };
}

export function deriveWorkspaceAutoName(input: {
  branchName: string;
  workspaceCount: number;
}): string {
  const fallbackIndex = input.workspaceCount + 1;
  const fallbackName = `Workspace ${fallbackIndex}`;
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
}): WorkspaceCreateValidationResult {
  const workspaceName = normalizeOptionalString(input.draft.workspaceName);
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
      name: resolveWorkspaceName({
        explicitName: workspaceName,
        branchName: branch,
        workspaceCount: input.workspaceCount,
      }),
      branch,
      baseBranch,
    },
  };
}

function resolveWorkspaceName(input: {
  explicitName: string | null;
  branchName: string;
  workspaceCount: number;
}): string {
  return (
    input.explicitName ??
    deriveWorkspaceAutoName({
      branchName: input.branchName,
      workspaceCount: input.workspaceCount,
    })
  );
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
