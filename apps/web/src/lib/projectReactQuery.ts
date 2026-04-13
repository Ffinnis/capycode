import type { EnvironmentId, ProjectSearchEntriesResult } from "@capycode/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureEnvironmentApi } from "~/environmentApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  listDirectory: (environmentId: EnvironmentId | null, cwd: string | null, relativePath?: string) =>
    ["projects", "list-directory", environmentId ?? null, cwd, relativePath ?? null] as const,
  readFile: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    relativePath: string | null,
    maxBytes?: number,
  ) =>
    ["projects", "read-file", environmentId ?? null, cwd, relativePath, maxBytes ?? null] as const,
  searchEntries: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    query: string,
    limit: number,
  ) => ["projects", "search-entries", environmentId ?? null, cwd, query, limit] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const DEFAULT_READ_FILE_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};

export function projectListDirectoryQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath?: string;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.listDirectory(input.environmentId, input.cwd, input.relativePath),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Workspace directory listing is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.listDirectory({
        cwd: input.cwd,
        ...(input.relativePath ? { relativePath: input.relativePath } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    retry: false,
  });
}

export function projectReadFileQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
  maxBytes?: number;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.readFile(
      input.environmentId,
      input.cwd,
      input.relativePath,
      input.maxBytes,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || !input.relativePath) {
        throw new Error("Workspace file preview is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
        ...(input.maxBytes ? { maxBytes: input.maxBytes } : {}),
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.relativePath !== null,
    staleTime: input.staleTime ?? DEFAULT_READ_FILE_STALE_TIME,
    retry: false,
  });
}

export function projectSearchEntriesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.environmentId, input.cwd, input.query, limit),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Workspace entry search is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
    retry: false,
  });
}
