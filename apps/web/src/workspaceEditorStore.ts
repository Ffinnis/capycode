import { create } from "zustand";

export interface WorkspaceEditorBufferState {
  contents: string;
  savedContents: string;
  versionToken: string | null;
  encoding: "utf8";
  lineEnding: "lf" | "crlf";
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  lastLoadedAt: string | null;
  lastSavedAt: string | null;
  pendingExternalConflict: boolean;
}

interface WorkspaceEditorScopeState {
  buffersByPath: Record<string, WorkspaceEditorBufferState>;
}

export interface WorkspaceOpenFileTabStatus {
  dirtyFileTabs: readonly string[];
  savingFileTabs: readonly string[];
}

interface WorkspaceEditorStoreState {
  scopes: Record<string, WorkspaceEditorScopeState>;
  loadBuffer: (
    scopeKey: string,
    relativePath: string,
    buffer: Omit<
      WorkspaceEditorBufferState,
      "isDirty" | "isSaving" | "saveError" | "pendingExternalConflict"
    >,
  ) => void;
  updateBufferContents: (scopeKey: string, relativePath: string, contents: string) => void;
  markSaving: (scopeKey: string, relativePath: string, isSaving: boolean) => void;
  markSaveSucceeded: (
    scopeKey: string,
    relativePath: string,
    input: {
      contents: string;
      versionToken: string;
      lastSavedAt: string;
    },
  ) => void;
  markSaveFailed: (scopeKey: string, relativePath: string, saveError: string) => void;
  setPendingExternalConflict: (
    scopeKey: string,
    relativePath: string,
    pendingExternalConflict: boolean,
  ) => void;
  renameBuffer: (scopeKey: string, fromRelativePath: string, toRelativePath: string) => void;
  removeBuffer: (scopeKey: string, relativePath: string) => void;
  removeBuffersByPrefix: (scopeKey: string, relativePathPrefix: string) => void;
  clearScope: (scopeKey: string) => void;
}

function createScopeState(): WorkspaceEditorScopeState {
  return {
    buffersByPath: {},
  };
}

const EMPTY_BUFFERS_BY_PATH: Record<string, WorkspaceEditorBufferState> = Object.freeze({});
const EMPTY_FILE_TAB_PATHS: readonly string[] = Object.freeze([]);
const EMPTY_OPEN_FILE_TAB_STATUS: WorkspaceOpenFileTabStatus = Object.freeze({
  dirtyFileTabs: EMPTY_FILE_TAB_PATHS,
  savingFileTabs: EMPTY_FILE_TAB_PATHS,
});

function getOrCreateScope(
  scopes: Record<string, WorkspaceEditorScopeState>,
  scopeKey: string,
): WorkspaceEditorScopeState {
  return scopes[scopeKey] ?? createScopeState();
}

function withBuffer(
  state: WorkspaceEditorStoreState,
  scopeKey: string,
  relativePath: string,
  updater: (
    buffer: WorkspaceEditorBufferState | undefined,
  ) => WorkspaceEditorBufferState | undefined,
): Record<string, WorkspaceEditorScopeState> {
  const currentScope = getOrCreateScope(state.scopes, scopeKey);
  const nextBuffer = updater(currentScope.buffersByPath[relativePath]);
  const nextBuffersByPath = { ...currentScope.buffersByPath };
  if (nextBuffer) {
    nextBuffersByPath[relativePath] = nextBuffer;
  } else {
    delete nextBuffersByPath[relativePath];
  }

  return {
    ...state.scopes,
    [scopeKey]: {
      buffersByPath: nextBuffersByPath,
    },
  };
}

function matchesPathPrefix(candidatePath: string, relativePathPrefix: string): boolean {
  return candidatePath === relativePathPrefix || candidatePath.startsWith(`${relativePathPrefix}/`);
}

function replacePathPrefix(
  candidatePath: string,
  fromRelativePath: string,
  toRelativePath: string,
): string {
  if (candidatePath === fromRelativePath) {
    return toRelativePath;
  }
  if (!candidatePath.startsWith(`${fromRelativePath}/`)) {
    return candidatePath;
  }
  return `${toRelativePath}${candidatePath.slice(fromRelativePath.length)}`;
}

