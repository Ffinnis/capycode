import { type EnvironmentId } from "@capycode/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { FilePreviewToolbar } from "./FilePreviewToolbar";
import { FilePreviewUnsupported } from "./FilePreviewUnsupported";
import { projectReadFileQueryOptions } from "~/lib/projectReactQuery";
import { readLocalApi } from "~/localApi";
import { openInPreferredEditor } from "~/editorPreferences";
import { resolvePathLinkTarget } from "~/terminal-links";

const PREVIEW_MAX_BYTES = 256 * 1024;

export function FilePreviewPanel(props: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string;
  onBack?: () => void;
  variant?: "main" | "sidebar";
}) {
  const [wrap, setWrap] = useState(false);
  const previewQuery = useQuery(
    projectReadFileQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      relativePath: props.relativePath,
      maxBytes: PREVIEW_MAX_BYTES,
      enabled: Boolean(props.environmentId && props.cwd),
    }),
  );

  const openInEditor = async () => {
    const api = readLocalApi();
    if (!api || !props.cwd) {
      return;
    }
    await openInPreferredEditor(api, resolvePathLinkTarget(props.relativePath, props.cwd));
  };

  const result = previewQuery.data;
  const unsupportedKind = result && result.kind !== "text" ? result.kind : null;
  const variant = props.variant ?? "sidebar";
  const previewLines = useMemo(() => {
    if (!result?.contents) {
      return [];
    }

    let offset = 0;
    return result.contents.split("\n").map((line, index) => {
      const lineOffset = offset;
      offset += line.length + 1;
      return {
        key: String(lineOffset),
        line,
        lineNumber: index + 1,
      };
    });
  }, [result?.contents]);

  return (
    <div
      className={
        variant === "main"
          ? "flex h-full min-h-0 flex-1 flex-col bg-background"
          : "flex h-full min-h-0 flex-1 flex-col border-l border-border bg-card"
      }
    >
      <FilePreviewToolbar
        filePath={props.relativePath}
        wrap={wrap}
        onToggleWrap={() => setWrap((current) => !current)}
        onOpenInEditor={() => void openInEditor()}
        {...(props.onBack ? { onBack: props.onBack } : {})}
      />
      {previewQuery.isLoading || !result ? (
        <div className="px-4 py-4 text-sm text-muted-foreground">Loading file preview...</div>
      ) : unsupportedKind || result.contents === undefined ? (
        <FilePreviewUnsupported
          kind={unsupportedKind ?? "too_large"}
          sizeBytes={result.sizeBytes}
          onOpenInEditor={() => void openInEditor()}
        />
      ) : (
        <div className="h-0 min-h-0 flex-1 overflow-auto overscroll-contain">
          <div className="min-w-max font-mono text-[12px] leading-5">
            {previewLines.map(({ key, line, lineNumber }) => (
              <div key={key} className="grid grid-cols-[auto_1fr] gap-4 px-4 py-0.5">
                <span className="select-none text-right text-muted-foreground/60 tabular-nums">
                  {lineNumber}
                </span>
                <pre className={wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}>
                  {line.length > 0 ? line : " "}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
