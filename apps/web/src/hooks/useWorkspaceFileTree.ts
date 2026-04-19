import { type EnvironmentId } from "@capycode/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { projectListDirectoryQueryOptions } from "~/lib/projectReactQuery";
import { getWorkspaceDockScopeState, useWorkspaceDockStore } from "~/workspaceDockStore";

export interface WorkspaceFileTreeNode {
  path: string;
  name: string;
  kind: "file" | "directory";
  isExpanded: boolean;
  isLoading: boolean;
  children: WorkspaceFileTreeNode[];
}

function replacePathPrefix(
  candidatePath: string,
  fromRelativePath: string,
  toRelativePath: string,
): string {
  if (candidatePath === fromRelativePath) {
    return toRelativePath;
  }
  if (!candidatePath.startsWith(`${fromRelativePath}/`)) {
    return candidatePath;
  }
  return `${toRelativePath}${candidatePath.slice(fromRelativePath.length)}`;
}

function matchesPathPrefix(candidatePath: string, relativePathPrefix: string): boolean {
  return candidatePath === relativePathPrefix || candidatePath.startsWith(`${relativePathPrefix}/`);
}

export function renameDirectoryEntriesCache(
  cache: Record<string, ReadonlyArray<{ path: string; name: string; kind: "file" | "directory" }>>,
  fromRelativePath: string,
  toRelativePath: string,
) {
  const nextDirectoryName = toRelativePath.split("/").at(-1) ?? toRelativePath;
  return Object.fromEntries(
    Object.entries(cache).map(([path, entries]) => [
      replacePathPrefix(path, fromRelativePath, toRelativePath),
      entries.map((entry) => {
        const nextPath = replacePathPrefix(entry.path, fromRelativePath, toRelativePath);
        return {
          ...entry,
          path: nextPath,
          name:
            entry.kind === "directory" && nextPath === toRelativePath
              ? nextDirectoryName
              : entry.name,
        };
      }),
    ]),
  );
}

export function removeDirectoryEntriesCache(
  cache: Record<string, ReadonlyArray<{ path: string; name: string; kind: "file" | "directory" }>>,
  relativePathPrefix: string,
) {
  return Object.fromEntries(
    Object.entries(cache)
      .filter(([path]) => !matchesPathPrefix(path, relativePathPrefix))
      .map(([path, entries]) => [
        path,
        entries.filter((entry) => !matchesPathPrefix(entry.path, relativePathPrefix)),
      ]),
  );
}

export function isBlockingWorkspaceFileTreeRootLoad(input: {
  isLoading: boolean;
  rootData: ReadonlyArray<{ path: string; name: string; kind: "file" | "directory" }> | undefined;
  cachedRootData:
    | ReadonlyArray<{ path: string; name: string; kind: "file" | "directory" }>
    | undefined;
}) {
  return input.isLoading && input.rootData === undefined && input.cachedRootData === undefined;
}

