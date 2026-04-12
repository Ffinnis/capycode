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

export const WorkspaceSetActiveInput = Schema.Struct({
  workspaceId: WorkspaceId,
});
export type WorkspaceSetActiveInput = typeof WorkspaceSetActiveInput.Type;

export const WorkspaceDeleteInput = Schema.Struct({
  workspaceId: WorkspaceId,
});
export type WorkspaceDeleteInput = typeof WorkspaceDeleteInput.Type;

export class WorkspaceError extends Schema.TaggedErrorClass<WorkspaceError>()("WorkspaceError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect),
}) {}
