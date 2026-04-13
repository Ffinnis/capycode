import { MessageSquareTextIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { cn } from "~/lib/utils";

export function OpenSurfaceTabs(props: {
  openFileTabs: readonly string[];
  activeTab: "chat" | string;
  resolvedTheme: "light" | "dark";
  onSelectChat: () => void;
  onSelectFile: (relativePath: string) => void;
  onCloseFile: (relativePath: string) => void;
}) {
  return (
    <div className="border-b border-border/80 bg-card/60 px-3 sm:px-5">
      <div className="flex gap-2 overflow-x-auto py-2">
        <Button
          variant={props.activeTab === "chat" ? "secondary" : "outline"}
          size="xs"
          className="shrink-0"
          onClick={props.onSelectChat}
        >
          <MessageSquareTextIcon className="size-3.5" />
          Chat
        </Button>
        {props.openFileTabs.map((relativePath) => {
          const isActive = props.activeTab === relativePath;
          return (
            <div
              key={relativePath}
              className={cn(
                "flex shrink-0 items-center rounded-lg border",
                isActive ? "border-border bg-accent" : "border-input bg-background",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-sm"
                onClick={() => props.onSelectFile(relativePath)}
              >
                <VscodeEntryIcon
                  pathValue={relativePath}
                  kind="file"
                  theme={props.resolvedTheme}
                  className="size-4"
                />
                <span className="max-w-52 truncate">{relativePath.split("/").at(-1)}</span>
              </button>
              <button
                type="button"
                className="rounded-r-lg p-1.5 text-muted-foreground hover:bg-background/70 hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCloseFile(relativePath);
                }}
                aria-label={`Close ${relativePath}`}
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
