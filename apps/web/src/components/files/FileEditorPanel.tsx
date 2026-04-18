import { type EnvironmentId } from "@capycode/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { closeBrackets, closeBracketsKeymap, autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { AlertTriangleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FilePreviewToolbar } from "./FilePreviewToolbar";
import { ensureLocalApi, readLocalApi } from "~/localApi";
import { invalidateProjectReadFile, projectReadFileQueryOptions } from "~/lib/projectReactQuery";
import { openInPreferredEditor } from "~/editorPreferences";
import { resolvePathLinkTarget } from "~/terminal-links";
import { useSettings } from "~/hooks/useSettings";
import { normalizeFileContents, serializeFileContents } from "~/lib/fileLineEndings";
import { useWorkspaceFileMutations } from "~/hooks/useWorkspaceFileMutations";
import { languageSupportForPath } from "~/lib/fileLanguage";
import { getWorkspaceEditorBuffer, useWorkspaceEditorStore } from "~/workspaceEditorStore";

interface FileEditorPanelProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  scopeKey: string | null;
  relativePath: string;
  readResult: {
    kind: "text";
    contents: string;
    versionToken?: string;
    lineEnding?: "lf" | "crlf";
    lastModifiedMs: number;
  };
  onBack?: () => void;
  variant?: "main" | "sidebar";
}

function getErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to save file.";
}

function centerMenuPosition() {
  return {
    x: Math.max(16, Math.round(window.innerWidth / 2 - 120)),
    y: Math.max(16, Math.round(window.innerHeight / 2 - 56)),
  };
}

function toEditorContents(contents: string | undefined): string {
  return normalizeFileContents(contents ?? "");
}

