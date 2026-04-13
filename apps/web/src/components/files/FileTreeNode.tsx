import { ChevronRightIcon, FolderIcon, LoaderCircleIcon } from "lucide-react";

import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { cn } from "~/lib/utils";
import type { WorkspaceFileTreeNode } from "~/hooks/useWorkspaceFileTree";

export function FileTreeNode(props: {
  node: WorkspaceFileTreeNode;
  depth: number;
  selectedFilePath: string | null;
  resolvedTheme: "light" | "dark";
  onOpenFile: (relativePath: string) => void;
  onToggleDirectory: (relativePath: string) => void;
}) {
  const { node } = props;
  const leftPadding = 12 + props.depth * 14;
  const isSelected = node.kind === "file" && props.selectedFilePath === node.path;

  return (
    <div>
      <button
        type="button"
        data-file-tree-path={node.path}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50",
          isSelected && "bg-accent text-foreground",
        )}
        style={{ paddingLeft: `${leftPadding}px` }}
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
              onOpenFile={props.onOpenFile}
              onToggleDirectory={props.onToggleDirectory}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
