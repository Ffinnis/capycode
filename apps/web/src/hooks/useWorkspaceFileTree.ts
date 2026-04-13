import { type EnvironmentId } from "@capycode/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

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

  useEffect(() => {
    setDirectoryEntriesByPath({});
    setLoadingDirectories({});
  }, [input.cwd, input.environmentId, input.scopeKey]);

  const fetchDirectory = useCallback(
    async (relativePath?: string) => {
      if (!input.environmentId || !input.cwd) {
        return [];
      }
      const key = relativePath ?? "";
      if (directoryEntriesByPath[key]) {
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

  useEffect(() => {
    if (!input.enabled || !input.environmentId || !input.cwd) {
      return;
    }
    void fetchDirectory();
  }, [fetchDirectory, input.cwd, input.enabled, input.environmentId]);

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
        const isExpanded = entry.kind === "directory" ? Boolean(expandedDirectories[entry.path]) : false;
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

  return {
    isLoadingRoot: Boolean(loadingDirectories[""]) && !directoryEntriesByPath[""],
    revealedFilePath: input.revealedFilePath,
    rootNodes: treeNodes,
    revealPath,
    toggleDirectory,
  };
}