export function FileEditorPanel(props: FileEditorPanelProps) {
  const [wrap, setWrap] = useState(false);
  const queryClient = useQueryClient();
  const autoSaveEnabled = useSettings((settings) => settings.fileEditorAutoSave);
  const buffer = useWorkspaceEditorStore(
    useMemo(
      () => (state) => getWorkspaceEditorBuffer(state, props.scopeKey, props.relativePath),
      [props.relativePath, props.scopeKey],
    ),
  );
  const loadBuffer = useWorkspaceEditorStore((state) => state.loadBuffer);
  const updateBufferContents = useWorkspaceEditorStore((state) => state.updateBufferContents);
  const markSaving = useWorkspaceEditorStore((state) => state.markSaving);
  const markSaveSucceeded = useWorkspaceEditorStore((state) => state.markSaveSucceeded);
  const markSaveFailed = useWorkspaceEditorStore((state) => state.markSaveFailed);
  const setPendingExternalConflict = useWorkspaceEditorStore(
    (state) => state.setPendingExternalConflict,
  );
  const { writeFile } = useWorkspaceFileMutations({
    environmentId: props.environmentId,
    cwd: props.cwd,
    scopeKey: props.scopeKey,
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const initialEditorContentsRef = useRef("");
  const saveCurrentBufferRef = useRef<(() => Promise<boolean>) | null>(null);
  const scopeKeyRef = useRef(props.scopeKey);
  const relativePathRef = useRef(props.relativePath);
  const updateBufferContentsRef = useRef(updateBufferContents);
  const wrapCompartmentRef = useRef(new Compartment());
  const languageCompartmentRef = useRef(new Compartment());

  const variant = props.variant ?? "sidebar";
  const editorIdentity = `${props.scopeKey ?? "null"}:${props.relativePath}`;

  useEffect(() => {
    if (!props.scopeKey) {
      return;
    }
    const normalizedReadContents = toEditorContents(props.readResult.contents);
    const nextVersionToken = props.readResult.versionToken ?? null;
    const readResultLoadedAt = props.readResult.lastModifiedMs;
    if (!buffer) {
      loadBuffer(props.scopeKey, props.relativePath, {
        contents: normalizedReadContents,
        savedContents: normalizedReadContents,
        versionToken: nextVersionToken,
        encoding: "utf8",
        lineEnding: props.readResult.lineEnding ?? "lf",
        lastLoadedAt: new Date(readResultLoadedAt).toISOString(),
        lastSavedAt: null,
      });
      return;
    }

    if (buffer.isDirty) {
      if (
        nextVersionToken !== null &&
        buffer.versionToken !== null &&
        nextVersionToken !== buffer.versionToken &&
        !buffer.pendingExternalConflict
      ) {
        setPendingExternalConflict(props.scopeKey, props.relativePath, true);
      }
      return;
    }

    const lastLoadedAtMs = buffer.lastLoadedAt ? Date.parse(buffer.lastLoadedAt) : 0;
    const lastSavedAtMs = buffer.lastSavedAt ? Date.parse(buffer.lastSavedAt) : 0;
    if (readResultLoadedAt < Math.max(lastLoadedAtMs, lastSavedAtMs)) {
      return;
    }

    if (
      buffer.savedContents !== normalizedReadContents ||
      buffer.versionToken !== nextVersionToken ||
      buffer.lineEnding !== (props.readResult.lineEnding ?? "lf")
    ) {
      loadBuffer(props.scopeKey, props.relativePath, {
        contents: normalizedReadContents,
        savedContents: normalizedReadContents,
        versionToken: nextVersionToken,
        encoding: "utf8",
        lineEnding: props.readResult.lineEnding ?? "lf",
        lastLoadedAt: new Date(readResultLoadedAt).toISOString(),
        lastSavedAt: buffer.lastSavedAt,
      });
    }
  }, [
    buffer,
    loadBuffer,
    props.readResult.contents,
    props.readResult.lastModifiedMs,
    props.readResult.lineEnding,
    props.readResult.versionToken,
    props.relativePath,
    props.scopeKey,
    setPendingExternalConflict,
  ]);

  const saveCurrentBuffer = useCallback(
    async (options?: { ignoreVersion?: boolean }) => {
      if (!props.scopeKey || !props.cwd || !props.environmentId) {
        return false;
      }
      const currentBuffer = getWorkspaceEditorBuffer(
        useWorkspaceEditorStore.getState(),
        props.scopeKey,
        props.relativePath,
      );
      if (!currentBuffer || currentBuffer.isSaving || !currentBuffer.isDirty) {
        return true;
      }

      markSaving(props.scopeKey, props.relativePath, true);
      try {
        const result = await writeFile({
          relativePath: props.relativePath,
          contents: serializeFileContents(currentBuffer.contents, currentBuffer.lineEnding),
          ...(options?.ignoreVersion ? { overwrite: true } : {}),
          ...(!options?.ignoreVersion && currentBuffer.versionToken
            ? { expectedVersionToken: currentBuffer.versionToken }
            : {}),
        });
        markSaveSucceeded(props.scopeKey, props.relativePath, {
          contents: currentBuffer.contents,
          versionToken: result.versionToken,
          lastSavedAt: new Date(result.lastModifiedMs).toISOString(),
        });
        return true;
      } catch (error) {
        if (getErrorCode(error) === "stale_version") {
          setPendingExternalConflict(props.scopeKey, props.relativePath, true);
          markSaveFailed(props.scopeKey, props.relativePath, "File changed on disk.");
          const action = await ensureLocalApi().contextMenu.show(
            [
              { id: "reload", label: "Reload from disk" },
              { id: "overwrite", label: "Overwrite disk" },
              { id: "cancel", label: "Cancel" },
            ],
            centerMenuPosition(),
          );

          if (action === "reload") {
            await invalidateProjectReadFile(queryClient, {
              environmentId: props.environmentId,
              cwd: props.cwd,
              relativePath: props.relativePath,
            });
            const latest = await queryClient.fetchQuery(
              projectReadFileQueryOptions({
                environmentId: props.environmentId,
                cwd: props.cwd,
                relativePath: props.relativePath,
                staleTime: 0,
              }),
            );
            if (latest.kind === "text") {
              const normalizedLatestContents = toEditorContents(latest.contents);
              loadBuffer(props.scopeKey, props.relativePath, {
                contents: normalizedLatestContents,
                savedContents: normalizedLatestContents,
                versionToken: latest.versionToken ?? null,
                encoding: "utf8",
                lineEnding: latest.lineEnding ?? "lf",
                lastLoadedAt: new Date(latest.lastModifiedMs).toISOString(),
                lastSavedAt: currentBuffer.lastSavedAt,
              });
            }
            return false;
          }

          if (action === "overwrite") {
            return saveCurrentBuffer({ ignoreVersion: true });
          }

          return false;
        }

        markSaveFailed(props.scopeKey, props.relativePath, getErrorMessage(error));
        return false;
      }
    },
    [
      loadBuffer,
      markSaveFailed,
      markSaveSucceeded,
      markSaving,
      props.cwd,
      props.environmentId,
      props.relativePath,
      props.scopeKey,
      queryClient,
      setPendingExternalConflict,
      writeFile,
    ],
  );

  useEffect(() => {
    saveCurrentBufferRef.current = () => saveCurrentBuffer();
  }, [saveCurrentBuffer]);

  useEffect(() => {
    initialEditorContentsRef.current =
      buffer?.contents ?? toEditorContents(props.readResult.contents);
  }, [buffer?.contents, editorIdentity, props.readResult.contents]);

  useEffect(() => {
    scopeKeyRef.current = props.scopeKey;
    relativePathRef.current = props.relativePath;
    updateBufferContentsRef.current = updateBufferContents;
  }, [props.relativePath, props.scopeKey, updateBufferContents]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key.toLowerCase() !== "s") {
        return;
      }
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }
      event.preventDefault();
      void saveCurrentBuffer();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saveCurrentBuffer]);

  useEffect(() => {
    if (!containerRef.current || editorViewRef.current) {
      return;
    }

    const saveKeybinding = {
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        void saveCurrentBufferRef.current?.();
        return true;
      },
    };

    const editorView = new EditorView({
      state: EditorState.create({
        doc: initialEditorContentsRef.current,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          wrapCompartmentRef.current.of([]),
          languageCompartmentRef.current.of(languageSupportForPath(relativePathRef.current) ?? []),
          keymap.of([
            saveKeybinding,
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (!scopeKeyRef.current || !update.docChanged) {
              return;
            }
            updateBufferContentsRef.current(
              scopeKeyRef.current,
              relativePathRef.current,
              update.state.doc.toString(),
            );
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "13px",
            },
            ".cm-scroller": {
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
            },
            ".cm-content": {
              padding: "12px 0",
            },
            ".cm-line": {
              padding: "0 16px",
            },
            ".cm-gutters": {
              borderRight: "1px solid var(--color-border)",
              backgroundColor: "transparent",
            },
          }),
        ],
      }),
      parent: containerRef.current,
    });

    editorViewRef.current = editorView;
    return () => {
      editorView.destroy();
      editorViewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: wrapCompartmentRef.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: languageCompartmentRef.current.reconfigure(
        languageSupportForPath(props.relativePath) ?? [],
      ),
    });
  }, [props.relativePath]);

  useEffect(() => {
    const view = editorViewRef.current;
    const nextContents = buffer?.contents ?? toEditorContents(props.readResult.contents);
    if (!view || view.state.doc.toString() === nextContents) {
      return;
    }
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: nextContents,
      },
    });
  }, [buffer?.contents, props.readResult.contents]);

  useEffect(() => {
    if (!autoSaveEnabled || !buffer?.isDirty || buffer.isSaving || buffer.pendingExternalConflict) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void saveCurrentBuffer();
    }, 750);
    return () => window.clearTimeout(timeoutId);
  }, [
    autoSaveEnabled,
    buffer?.contents,
    buffer?.isDirty,
    buffer?.isSaving,
    buffer?.pendingExternalConflict,
    saveCurrentBuffer,
  ]);

  const openInEditor = async () => {
    const api = readLocalApi();
    if (!api || !props.cwd) {
      return;
    }
    await openInPreferredEditor(api, resolvePathLinkTarget(props.relativePath, props.cwd));
  };

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
        isDirty={buffer?.isDirty ?? false}
        isSaving={buffer?.isSaving ?? false}
        onSave={() => void saveCurrentBuffer()}
        onToggleWrap={() => setWrap((current) => !current)}
        onOpenInEditor={() => void openInEditor()}
        {...(props.onBack ? { onBack: props.onBack } : {})}
      />
      {buffer?.saveError ? (
        <div className="border-b border-border bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {buffer.saveError}
        </div>
      ) : null}
      {buffer?.pendingExternalConflict ? (
        <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-3 py-2 text-sm text-foreground">
          <AlertTriangleIcon className="size-4 shrink-0 text-warning" />
          <span>File changed on disk. Save will require a conflict choice.</span>
        </div>
      ) : null}
      <div className="h-0 min-h-0 flex-1 overflow-hidden">
        <div ref={containerRef} className="h-full min-h-0" />
      </div>
    </div>
  );
}
