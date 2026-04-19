import { LoaderCircleIcon, MessageSquareTextIcon, TerminalSquareIcon, XIcon } from "lucide-react";

import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { cn } from "~/lib/utils";
import { WORKSPACE_TERMINAL_TAB_ID } from "~/workspaceDockStore";

export function OpenSurfaceTabs(props: {
  openFileTabs: readonly string[];
  activeTab: "chat" | string;
  dirtyFileTabs?: readonly string[];
  savingFileTabs?: readonly string[];
  resolvedTheme: "light" | "dark";
  showTerminalTab: boolean;
  onSelectChat: () => void;
  onSelectTerminal: () => void;
  onSelectFile: (relativePath: string) => void;
  onPrefetchFile?: (relativePath: string) => void;
  onCloseFile: (relativePath: string) => void;
}) {
  const tabClassName = (isActive: boolean) =>
    cn(
      "group flex shrink-0 items-center rounded-[13px] border transition-colors",
      isActive
        ? "border-border bg-accent text-foreground shadow-sm/5"
        : "border-input bg-background/80 text-muted-foreground hover:border-border/80 hover:bg-background hover:text-foreground",
    );

  return (
    <div className="border-b border-border/80 bg-card/50 px-3 sm:px-5">
      <div className="flex gap-2 overflow-x-auto py-1.5">
        <div className={tabClassName(props.activeTab === "chat")}>
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 px-2.5 py-1 text-left text-xs font-medium"
            onClick={props.onSelectChat}
          >
            <MessageSquareTextIcon className="size-3 shrink-0" />
            <span className="truncate">Chat</span>
          </button>
        </div>
        {props.showTerminalTab ? (
          <div className={tabClassName(props.activeTab === WORKSPACE_TERMINAL_TAB_ID)}>
            <button
              type="button"
              className="flex min-w-0 items-center gap-1.5 px-2.5 py-1 text-left text-xs font-medium"
              onClick={props.onSelectTerminal}
            >
              <TerminalSquareIcon className="size-3 shrink-0" />
              <span className="truncate">Terminal</span>
            </button>
          </div>
        ) : null}
        {props.openFileTabs.map((relativePath) => {
          const isActive = props.activeTab === relativePath;
          const isDirty = props.dirtyFileTabs?.includes(relativePath) ?? false;
          const isSaving = props.savingFileTabs?.includes(relativePath) ?? false;
          return (
            <div key={relativePath} className={tabClassName(isActive)}>
              <button
                type="button"
                className="flex min-w-0 items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
                onClick={() => props.onSelectFile(relativePath)}
                onMouseEnter={() => props.onPrefetchFile?.(relativePath)}
                onFocus={() => props.onPrefetchFile?.(relativePath)}
              >
                <VscodeEntryIcon
                  pathValue={relativePath}
                  kind="file"
                  theme={props.resolvedTheme}
                  className="size-3"
                />
                {isSaving ? (
                  <LoaderCircleIcon className="size-3 animate-spin text-muted-foreground" />
                ) : isDirty ? (
                  <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                ) : null}
                <span className="max-w-36 truncate">{relativePath.split("/").at(-1)}</span>
                {isDirty ? (
                  <span className="sr-only">{`${relativePath} has unsaved changes`}</span>
                ) : null}
              </button>
              <button
                type="button"
                className="rounded-r-[13px] p-1 text-muted-foreground/75 hover:bg-background/70 hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCloseFile(relativePath);
                }}
                aria-label={`Close ${relativePath}`}
              >
                <XIcon className="size-2.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
