import { Effect, Schema } from "effect";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_READ_FILE_MAX_BYTES = 16 * 1024 * 1024;

export const ProjectFileEncoding = Schema.Literals(["utf8", "base64"]);
export type ProjectFileEncoding = typeof ProjectFileEncoding.Type;

export const ProjectLineEnding = Schema.Literals(["lf", "crlf"]);
export type ProjectLineEnding = typeof ProjectLineEnding.Type;

export const ProjectMutationErrorCode = Schema.Literals([
  "outside_root",
  "not_found",
  "already_exists",
  "not_a_directory",
  "is_a_directory",
  "directory_not_empty",
  "invalid_move",
  "stale_version",
  "unsupported_encoding",
]);
export type ProjectMutationErrorCode = typeof ProjectMutationErrorCode.Type;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    code: ProjectMutationErrorCode.pipe(
      Schema.withDecodingDefault(Effect.succeed("not_found" satisfies ProjectMutationErrorCode)),
    ),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectListDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  ),
});
export type ProjectListDirectoryInput = typeof ProjectListDirectoryInput.Type;

export const ProjectDirectoryEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
});
export type ProjectDirectoryEntry = typeof ProjectDirectoryEntry.Type;

export const ProjectListDirectoryResult = Schema.Struct({
  entries: Schema.Array(ProjectDirectoryEntry),
});
export type ProjectListDirectoryResult = typeof ProjectListDirectoryResult.Type;

export class ProjectListDirectoryError extends Schema.TaggedErrorClass<ProjectListDirectoryError>()(
  "ProjectListDirectoryError",
  {
    code: ProjectMutationErrorCode,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
  encoding: Schema.optionalKey(ProjectFileEncoding),
  overwrite: Schema.optionalKey(Schema.Boolean),
  expectedVersionToken: Schema.optionalKey(TrimmedNonEmptyString),
  createParents: Schema.optionalKey(Schema.Boolean),
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  versionToken: TrimmedNonEmptyString,
  lastModifiedMs: NonNegativeInt,
  created: Schema.Boolean,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    code: ProjectMutationErrorCode,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

const ProjectReadFileKind = Schema.Literals(["text", "binary", "too_large"]);

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  maxBytes: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_READ_FILE_MAX_BYTES)),
  ),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  kind: ProjectReadFileKind,
  contents: Schema.optional(Schema.String),
  encoding: Schema.optional(ProjectFileEncoding),
  lineEnding: Schema.optional(ProjectLineEnding),
  versionToken: Schema.optional(TrimmedNonEmptyString),
  sizeBytes: NonNegativeInt,
  lastModifiedMs: NonNegativeInt,
  truncated: Schema.Boolean,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    code: ProjectMutationErrorCode,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCreateDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  overwrite: Schema.optionalKey(Schema.Boolean),
});
export type ProjectCreateDirectoryInput = typeof ProjectCreateDirectoryInput.Type;

export const ProjectCreateDirectoryResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  created: Schema.Boolean,
});
export type ProjectCreateDirectoryResult = typeof ProjectCreateDirectoryResult.Type;

export class ProjectCreateDirectoryError extends Schema.TaggedErrorClass<ProjectCreateDirectoryError>()(
  "ProjectCreateDirectoryError",
  {
    code: ProjectMutationErrorCode,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectDeleteEntryExpectedKind = Schema.Literals(["file", "directory"]);
export type ProjectDeleteEntryExpectedKind = typeof ProjectDeleteEntryExpectedKind.Type;

export const ProjectDeleteEntryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  recursive: Schema.optionalKey(Schema.Boolean),
  expectedKind: Schema.optionalKey(ProjectDeleteEntryExpectedKind),
});
export type ProjectDeleteEntryInput = typeof ProjectDeleteEntryInput.Type;

export const ProjectDeleteEntryResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectDeleteEntryResult = typeof ProjectDeleteEntryResult.Type;

export class ProjectDeleteEntryError extends Schema.TaggedErrorClass<ProjectDeleteEntryError>()(
  "ProjectDeleteEntryError",
  {
    code: ProjectMutationErrorCode,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectMoveEntryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sourceRelativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH),
  ),
  destinationRelativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH),
  ),
  overwrite: Schema.optionalKey(Schema.Boolean),
});
export type ProjectMoveEntryInput = typeof ProjectMoveEntryInput.Type;

export const ProjectMoveEntryResult = Schema.Struct({
  sourceRelativePath: TrimmedNonEmptyString,
  destinationRelativePath: TrimmedNonEmptyString,
});
export type ProjectMoveEntryResult = typeof ProjectMoveEntryResult.Type;

export class ProjectMoveEntryError extends Schema.TaggedErrorClass<ProjectMoveEntryError>()(
  "ProjectMoveEntryError",
  {
    code: ProjectMutationErrorCode,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
