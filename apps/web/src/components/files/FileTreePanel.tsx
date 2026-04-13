import { type EnvironmentId } from "@capycode/contracts";
import { SearchIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { FileTreeNode } from "./FileTreeNode";
import { Input } from "~/components/ui/input";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { useWorkspaceFileTree } from "~/hooks/useWorkspaceFileTree";
import { getWorkspaceDockScopeState, useWorkspaceDockStore } from "~/workspaceDockStore";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { cn } from "~/lib/utils";

export function FileTreePanel(props: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  scopeKey: string | null;
  selectedFilePath: string | null;
  resolvedTheme: "light" | "dark";
  onOpenFile: (relativePath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const revealedFilePath = useWorkspaceDockStore(
    useMemo(
      () => (state) => getWorkspaceDockScopeState(state, props.scopeKey).revealedFilePath,
      [props.scopeKey],
    ),
  );
  const setDirectoryExpanded = useWorkspaceDockStore((state) => state.setDirectoryExpanded);
  const tree = useWorkspaceFileTree({
    environmentId: props.environmentId,
    cwd: props.cwd,
    scopeKey: props.scopeKey,
    enabled: Boolean(props.cwd && props.environmentId),
    ...(revealedFilePath ? { revealedFilePath } : {}),
  });
  const searchQuery = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      query,
      enabled: query.trim().length > 0,
      limit: 80,
    }),
  );

  useEffect(() => {
    if (!revealedFilePath || !containerRef.current) {
      return;
    }
    containerRef.current
      .querySelector<HTMLElement>(`[data-file-tree-path="${CSS.escape(revealedFilePath)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [revealedFilePath, tree.rootNodes]);

  const openSearchResult = async (path: string, kind: "file" | "directory") => {
    if (kind === "file") {
      props.onOpenFile(path);
      return;
    }
    if (!props.scopeKey) {
      return;
    }
    await tree.revealPath(`${path}/placeholder`);
    setDirectoryExpanded(props.scopeKey, path, true);
    setQuery("");
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-3 py-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            nativeInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search files"
            className="pl-8"
            type="search"
          />
        </div>
      </div>
      <div
        ref={containerRef}
        className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
      >
        {query.trim().length > 0 ? (
          <div className="space-y-0.5">
            {searchQuery.data?.entries.map((entry) => (
              <button
                key={`${entry.kind}:${entry.path}`}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50",
                  props.selectedFilePath === entry.path && "bg-accent",
                )}
                onClick={() => void openSearchResult(entry.path, entry.kind)}
              >
                <VscodeEntryIcon
                  pathValue={entry.path}
                  kind={entry.kind}
                  theme={props.resolvedTheme}
                  className="size-4"
                />
                <span className="truncate">{entry.path}</span>
              </button>
            ))}
            {searchQuery.isFetching ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">
                Searching workspace files...
              </div>
            ) : null}
            {!searchQuery.isFetching && (searchQuery.data?.entries.length ?? 0) === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">No matching files.</div>
            ) : null}
          </div>
        ) : tree.isLoadingRoot ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">Loading files...</div>
        ) : tree.rootError ? (
          <div className="px-2 py-3 text-sm text-destructive">
            Failed to load files. {tree.rootError instanceof Error ? tree.rootError.message : ""}
          </div>
        ) : (
          <div className="space-y-0.5">
            {tree.rootNodes.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedFilePath={props.selectedFilePath}
                resolvedTheme={props.resolvedTheme}
                onOpenFile={props.onOpenFile}
                onToggleDirectory={(path) => void tree.toggleDirectory(path)}
              />
            ))}
            {tree.rootNodes.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">
                No files in this workspace.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