export const useWorkspaceEditorStore = create<WorkspaceEditorStoreState>((set) => ({
  scopes: {},
  loadBuffer: (scopeKey, relativePath, buffer) =>
    set((state) => ({
      scopes: withBuffer(state, scopeKey, relativePath, () => ({
        ...buffer,
        isDirty: buffer.contents !== buffer.savedContents,
        isSaving: false,
        saveError: null,
        pendingExternalConflict: false,
      })),
    })),
  updateBufferContents: (scopeKey, relativePath, contents) =>
    set((state) => ({
      scopes: withBuffer(state, scopeKey, relativePath, (buffer) => {
        if (!buffer) return buffer;
        return {
          ...buffer,
          contents,
          isDirty: contents !== buffer.savedContents,
          saveError: null,
        };
      }),
    })),
  markSaving: (scopeKey, relativePath, isSaving) =>
    set((state) => ({
      scopes: withBuffer(state, scopeKey, relativePath, (buffer) =>
        buffer
          ? {
              ...buffer,
              isSaving,
            }
          : buffer,
      ),
    })),
  markSaveSucceeded: (scopeKey, relativePath, input) =>
    set((state) => ({
      scopes: withBuffer(state, scopeKey, relativePath, (buffer) =>
        buffer
          ? {
              ...buffer,
              contents: input.contents,
              savedContents: input.contents,
              versionToken: input.versionToken,
              isDirty: false,
              isSaving: false,
              saveError: null,
              lastSavedAt: input.lastSavedAt,
              pendingExternalConflict: false,
            }
          : buffer,
      ),
    })),
  markSaveFailed: (scopeKey, relativePath, saveError) =>
    set((state) => ({
      scopes: withBuffer(state, scopeKey, relativePath, (buffer) =>
        buffer
          ? {
              ...buffer,
              isSaving: false,
              saveError,
            }
          : buffer,
      ),
    })),
  setPendingExternalConflict: (scopeKey, relativePath, pendingExternalConflict) =>
    set((state) => ({
      scopes: withBuffer(state, scopeKey, relativePath, (buffer) =>
        buffer
          ? {
              ...buffer,
              pendingExternalConflict,
            }
          : buffer,
      ),
    })),
  renameBuffer: (scopeKey, fromRelativePath, toRelativePath) =>
    set((state) => {
      const currentScope = getOrCreateScope(state.scopes, scopeKey);
      const matchingEntries = Object.entries(currentScope.buffersByPath).filter(([path]) =>
        matchesPathPrefix(path, fromRelativePath),
      );
      if (matchingEntries.length === 0) {
        return state;
      }

      const nextBuffersByPath = { ...currentScope.buffersByPath };
      for (const [path, buffer] of matchingEntries) {
        delete nextBuffersByPath[path];
        nextBuffersByPath[replacePathPrefix(path, fromRelativePath, toRelativePath)] = buffer;
      }

      return {
        scopes: {
          ...state.scopes,
          [scopeKey]: {
            buffersByPath: nextBuffersByPath,
          },
        },
      };
    }),
  removeBuffer: (scopeKey, relativePath) =>
    set((state) => ({
      scopes: withBuffer(state, scopeKey, relativePath, () => undefined),
    })),
  removeBuffersByPrefix: (scopeKey, relativePathPrefix) =>
    set((state) => {
      const currentScope = getOrCreateScope(state.scopes, scopeKey);
      const nextBuffersByPath = Object.fromEntries(
        Object.entries(currentScope.buffersByPath).filter(
          ([path]) => !matchesPathPrefix(path, relativePathPrefix),
        ),
      );
      return {
        scopes: {
          ...state.scopes,
          [scopeKey]: {
            buffersByPath: nextBuffersByPath,
          },
        },
      };
    }),
  clearScope: (scopeKey) =>
    set((state) => {
      const { [scopeKey]: _removed, ...rest } = state.scopes;
      return { scopes: rest };
    }),
}));

export function getWorkspaceEditorBuffer(
  state: Pick<WorkspaceEditorStoreState, "scopes">,
  scopeKey: string | null | undefined,
  relativePath: string | null | undefined,
): WorkspaceEditorBufferState | undefined {
  if (!scopeKey || !relativePath) {
    return undefined;
  }
  return state.scopes[scopeKey]?.buffersByPath[relativePath];
}

export function getWorkspaceEditorBuffersByScopeKey(
  state: Pick<WorkspaceEditorStoreState, "scopes">,
  scopeKey: string | null | undefined,
): Record<string, WorkspaceEditorBufferState> {
  if (!scopeKey) {
    return EMPTY_BUFFERS_BY_PATH;
  }
  return state.scopes[scopeKey]?.buffersByPath ?? EMPTY_BUFFERS_BY_PATH;
}

function arePathsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function createWorkspaceOpenFileTabStatusSelector(
  scopeKey: string | null | undefined,
  openFileTabs: readonly string[],
): (state: Pick<WorkspaceEditorStoreState, "scopes">) => WorkspaceOpenFileTabStatus {
  let previousResult = EMPTY_OPEN_FILE_TAB_STATUS;

  return (state) => {
    if (!scopeKey || openFileTabs.length === 0) {
      previousResult = EMPTY_OPEN_FILE_TAB_STATUS;
      return previousResult;
    }

    const buffersByPath = getWorkspaceEditorBuffersByScopeKey(state, scopeKey);
    const dirtyFileTabs: string[] = [];
    const savingFileTabs: string[] = [];

    for (const relativePath of openFileTabs) {
      const buffer = buffersByPath[relativePath];
      if (!buffer) {
        continue;
      }
      if (buffer.isDirty) {
        dirtyFileTabs.push(relativePath);
      }
      if (buffer.isSaving) {
        savingFileTabs.push(relativePath);
      }
    }

    const normalizedDirtyFileTabs =
      dirtyFileTabs.length === 0 ? EMPTY_FILE_TAB_PATHS : dirtyFileTabs;
    const normalizedSavingFileTabs =
      savingFileTabs.length === 0 ? EMPTY_FILE_TAB_PATHS : savingFileTabs;

    if (
      arePathsEqual(previousResult.dirtyFileTabs, normalizedDirtyFileTabs) &&
      arePathsEqual(previousResult.savingFileTabs, normalizedSavingFileTabs)
    ) {
      return previousResult;
    }

    previousResult = {
      dirtyFileTabs: normalizedDirtyFileTabs,
      savingFileTabs: normalizedSavingFileTabs,
    };
    return previousResult;
  };
}

export function hasDirtyWorkspaceBuffersForScope(
  state: Pick<WorkspaceEditorStoreState, "scopes">,
  scopeKey: string | null | undefined,
): boolean {
  if (!scopeKey) {
    return false;
  }
  return Object.values(getWorkspaceEditorBuffersByScopeKey(state, scopeKey)).some(
    (buffer) => buffer.isDirty,
  );
}

export function hasAnyDirtyWorkspaceBuffers(
  state: Pick<WorkspaceEditorStoreState, "scopes">,
): boolean {
  return Object.values(state.scopes).some((scope) =>
    Object.values(scope.buffersByPath).some((buffer) => buffer.isDirty),
  );
}

export function __resetWorkspaceEditorStoreForTests() {
  useWorkspaceEditorStore.setState({
    scopes: {},
  });
}
