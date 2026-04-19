import { ChevronRightIcon, FolderIcon, LoaderCircleIcon } from "lucide-react";
import { type DragEvent, type MouseEvent } from "react";

import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { cn } from "~/lib/utils";
import type { WorkspaceFileTreeNode } from "~/hooks/useWorkspaceFileTree";

function parentPathOf(relativePath: string): string | undefined {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? undefined : relativePath.slice(0, index);
}

export function FileTreeNode(props: {
  node: WorkspaceFileTreeNode;
  depth: number;
  selectedFilePath: string | null;
  resolvedTheme: "light" | "dark";
  draggedPath: string | null;
  dropTargetPath: string | null;
  onOpenFile: (relativePath: string) => void;
  onPrefetchFile?: (relativePath: string) => void;
  onToggleDirectory: (relativePath: string) => void;
  onContextMenu: (node: WorkspaceFileTreeNode, event: MouseEvent<HTMLButtonElement>) => void;
  onStartDrag: (relativePath: string, event: DragEvent<HTMLButtonElement>) => void;
  onEndDrag: () => void;
  onSetDropTarget: (relativePath: string | null) => void;
  onDropEntry: (
    sourceRelativePath: string,
    targetRelativePath: string,
    targetKind: "file" | "directory",
  ) => Promise<void> | void;
  onDropFiles: (
    destinationRelativePath: string | undefined,
    event: DragEvent<HTMLButtonElement>,
  ) => Promise<void> | void;
}) {
  const { node } = props;
  const leftPadding = 12 + props.depth * 14;
  const isSelected = node.kind === "file" && props.selectedFilePath === node.path;
  const isDropTarget =
    props.dropTargetPath === node.path &&
    props.draggedPath !== null &&
    props.draggedPath !== node.path;
  const fileDropDestination = node.kind === "directory" ? node.path : parentPathOf(node.path);

  return (
    <div>
      <button
        type="button"
        data-file-tree-path={node.path}
        draggable
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50",
          isSelected && "bg-accent text-foreground",
          isDropTarget && "bg-accent/70 ring-1 ring-border",
        )}
        style={{ paddingLeft: `${leftPadding}px` }}
        onContextMenu={(event) => props.onContextMenu(node, event)}
        onDragStart={(event) => props.onStartDrag(node.path, event)}
        onDragEnd={props.onEndDrag}
        onMouseEnter={() => {
          if (node.kind === "file") {
            props.onPrefetchFile?.(node.path);
          }
        }}
        onFocus={() => {
          if (node.kind === "file") {
            props.onPrefetchFile?.(node.path);
          }
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files") && props.draggedPath === null) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes("Files")
            ? "copy"
            : "move";
          props.onSetDropTarget(node.path);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
            return;
          }
          props.onSetDropTarget(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          props.onSetDropTarget(null);
          const sourceRelativePath =
            event.dataTransfer.getData("application/x-capycode-workspace-path") ||
            props.draggedPath;
          if (sourceRelativePath) {
            void props.onDropEntry(sourceRelativePath, node.path, node.kind);
            props.onEndDrag();
            return;
          }
          void props.onDropFiles(fileDropDestination, event);
        }}
        onClick={() =>
          node.kind === "directory"
            ? props.onToggleDirectory(node.path)
            : props.onOpenFile(node.path)
        }
      >
        {node.kind === "directory" ? (
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              node.isExpanded && "rotate-90",
            )}
          />
        ) : (
          <span className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        {node.kind === "directory" ? (
          node.isLoading ? (
            <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground/70" />
          ) : (
            <VscodeEntryIcon
              pathValue={node.path}
              kind="directory"
              isOpen={node.isExpanded}
              theme={props.resolvedTheme}
              className="size-4"
            />
          )
        ) : (
          <VscodeEntryIcon
            pathValue={node.path}
            kind="file"
            theme={props.resolvedTheme}
            className="size-4"
          />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {node.kind === "directory" ? (
          <FolderIcon className="hidden size-3.5 shrink-0 text-muted-foreground/55 group-hover:block" />
        ) : null}
      </button>
      {node.kind === "directory" && node.isExpanded ? (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={props.depth + 1}
              selectedFilePath={props.selectedFilePath}
              resolvedTheme={props.resolvedTheme}
              draggedPath={props.draggedPath}
              dropTargetPath={props.dropTargetPath}
              onOpenFile={props.onOpenFile}
              {...(props.onPrefetchFile ? { onPrefetchFile: props.onPrefetchFile } : {})}
              onToggleDirectory={props.onToggleDirectory}
              onContextMenu={props.onContextMenu}
              onStartDrag={props.onStartDrag}
              onEndDrag={props.onEndDrag}
              onSetDropTarget={props.onSetDropTarget}
              onDropEntry={props.onDropEntry}
              onDropFiles={props.onDropFiles}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
