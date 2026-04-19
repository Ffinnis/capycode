import { type EnvironmentId } from "@capycode/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";

import { FileTreeNode } from "./FileTreeNode";
import { Input } from "~/components/ui/input";
import { confirm } from "~/components/ui/confirmation-dialog.logic";
import { toastManager } from "~/components/ui/toast";
import { ensureLocalApi } from "~/localApi";
import { FILE_PREVIEW_MAX_BYTES } from "~/lib/filePreview";
import { serializeFileContents } from "~/lib/fileLineEndings";
import {
  projectReadFileQueryOptions,
  projectSearchEntriesQueryOptions,
} from "~/lib/projectReactQuery";
import { useWorkspaceFileMutations } from "~/hooks/useWorkspaceFileMutations";
import { useWorkspaceFileTree } from "~/hooks/useWorkspaceFileTree";
import { readDroppedWorkspaceFiles, useWorkspaceDropTarget } from "~/hooks/useWorkspaceDropTarget";
import { getWorkspaceDockScopeState, useWorkspaceDockStore } from "~/workspaceDockStore";
import {
  getWorkspaceEditorBuffer,
  getWorkspaceEditorBuffersByScopeKey,
  useWorkspaceEditorStore,
} from "~/workspaceEditorStore";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { cn } from "~/lib/utils";
import type { WorkspaceFileTreeNode } from "~/hooks/useWorkspaceFileTree";

function parentPathOf(relativePath: string): string | undefined {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? undefined : relativePath.slice(0, index);
}

function joinRelativePath(parentRelativePath: string | undefined, childName: string): string {
  return parentRelativePath ? `${parentRelativePath}/${childName}` : childName;
}

function getErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Workspace file action failed.";
}

function findTreeNodeByPath(
  nodes: readonly WorkspaceFileTreeNode[],
  relativePath: string,
): WorkspaceFileTreeNode | null {
  for (const node of nodes) {
    if (node.path === relativePath) {
      return node;
    }
    if (node.kind === "directory") {
      const match = findTreeNodeByPath(node.children, relativePath);
      if (match) {
        return match;
      }
    }
  }
  return null;
}

