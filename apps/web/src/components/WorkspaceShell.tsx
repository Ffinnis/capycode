import { Sheet, SheetPopup } from "./ui/sheet";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useMemo, useRef } from "react";

import { useWorkspaceDockStore } from "~/workspaceDockStore";
import { cn } from "~/lib/utils";

const FILES_PANEL_MIN_WIDTH = 240;
const FILES_PANEL_MAX_WIDTH = 420;
const CONTEXT_PANEL_MIN_WIDTH = 360;
const MAIN_PANEL_MIN_WIDTH = 540;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function WorkspaceShell(props: {
  main: ReactNode;
  filesOpen: boolean;
  contextOpen: boolean;
  filesPanel?: ReactNode;
  contextPanel?: ReactNode;
  useSheet: boolean;
  sheetOpen: boolean;
  sheetContent?: ReactNode;
  onCloseSheet: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const filesPanelWidth = useWorkspaceDockStore((state) => state.filesPanelWidth);
  const contextPanelWidth = useWorkspaceDockStore((state) => state.contextPanelWidth);
  const setFilesPanelWidth = useWorkspaceDockStore((state) => state.setFilesPanelWidth);
  const setContextPanelWidth = useWorkspaceDockStore((state) => state.setContextPanelWidth);

  const maxContextWidth = useMemo(() => {
    const wrapperWidth = wrapperRef.current?.clientWidth ?? 0;
    return wrapperWidth > 0 ? wrapperWidth * 0.55 : Number.POSITIVE_INFINITY;
  }, [props.contextOpen, props.filesOpen]);

  const beginResize = (
    target: "files" | "context",
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startFilesWidth = filesPanelWidth;
    const startContextWidth = contextPanelWidth;
    const totalWidth = wrapper.clientWidth;
    const maxContext = Math.min(totalWidth * 0.55, totalWidth - MAIN_PANEL_MIN_WIDTH);
    const maxFiles =
      totalWidth - MAIN_PANEL_MIN_WIDTH - (props.contextOpen ? startContextWidth : 0);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (target === "files") {
        setFilesPanelWidth(
          clamp(
            startFilesWidth - delta,
            FILES_PANEL_MIN_WIDTH,
            Math.min(FILES_PANEL_MAX_WIDTH, maxFiles),
          ),
        );
        return;
      }
      setContextPanelWidth(
        clamp(
          startContextWidth - delta,
          CONTEXT_PANEL_MIN_WIDTH,
          Math.max(CONTEXT_PANEL_MIN_WIDTH, maxContext),
        ),
      );
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  if (props.useSheet) {
    return (
      <>
        {props.main}
        <Sheet
          open={props.sheetOpen}
          onOpenChange={(open) => {
            if (!open) {
              props.onCloseSheet();
            }
          }}
        >
          <SheetPopup
            side="right"
            keepMounted
            showCloseButton={false}
            className="w-[min(92vw,820px)] max-w-[820px] p-0"
          >
            {props.sheetContent}
          </SheetPopup>
        </Sheet>
      </>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="flex h-dvh max-h-dvh min-h-0 min-w-0 flex-1 items-stretch overflow-hidden bg-background"
    >
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {props.main}
      </div>
      {props.filesOpen ? (
        <>
          <button
            type="button"
            className="w-1 shrink-0 cursor-col-resize bg-border/70 transition-colors hover:bg-border"
            aria-label="Resize files panel"
            onPointerDown={(event) => beginResize("files", event)}
          />
          <aside
            className={cn("flex h-full min-h-0 shrink-0 flex-col overflow-hidden")}
            style={{ width: `${filesPanelWidth}px` }}
          >
            {props.filesPanel}
          </aside>
        </>
      ) : null}
      {props.contextOpen ? (
        <>
          <button
            type="button"
            className="w-1 shrink-0 cursor-col-resize bg-border/70 transition-colors hover:bg-border"
            aria-label="Resize context panel"
            onPointerDown={(event) => beginResize("context", event)}
          />
          <aside
            className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden"
            style={{
              width: `${clamp(contextPanelWidth, CONTEXT_PANEL_MIN_WIDTH, maxContextWidth)}px`,
            }}
          >
            {props.contextPanel}
          </aside>
        </>
      ) : null}
    </div>
  );
}
