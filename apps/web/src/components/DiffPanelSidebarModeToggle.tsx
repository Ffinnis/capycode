import type { DiffPanelMode as ClientDiffPanelMode } from "@capycode/contracts/settings";
import { GitCommitHorizontalIcon, HistoryIcon } from "lucide-react";
import { useCallback, type MouseEvent, type PointerEvent } from "react";

import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";

import { Toggle } from "./ui/toggle";

interface DiffPanelSidebarModeToggleProps {
  diffOpen: boolean;
  onOpenDiff: () => void;
  className?: string;
}

function stopRailEvent(event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>) {
  event.stopPropagation();
}

export default function DiffPanelSidebarModeToggle({
  diffOpen,
  onOpenDiff,
  className,
}: DiffPanelSidebarModeToggleProps) {
  const diffPanelMode = useSettings((settings) => settings.diffPanelMode);
  const { updateSettings } = useUpdateSettings();

  const selectMode = useCallback(
    (nextMode: ClientDiffPanelMode) => {
      updateSettings({ diffPanelMode: nextMode });
      if (!diffOpen) {
        onOpenDiff();
      }
    },
    [diffOpen, onOpenDiff, updateSettings],
  );

  return (
    <div
      className={cn(
        "pointer-events-auto absolute left-2 top-16 z-10 flex -translate-x-full flex-col gap-1 rounded-lg border border-border/80 bg-background/95 p-1 shadow-md backdrop-blur-sm",
        className,
      )}
      data-testid="diff-sidebar-mode-toggle"
      onClick={stopRailEvent}
      onPointerDown={stopRailEvent}
    >
      <Toggle
        aria-label="Show iterations diff mode"
        className="min-w-14 justify-start px-2 text-[10px] sm:text-[10px]"
        data-testid="diff-sidebar-mode-iterations"
        pressed={diffPanelMode === "iterations"}
        size="xs"
        title="Iterations"
        variant="outline"
        onClick={() => {
          selectMode("iterations");
        }}
      >
        <HistoryIcon className="size-3" />
        <span>Iter</span>
      </Toggle>
      <Toggle
        aria-label="Show git diff mode"
        className="min-w-14 justify-start px-2 text-[10px] sm:text-[10px]"
        data-testid="diff-sidebar-mode-git"
        pressed={diffPanelMode === "git"}
        size="xs"
        title="Git"
        variant="outline"
        onClick={() => {
          selectMode("git");
        }}
      >
        <GitCommitHorizontalIcon className="size-3" />
        <span>Git</span>
      </Toggle>
    </div>
  );
}