export function useWorkspaceFileTree(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  scopeKey: string | null;
  enabled?: boolean;
  revealedFilePath?: string;
}) {
  const queryClient = useQueryClient();
  const [directoryEntriesByPath, setDirectoryEntriesByPath] = useState<
    Record<string, ReadonlyArray<{ path: string; name: string; kind: "file" | "directory" }>>
  >({});
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, boolean>>({});
  const expandedDirectories = useWorkspaceDockStore(
    useMemo(
      () => (state) => getWorkspaceDockScopeState(state, input.scopeKey).expandedDirectories,
      [input.scopeKey],
    ),
  );
  const setDirectoryExpanded = useWorkspaceDockStore((state) => state.setDirectoryExpanded);
  const rootDirectoryQuery = useQuery(
    projectListDirectoryQueryOptions({
      environmentId: input.environmentId,
      cwd: input.cwd,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    }),
  );

  useEffect(() => {
    setDirectoryEntriesByPath({});
    setLoadingDirectories({});
  }, [input.cwd, input.environmentId, input.scopeKey]);

  useEffect(() => {
    if (!rootDirectoryQuery.data) {
      return;
    }
    setDirectoryEntriesByPath((current) => ({
      ...current,
      "": rootDirectoryQuery.data.entries,
    }));
  }, [rootDirectoryQuery.data]);

  const fetchDirectory = useCallback(
    async (relativePath?: string, options?: { force?: boolean }) => {
      if (!input.environmentId || !input.cwd) {
        return [];
      }
      const key = relativePath ?? "";
      if (!options?.force && directoryEntriesByPath[key]) {
        return directoryEntriesByPath[key]!;
      }

      setLoadingDirectories((current) => ({ ...current, [key]: true }));
      try {
        const result = await queryClient.fetchQuery(
          projectListDirectoryQueryOptions({
            environmentId: input.environmentId,
            cwd: input.cwd,
            ...(relativePath ? { relativePath } : {}),
          }),
        );
        setDirectoryEntriesByPath((current) => ({
          ...current,
          [key]: result.entries,
        }));
        return result.entries;
      } finally {
        setLoadingDirectories((current) => ({ ...current, [key]: false }));
      }
    },
    [directoryEntriesByPath, input.cwd, input.environmentId, queryClient],
  );
  const revealPath = useCallback(
    async (relativePath: string) => {
      if (!input.scopeKey) {
        return;
      }
      const segments = relativePath.split("/").filter((segment) => segment.length > 0);
      if (segments.length <= 1) {
        return;
      }

      let parentPath = "";
      for (let index = 0; index < segments.length - 1; index += 1) {
        parentPath = parentPath ? `${parentPath}/${segments[index]}` : segments[index]!;
        await fetchDirectory(parentPath);
        setDirectoryExpanded(input.scopeKey, parentPath, true);
      }
    },
    [fetchDirectory, input.scopeKey, setDirectoryExpanded],
  );

  useEffect(() => {
    if (!input.enabled || !input.revealedFilePath) {
      return;
    }
    void revealPath(input.revealedFilePath);
  }, [input.enabled, input.revealedFilePath, revealPath]);

  const toggleDirectory = useCallback(
    async (relativePath: string) => {
      if (!input.scopeKey) {
        return;
      }
      const nextExpanded = !expandedDirectories[relativePath];
      if (nextExpanded) {
        await fetchDirectory(relativePath);
      }
      setDirectoryExpanded(input.scopeKey, relativePath, nextExpanded);
    },
    [expandedDirectories, fetchDirectory, input.scopeKey, setDirectoryExpanded],
  );

  const treeNodes = useMemo(() => {
    const buildNodes = (
      entries: ReadonlyArray<{ path: string; name: string; kind: "file" | "directory" }>,
    ): WorkspaceFileTreeNode[] =>
      entries.map((entry) => {
        const isExpanded =
          entry.kind === "directory" ? Boolean(expandedDirectories[entry.path]) : false;
        return {
          ...entry,
          isExpanded,
          isLoading: Boolean(loadingDirectories[entry.path]),
          children:
            entry.kind === "directory" && isExpanded
              ? buildNodes(directoryEntriesByPath[entry.path] ?? [])
              : [],
        };
      });

    return buildNodes(directoryEntriesByPath[""] ?? []);
  }, [directoryEntriesByPath, expandedDirectories, loadingDirectories]);
  const cachedRootData = directoryEntriesByPath[""];

  return {
    isLoadingRoot: isBlockingWorkspaceFileTreeRootLoad({
      isLoading: rootDirectoryQuery.isLoading,
      rootData: rootDirectoryQuery.data?.entries,
      cachedRootData,
    }),
    rootError: rootDirectoryQuery.error,
    revealedFilePath: input.revealedFilePath,
    rootNodes: treeNodes,
    revealPath,
    renameCachedPath: (fromRelativePath: string, toRelativePath: string) =>
      setDirectoryEntriesByPath((current) =>
        renameDirectoryEntriesCache(current, fromRelativePath, toRelativePath),
      ),
    removeCachedPath: (relativePathPrefix: string) =>
      setDirectoryEntriesByPath((current) =>
        removeDirectoryEntriesCache(current, relativePathPrefix),
      ),
    refreshDirectory: (relativePath?: string) => fetchDirectory(relativePath, { force: true }),
    toggleDirectory,
  };
}
