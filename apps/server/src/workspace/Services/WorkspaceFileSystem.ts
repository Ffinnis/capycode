/**
 * WorkspaceFileSystem - Effect service contract for workspace file mutations.
 *
 * Owns workspace-root-relative file write operations and their associated
 * safety checks and cache invalidation hooks.
 *
 * @module WorkspaceFileSystem
 */
import { Schema, Context } from "effect";
import type { Effect } from "effect";

import type {
  ProjectCreateDirectoryInput,
  ProjectCreateDirectoryResult,
  ProjectDeleteEntryInput,
  ProjectDeleteEntryResult,
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectMoveEntryInput,
  ProjectMoveEntryResult,
  ProjectMutationErrorCode,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@capycode/contracts";
import { WorkspacePathOutsideRootError } from "./WorkspacePaths.ts";

export class WorkspaceFileSystemError extends Schema.TaggedErrorClass<WorkspaceFileSystemError>()(
  "WorkspaceFileSystemError",
  {
    cwd: Schema.String,
    code: Schema.String,
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * WorkspaceFileSystemShape - Service API for workspace-relative file operations.
 */
export interface WorkspaceFileSystemShape {
  /**
   * Check whether a path currently exists within the workspace root.
   */
  readonly pathExists: (input: { cwd: string; relativePath: string }) => Effect.Effect<
    {
      exists: boolean;
      kind?: "file" | "directory";
    },
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * List direct filesystem children within the workspace root.
   */
  readonly listDirectory: (
    input: ProjectListDirectoryInput,
  ) => Effect.Effect<
    ProjectListDirectoryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Read a workspace file for preview.
   */
  readonly readFile: (
    input: ProjectReadFileInput,
  ) => Effect.Effect<
    ProjectReadFileResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Write a file relative to the workspace root.
   *
   * Creates parent directories as needed and rejects paths that escape the
   * workspace root.
   */
  readonly writeFile: (
    input: ProjectWriteFileInput,
  ) => Effect.Effect<
    ProjectWriteFileResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Create a directory relative to the workspace root.
   */
  readonly createDirectory: (
    input: ProjectCreateDirectoryInput,
  ) => Effect.Effect<
    ProjectCreateDirectoryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Delete a file or directory relative to the workspace root.
   */
  readonly deleteEntry: (
    input: ProjectDeleteEntryInput,
  ) => Effect.Effect<
    ProjectDeleteEntryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Move or rename a file-system entry within the workspace root.
   */
  readonly moveEntry: (
    input: ProjectMoveEntryInput,
  ) => Effect.Effect<
    ProjectMoveEntryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;
}

/**
 * WorkspaceFileSystem - Service tag for workspace file operations.
 */
export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  WorkspaceFileSystemShape
>()("t3/workspace/Services/WorkspaceFileSystem") {}

export function isWorkspaceMutationCode(value: string): value is ProjectMutationErrorCode {
  return [
    "outside_root",
    "not_found",
    "already_exists",
    "not_a_directory",
    "is_a_directory",
    "directory_not_empty",
    "invalid_move",
    "stale_version",
    "unsupported_encoding",
  ].includes(value);
}
