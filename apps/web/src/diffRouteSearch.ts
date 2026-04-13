import { TurnId } from "@capycode/contracts";

export interface DiffRouteSearch {
  diff?: "1" | undefined;
  files?: "1" | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
  file?: string | undefined;
}

function isDiffOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "diff" | "files" | "diffTurnId" | "diffFilePath" | "file"> {
  const {
    diff: _diff,
    files: _files,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    file: _file,
    ...rest
  } = params;
  return rest as Omit<T, "diff" | "files" | "diffTurnId" | "diffFilePath" | "file">;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const diff = isDiffOpenValue(search.diff) ? "1" : undefined;
  const files = isDiffOpenValue(search.files) ? "1" : undefined;
  const diffTurnIdRaw = diff ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.make(diffTurnIdRaw) : undefined;
  const diffFilePath = diff && diffTurnId ? normalizeSearchString(search.diffFilePath) : undefined;
  const file = normalizeSearchString(search.file);

  return {
    ...(diff ? { diff } : {}),
    ...(files ? { files } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
    ...(file ? { file } : {}),
  };
}