export function FileTreePanel(props: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  scopeKey: string | null;
  selectedFilePath: string | null;
  resolvedTheme: "light" | "dark";
  onOpenFile: (relativePath: string) => void;
  onMovedPath: (fromRelativePath: string, toRelativePath: string) => void;
  onDeletedPath: (relativePath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingRevealPathRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const revealedFilePath = useWorkspaceDockStore(
    useMemo(
      () => (state) => getWorkspaceDockScopeState(state, props.scopeKey).revealedFilePath,
      [props.scopeKey],
    ),
  );
  const setDirectoryExpanded = useWorkspaceDockStore((state) => state.setDirectoryExpanded);
  const markSaving = useWorkspaceEditorStore((state) => state.markSaving);
  const markSaveSucceeded = useWorkspaceEditorStore((state) => state.markSaveSucceeded);
  const markSaveFailed = useWorkspaceEditorStore((state) => state.markSaveFailed);
  const removeBuffer = useWorkspaceEditorStore((state) => state.removeBuffer);
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
  const { createDirectory, deleteEntry, moveEntry, uploadFiles, writeFile } =
    useWorkspaceFileMutations({
      environmentId: props.environmentId,
      cwd: props.cwd,
      scopeKey: props.scopeKey,
    });

  const prefetchFilePreview = useMemo(
    () => (relativePath: string) => {
      if (!props.environmentId || !props.cwd) {
        return;
      }
      void queryClient.prefetchQuery(
        projectReadFileQueryOptions({
          environmentId: props.environmentId,
          cwd: props.cwd,
          relativePath,
          maxBytes: FILE_PREVIEW_MAX_BYTES,
        }),
      );
    },
    [props.cwd, props.environmentId, queryClient],
  );

  const rootDropTarget = useWorkspaceDropTarget({
    onDropFiles: async (files) => {
      await uploadFiles(undefined, files);
      await tree.refreshDirectory();
    },
  });

  useEffect(() => {
    pendingRevealPathRef.current = revealedFilePath ?? null;
  }, [revealedFilePath]);

  useEffect(() => {
    const pendingRevealPath = pendingRevealPathRef.current;
    if (!pendingRevealPath || !containerRef.current) {
      return;
    }
    const target = containerRef.current.querySelector<HTMLElement>(
      `[data-file-tree-path="${CSS.escape(pendingRevealPath)}"]`,
    );
    if (!target) {
      return;
    }
    target.scrollIntoView({ block: "nearest" });
    if (pendingRevealPathRef.current === pendingRevealPath) {
      pendingRevealPathRef.current = null;
    }
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

  const chooseAction = async <T extends string>(
    items: ReadonlyArray<{ id: T; label: string; destructive?: boolean; disabled?: boolean }>,
    position?: { x: number; y: number },
  ) => {
    return ensureLocalApi().contextMenu.show(items, position);
  };

  const saveDirtyBuffer = async (relativePath: string) => {
    if (!props.scopeKey) {
      return true;
    }
    const buffer = getWorkspaceEditorBuffer(
      useWorkspaceEditorStore.getState(),
      props.scopeKey,
      relativePath,
    );
    if (!buffer?.isDirty) {
      return true;
    }

    markSaving(props.scopeKey, relativePath, true);
    try {
      const result = await writeFile({
        relativePath,
        contents: serializeFileContents(buffer.contents, buffer.lineEnding),
        ...(buffer.versionToken ? { expectedVersionToken: buffer.versionToken } : {}),
      });
      markSaveSucceeded(props.scopeKey, relativePath, {
        contents: buffer.contents,
        versionToken: result.versionToken,
        lastSavedAt: new Date(result.lastModifiedMs).toISOString(),
      });
      return true;
    } catch (error) {
      markSaveFailed(props.scopeKey, relativePath, getErrorMessage(error));
      toastManager.add({
        type: "error",
        title: "Save failed",
        description: getErrorMessage(error),
      });
      return false;
    }
  };

  const chooseDirtyBufferAction = async (
    relativePaths: readonly string[],
  ): Promise<"save" | "discard" | "cancel" | "clean"> => {
    if (!props.scopeKey) {
      return "clean";
    }
    const dirtyPaths = relativePaths.filter((relativePath) => {
      const buffer = getWorkspaceEditorBuffer(
        useWorkspaceEditorStore.getState(),
        props.scopeKey,
        relativePath,
      );
      return Boolean(buffer?.isDirty);
    });
    if (dirtyPaths.length === 0) {
      return "clean";
    }

    const action = await chooseAction(
      [
        { id: "save", label: "Save then continue" },
        { id: "discard", label: "Discard changes" },
        { id: "cancel", label: "Cancel" },
      ],
      {
        x: Math.max(16, Math.round(window.innerWidth / 2 - 120)),
        y: Math.max(16, Math.round(window.innerHeight / 2 - 56)),
      },
    );
    return action ?? "cancel";
  };

  const handleDirtyFileAction = async (relativePath: string) => {
    const action = await chooseDirtyBufferAction([relativePath]);
    if (action === "clean") {
      return { proceed: true, discardPaths: [] as string[] };
    }
    if (action === "save") {
      const saved = await saveDirtyBuffer(relativePath);
      return { proceed: saved, discardPaths: [] as string[] };
    }
    if (action === "discard") {
      return { proceed: true, discardPaths: [relativePath] };
    }
    return { proceed: false, discardPaths: [] as string[] };
  };

  const handleDirtyDirectoryDeleteAction = async (relativePath: string) => {
    if (!props.scopeKey) {
      return { proceed: true, discardPaths: [] as string[] };
    }
    const descendantDirtyPaths = Object.entries(
      getWorkspaceEditorBuffersByScopeKey(useWorkspaceEditorStore.getState(), props.scopeKey),
    )
      .filter(
        ([path, buffer]) =>
          buffer.isDirty && (path === relativePath || path.startsWith(`${relativePath}/`)),
      )
      .map(([path]) => path);

    const action = await chooseDirtyBufferAction(descendantDirtyPaths);
    if (action === "clean") {
      return { proceed: true, discardPaths: [] as string[] };
    }
    if (action === "save") {
      for (const dirtyPath of descendantDirtyPaths) {
        const saved = await saveDirtyBuffer(dirtyPath);
        if (!saved) {
          return { proceed: false, discardPaths: [] as string[] };
        }
      }
      return { proceed: true, discardPaths: [] as string[] };
    }
    if (action === "discard") {
      return { proceed: true, discardPaths: descendantDirtyPaths };
    }
    return { proceed: false, discardPaths: [] as string[] };
  };

  const refreshTouchedDirectories = async (...relativePaths: Array<string | undefined>) => {
    const uniquePaths = [...new Set(relativePaths)];
    await Promise.all(uniquePaths.map((relativePath) => tree.refreshDirectory(relativePath)));
  };

  const performMoveToDestinationPath = async (
    sourceRelativePath: string,
    destinationRelativePath: string,
    sourceKind?: "file" | "directory",
  ) => {
    if (
      destinationRelativePath === sourceRelativePath ||
      destinationRelativePath.startsWith(`${sourceRelativePath}/`)
    ) {
      return false;
    }

    try {
      await moveEntry({
        sourceRelativePath,
        destinationRelativePath,
      });
      if (sourceKind === "directory") {
        tree.renameCachedPath(sourceRelativePath, destinationRelativePath);
      }
      await refreshTouchedDirectories(
        parentPathOf(sourceRelativePath),
        parentPathOf(destinationRelativePath),
      );
      props.onMovedPath(sourceRelativePath, destinationRelativePath);
      return true;
    } catch (error) {
      if (getErrorCode(error) === "already_exists") {
        toastManager.add({
          type: "error",
          title: "Move blocked",
          description: "Destination already exists. Choose a different name or location.",
        });
        return false;
      }

      toastManager.add({
        type: "error",
        title: "Move failed",
        description: getErrorMessage(error),
      });
      return false;
    }
  };

  const performDropMove = async (
    sourceRelativePath: string,
    targetRelativePath: string,
    targetKind: "file" | "directory",
  ) => {
    const destinationParentPath =
      targetKind === "directory" ? targetRelativePath : parentPathOf(targetRelativePath);
    const entryName = sourceRelativePath.split("/").at(-1);
    if (!entryName) {
      return;
    }
    const destinationRelativePath = joinRelativePath(destinationParentPath, entryName);
    const sourceKind = findTreeNodeByPath(tree.rootNodes, sourceRelativePath)?.kind;
    await performMoveToDestinationPath(sourceRelativePath, destinationRelativePath, sourceKind);
  };

  const createEntry = async (
    parentRelativePath: string | undefined,
    kind: "file" | "directory",
  ) => {
    const name = window.prompt(kind === "file" ? "New file name" : "New folder name", "");
    if (!name) {
      return;
    }
    const relativePath = joinRelativePath(parentRelativePath, name.trim());
    if (!relativePath) {
      return;
    }

    try {
      if (kind === "file") {
        await writeFile({
          relativePath,
          contents: "",
          createParents: true,
        });
        await refreshTouchedDirectories(parentRelativePath);
        await tree.revealPath(relativePath);
        props.onOpenFile(relativePath);
        return;
      }

      await createDirectory(relativePath);
      await refreshTouchedDirectories(parentRelativePath, relativePath);
      if (props.scopeKey) {
        setDirectoryExpanded(props.scopeKey, relativePath, true);
      }
      await tree.revealPath(`${relativePath}/placeholder`);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: kind === "file" ? "File creation failed" : "Folder creation failed",
        description: getErrorMessage(error),
      });
    }
  };

  const handleRenameNode = async (node: WorkspaceFileTreeNode) => {
    let discardAfterRename = false;
    if (node.kind === "file") {
      const dirtyAction = await handleDirtyFileAction(node.path);
      if (!dirtyAction.proceed) {
        return;
      }
      discardAfterRename = dirtyAction.discardPaths.length > 0;
    }

    const nextName = window.prompt("Rename entry", node.name);
    if (!nextName || nextName.trim() === node.name) {
      return;
    }
    const destinationRelativePath = joinRelativePath(parentPathOf(node.path), nextName.trim());
    const moved = await performMoveToDestinationPath(node.path, destinationRelativePath, node.kind);
    if (moved && node.kind === "file" && props.scopeKey && discardAfterRename) {
      removeBuffer(props.scopeKey, destinationRelativePath);
    }
  };

  const handleDeleteNode = async (node: WorkspaceFileTreeNode) => {
    if (node.kind === "file") {
      const dirtyAction = await handleDirtyFileAction(node.path);
      if (!dirtyAction.proceed) {
        return;
      }
    } else {
      const dirtyAction = await handleDirtyDirectoryDeleteAction(node.path);
      if (!dirtyAction.proceed) {
        return;
      }
    }

    const confirmed = await confirm({
      title: node.kind === "directory" ? "Delete folder?" : "Delete file?",
      description: node.path,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      await deleteEntry({
        relativePath: node.path,
        expectedKind: node.kind,
        ...(node.kind === "directory" ? { recursive: true } : {}),
      });
      if (node.kind === "directory") {
        tree.removeCachedPath(node.path);
      }
      await refreshTouchedDirectories(parentPathOf(node.path));
      props.onDeletedPath(node.path);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Delete failed",
        description: getErrorMessage(error),
      });
    }
  };

  const handleNodeContextMenu = async (
    node: WorkspaceFileTreeNode,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    const clicked = await chooseAction(
      [
        ...(node.kind === "directory"
          ? [
              { id: "new-file", label: "New File" },
              { id: "new-folder", label: "New Folder" },
            ]
          : []),
        { id: "rename", label: "Rename" },
        { id: "delete", label: "Delete", destructive: true },
      ],
      { x: event.clientX, y: event.clientY },
    );
    if (clicked === "new-file") {
      await createEntry(node.path, "file");
      return;
    }
    if (clicked === "new-folder") {
      await createEntry(node.path, "directory");
      return;
    }
    if (clicked === "rename") {
      await handleRenameNode(node);
      return;
    }
    if (clicked === "delete") {
      await handleDeleteNode(node);
    }
  };

  const handleNodeDropFiles = async (
    destinationRelativePath: string | undefined,
    event: DragEvent<HTMLButtonElement>,
  ) => {
    const result = await readDroppedWorkspaceFiles(event.dataTransfer);
    await uploadFiles(destinationRelativePath, result.files);
    await refreshTouchedDirectories(destinationRelativePath);
    if (result.hasUnsupportedDirectories) {
      toastManager.add({
        type: "warning",
        title: "Folder upload not fully supported",
        description: "This browser exposed the dropped files without recursive folder access.",
      });
    }
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
        className={cn(
          "h-0 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2",
          rootDropTarget.isDragOver && "bg-accent/30",
        )}
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          event.preventDefault();
          void chooseAction(
            [
              { id: "new-file", label: "New File" },
              { id: "new-folder", label: "New Folder" },
            ],
            { x: event.clientX, y: event.clientY },
          ).then((clicked) => {
            if (clicked === "new-file") {
              void createEntry(undefined, "file");
            } else if (clicked === "new-folder") {
              void createEntry(undefined, "directory");
            }
          });
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            rootDropTarget.onDragOver(event);
            return;
          }
          if (!draggedPath) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            rootDropTarget.onDragEnter(event);
          }
        }}
        onDragLeave={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            rootDropTarget.onDragLeave(event);
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            void rootDropTarget.onDrop(event);
            return;
          }
          if (!draggedPath || event.target !== event.currentTarget) {
            return;
          }
          event.preventDefault();
          setDropTargetPath(null);
          const targetName = draggedPath.split("/").at(-1);
          if (!targetName) {
            setDraggedPath(null);
            return;
          }
          const sourceKind = findTreeNodeByPath(tree.rootNodes, draggedPath)?.kind;
          void performMoveToDestinationPath(draggedPath, targetName, sourceKind).finally(() => {
            setDraggedPath(null);
          });
        }}
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
                onMouseEnter={() => {
                  if (entry.kind === "file") {
                    prefetchFilePreview(entry.path);
                  }
                }}
                onFocus={() => {
                  if (entry.kind === "file") {
                    prefetchFilePreview(entry.path);
                  }
                }}
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
                draggedPath={draggedPath}
                dropTargetPath={dropTargetPath}
                onOpenFile={props.onOpenFile}
                onPrefetchFile={prefetchFilePreview}
                onToggleDirectory={(path) => void tree.toggleDirectory(path)}
                onContextMenu={handleNodeContextMenu}
                onStartDrag={(relativePath, event) => {
                  setDraggedPath(relativePath);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-capycode-workspace-path", relativePath);
                }}
                onEndDrag={() => {
                  setDraggedPath(null);
                  setDropTargetPath(null);
                }}
                onSetDropTarget={setDropTargetPath}
                onDropEntry={(sourceRelativePath, targetRelativePath, targetKind) =>
                  performDropMove(sourceRelativePath, targetRelativePath, targetKind)
                }
                onDropFiles={handleNodeDropFiles}
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
