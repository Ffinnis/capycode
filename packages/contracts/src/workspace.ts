import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  TrimmedNonEmptyString,
  WorkspaceId,
  WorktreeId,
  WorkspaceSectionId,
} from "./baseSchemas";

export const WorkspaceType = Schema.Literals(["branch", "worktree"]);
export type WorkspaceType = typeof WorkspaceType.Type;

export const WorkspaceSection = Schema.Struct({
  id: WorkspaceSectionId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString,
  tabOrder: NonNegativeInt,
  isCollapsed: Schema.Boolean,
  color: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type WorkspaceSection = typeof WorkspaceSection.Type;

export const Workspace = Schema.Struct({
  id: WorkspaceId,
  projectId: ProjectId,
  worktreeId: Schema.NullOr(WorktreeId),
  type: WorkspaceType,
  name: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  sectionId: Schema.NullOr(WorkspaceSectionId),
  tabOrder: NonNegativeInt,
  isDefault: Schema.Boolean,
  isActive: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastOpenedAt: IsoDateTime,
  deletingAt: Schema.NullOr(IsoDateTime),
});
export type Workspace = typeof Workspace.Type;

export const WorkspaceCreateInput = Schema.Struct({
  projectId: ProjectId,
  name: TrimmedNonEmptyString,
  type: Schema.optional(WorkspaceType),
  baseBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  sectionId: Schema.optional(Schema.NullOr(WorkspaceSectionId)),
});
export type WorkspaceCreateInput = typeof WorkspaceCreateInput.Type;

export const WorkspaceUpdateInput = Schema.Struct({
  workspaceId: WorkspaceId,
  name: TrimmedNonEmptyString,
});
export type WorkspaceUpdateInput = typeof WorkspaceUpdateInput.Type;

export const WorkspaceSetActiveInput = Schema.Struct({
  workspaceId: WorkspaceId,
});
export type WorkspaceSetActiveInput = typeof WorkspaceSetActiveInput.Type;

export const WorkspaceDeleteInput = Schema.Struct({
  workspaceId: WorkspaceId,
});
export type WorkspaceDeleteInput = typeof WorkspaceDeleteInput.Type;

export const WorkspaceDeletePreview = Schema.Struct({
  workspaceId: WorkspaceId,
  activeThreadCount: NonNegativeInt,
  archivedThreadCount: NonNegativeInt,
  totalThreadCount: NonNegativeInt,
  deletesWorktreePath: Schema.Boolean,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  deletesBranch: Schema.Boolean,
  branchToDelete: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorkspaceDeletePreview = typeof WorkspaceDeletePreview.Type;

export const WorkspaceOpenMainRepoInput = Schema.Struct({
  projectId: ProjectId,
});
export type WorkspaceOpenMainRepoInput = typeof WorkspaceOpenMainRepoInput.Type;

export const WorkspaceOpenTrackedWorktreeInput = Schema.Struct({
  worktreeId: WorktreeId,
});
export type WorkspaceOpenTrackedWorktreeInput = typeof WorkspaceOpenTrackedWorktreeInput.Type;

export const WorkspaceOpenExternalWorktreeInput = Schema.Struct({
  projectId: ProjectId,
  worktreePath: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
});
export type WorkspaceOpenExternalWorktreeInput = typeof WorkspaceOpenExternalWorktreeInput.Type;

export const WorkspaceImportAllInput = Schema.Struct({
  projectId: ProjectId,
});
export type WorkspaceImportAllInput = typeof WorkspaceImportAllInput.Type;

export const WorkspaceTrackedWorktreeCandidate = Schema.Struct({
  worktreeId: WorktreeId,
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  baseBranch: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorkspaceTrackedWorktreeCandidate = typeof WorkspaceTrackedWorktreeCandidate.Type;

export const WorkspaceExternalWorktreeCandidate = Schema.Struct({
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
});
export type WorkspaceExternalWorktreeCandidate = typeof WorkspaceExternalWorktreeCandidate.Type;

export const WorkspaceOpenCandidates = Schema.Struct({
  projectId: ProjectId,
  mainRepoBranch: TrimmedNonEmptyString,
  trackedWorktrees: Schema.Array(WorkspaceTrackedWorktreeCandidate),
  externalWorktrees: Schema.Array(WorkspaceExternalWorktreeCandidate),
});
export type WorkspaceOpenCandidates = typeof WorkspaceOpenCandidates.Type;

export const WorkspaceSectionCreateInput = Schema.Struct({
  projectId: ProjectId,
  name: TrimmedNonEmptyString,
});
export type WorkspaceSectionCreateInput = typeof WorkspaceSectionCreateInput.Type;

export const WorkspaceSectionRenameInput = Schema.Struct({
  sectionId: WorkspaceSectionId,
  name: TrimmedNonEmptyString,
});
export type WorkspaceSectionRenameInput = typeof WorkspaceSectionRenameInput.Type;

export const WorkspaceSectionDeleteInput = Schema.Struct({
  sectionId: WorkspaceSectionId,
});
export type WorkspaceSectionDeleteInput = typeof WorkspaceSectionDeleteInput.Type;

export const WorkspaceSectionColorInput = Schema.Struct({
  sectionId: WorkspaceSectionId,
  color: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorkspaceSectionColorInput = typeof WorkspaceSectionColorInput.Type;

export const WorkspaceSectionToggleCollapsedInput = Schema.Struct({
  sectionId: WorkspaceSectionId,
  isCollapsed: Schema.Boolean,
});
export type WorkspaceSectionToggleCollapsedInput = typeof WorkspaceSectionToggleCollapsedInput.Type;

export const WorkspaceProjectChildOrderItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("workspace"),
    id: WorkspaceId,
  }),
  Schema.Struct({
    kind: Schema.Literal("section"),
    id: WorkspaceSectionId,
  }),
]);
export type WorkspaceProjectChildOrderItem = typeof WorkspaceProjectChildOrderItem.Type;

export const WorkspaceReorderProjectChildrenInput = Schema.Struct({
  projectId: ProjectId,
  orderedItems: Schema.Array(WorkspaceProjectChildOrderItem),
});
export type WorkspaceReorderProjectChildrenInput = typeof WorkspaceReorderProjectChildrenInput.Type;

export const WorkspaceReorderSectionWorkspacesInput = Schema.Struct({
  sectionId: WorkspaceSectionId,
  orderedWorkspaceIds: Schema.Array(WorkspaceId),
});
export type WorkspaceReorderSectionWorkspacesInput =
  typeof WorkspaceReorderSectionWorkspacesInput.Type;

export const WorkspaceMoveToSectionInput = Schema.Struct({
  workspaceId: WorkspaceId,
  sectionId: Schema.NullOr(WorkspaceSectionId),
});
export type WorkspaceMoveToSectionInput = typeof WorkspaceMoveToSectionInput.Type;

export class WorkspaceError extends Schema.TaggedErrorClass<WorkspaceError>()("WorkspaceError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect),
}) {}
