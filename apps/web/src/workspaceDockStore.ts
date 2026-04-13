import { create } from "zustand";

const PERSISTED_STATE_KEY = "capycode:workspace-dock:v1";
const DEFAULT_FILES_PANEL_WIDTH = 280;
const DEFAULT_CONTEXT_PANEL_WIDTH = 640;
export const WORKSPACE_TERMINAL_TAB_ID = "__workspace_terminal__" as const;
export type WorkspaceDockActiveTab = "chat" | typeof WORKSPACE_TERMINAL_TAB_ID | string;

export interface WorkspaceDockScopeState {
  filesOpen: boolean;
  openFileTabs: string[];
  activeTab: WorkspaceDockActiveTab;
  activeContext: "diff" | "file";
  revealedFilePath: string | undefined;
  expandedDirectories: Record<string, boolean>;
}

interface PersistedWorkspaceDockState {
  scopes?: Record<string, WorkspaceDockScopeState>;
  filesPanelWidth?: number;
  contextPanelWidth?: number;
}

interface WorkspaceDockState {
  scopes: Record<string, WorkspaceDockScopeState>;
  filesPanelWidth: number;
  contextPanelWidth: number;
  syncRouteState: (
    scopeKey: string,
    input: {
      filesOpen: boolean;
      diffOpen: boolean;
      terminalOpen: boolean;
      filePath: string | null | undefined;
    },
  ) => void;
  setFilesOpen: (scopeKey: string, open: boolean) => void;
  openFile: (scopeKey: string, relativePath: string) => void;
  selectChatTab: (scopeKey: string) => void;
  selectFileTab: (scopeKey: string, relativePath: string) => void;
  closeFileTab: (scopeKey: string, relativePath: string) => void;
  showDiffContext: (scopeKey: string) => void;
  setDirectoryExpanded: (scopeKey: string, relativePath: string, expanded: boolean) => void;
  setRevealedFilePath: (scopeKey: string, relativePath: string | undefined) => void;
  setFilesPanelWidth: (width: number) => void;
  setContextPanelWidth: (width: number) => void;
  clearScope: (scopeKey: string) => void;
}

const EMPTY_OPEN_FILE_TABS: string[] = [];
const EMPTY_EXPANDED_DIRECTORIES: Record<string, boolean> = {};
const DEFAULT_SCOPE_STATE: WorkspaceDockScopeState = {
  filesOpen: false,
  openFileTabs: EMPTY_OPEN_FILE_TABS,
  activeTab: "chat",
  activeContext: "file",
  revealedFilePath: undefined,
  expandedDirectories: EMPTY_EXPANDED_DIRECTORIES,
};

function createDefaultScopeState(): WorkspaceDockScopeState {
  return {
    ...DEFAULT_SCOPE_STATE,
    openFileTabs: [],
    expandedDirectories: {},
  };
}

function readPersistedState(): Pick<
  WorkspaceDockState,
  "scopes" | "filesPanelWidth" | "contextPanelWidth"
> {
  if (typeof window === "undefined") {
    return {
      scopes: {},
      filesPanelWidth: DEFAULT_FILES_PANEL_WIDTH,
      contextPanelWidth: DEFAULT_CONTEXT_PANEL_WIDTH,
    };
  }

  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      return {
        scopes: {},
        filesPanelWidth: DEFAULT_FILES_PANEL_WIDTH,
        contextPanelWidth: DEFAULT_CONTEXT_PANEL_WIDTH,
      };
    }
    const parsed = JSON.parse(raw) as PersistedWorkspaceDockState;
    return {
      scopes: parsed.scopes ?? {},
      filesPanelWidth: parsed.filesPanelWidth ?? DEFAULT_FILES_PANEL_WIDTH,
      contextPanelWidth: parsed.contextPanelWidth ?? DEFAULT_CONTEXT_PANEL_WIDTH,
    };
  } catch {
    return {
      scopes: {},
      filesPanelWidth: DEFAULT_FILES_PANEL_WIDTH,
      contextPanelWidth: DEFAULT_CONTEXT_PANEL_WIDTH,
    };
  }
}

function persistState(
  state: Pick<WorkspaceDockState, "scopes" | "filesPanelWidth" | "contextPanelWidth">,
) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        scopes: state.scopes,
        filesPanelWidth: state.filesPanelWidth,
        contextPanelWidth: state.contextPanelWidth,
      } satisfies PersistedWorkspaceDockState),
    );
  } catch {
    // Ignore storage failures to keep the dock non-blocking.
  }
}

function ensureScope(
  scopes: Record<string, WorkspaceDockScopeState>,
  scopeKey: string,
): WorkspaceDockScopeState {
  return scopes[scopeKey] ?? createDefaultScopeState();
}

function withScope(
  state: WorkspaceDockState,
  scopeKey: string,
  updater: (current: WorkspaceDockScopeState) => WorkspaceDockScopeState,
): Pick<WorkspaceDockState, "scopes"> {
  return {
    scopes: {
      ...state.scopes,
      [scopeKey]: updater(ensureScope(state.scopes, scopeKey)),
    },
  };
}

function nextUniqueTabs(openFileTabs: string[], relativePath: string): string[] {
  return openFileTabs.includes(relativePath) ? openFileTabs : [...openFileTabs, relativePath];
}

const persistedState = readPersistedState();

export const useWorkspaceDockStore = create<WorkspaceDockState>((set) => ({
  scopes: persistedState.scopes,
  filesPanelWidth: persistedState.filesPanelWidth,
  contextPanelWidth: persistedState.contextPanelWidth,
  syncRouteState: (scopeKey, input) =>
    set((state) => {
      const next = withScope(state, scopeKey, (current) => {
        const nextScope: WorkspaceDockScopeState = {
          ...current,
          filesOpen: input.filesOpen,
        };
        if (input.filePath) {
          nextScope.openFileTabs = nextUniqueTabs(current.openFileTabs, input.filePath);
          nextScope.revealedFilePath = input.filePath;
        } else if (
          !input.terminalOpen &&
          (current.activeTab === WORKSPACE_TERMINAL_TAB_ID || !input.diffOpen)
        ) {
          nextScope.revealedFilePath = undefined;
        }

        if (input.terminalOpen) {
          nextScope.activeTab = WORKSPACE_TERMINAL_TAB_ID;
        } else if (input.filePath) {
          nextScope.activeTab = input.filePath;
        } else if (current.activeTab === WORKSPACE_TERMINAL_TAB_ID || !input.diffOpen) {
          nextScope.activeTab = "chat";
        }

        nextScope.activeContext = input.diffOpen
          ? current.activeContext === "file" && input.filePath
            ? "file"
            : "diff"
          : input.filePath
            ? "file"
            : current.activeContext === "diff"
              ? "file"
              : current.activeContext;
        return nextScope;
      });
      const nextState = { ...state, ...next };
      persistState(nextState);
      return nextState;
    }),
  setFilesOpen: (scopeKey, open) =>
    set((state) => {
      const nextState = {
        ...state,
        ...withScope(state, scopeKey, (current) => ({ ...current, filesOpen: open })),
      };
      persistState(nextState);
      return nextState;
    }),
  openFile: (scopeKey, relativePath) =>
    set((state) => {
      const nextState = {
        ...state,
        ...withScope(state, scopeKey, (current) => ({
          ...current,
          filesOpen: true,
          openFileTabs: nextUniqueTabs(current.openFileTabs, relativePath),
          activeTab: relativePath,
          activeContext: "file",
          revealedFilePath: relativePath,
        })),
      };
      persistState(nextState);
      return nextState;
    }),
  selectChatTab: (scopeKey) =>
    set((state) => {
      const nextState = {
        ...state,
        ...withScope(state, scopeKey, (current) => ({
          ...current,
          activeTab: "chat",
          revealedFilePath: undefined,
        })),
      };
      persistState(nextState);
      return nextState;
    }),
  selectFileTab: (scopeKey, relativePath) =>
    set((state) => {
      const nextState = {
        ...state,
        ...withScope(state, scopeKey, (current) => ({
          ...current,
          filesOpen: true,
          openFileTabs: nextUniqueTabs(current.openFileTabs, relativePath),
          activeTab: relativePath,
          activeContext: "file",
          revealedFilePath: relativePath,
        })),
      };
      persistState(nextState);
      return nextState;
    }),
  closeFileTab: (scopeKey, relativePath) =>
    set((state) => {
      const nextState = {
        ...state,
        ...withScope(state, scopeKey, (current) => {
          const nextTabs = current.openFileTabs.filter((path) => path !== relativePath);
          const nextActiveTab =
            current.activeTab === relativePath ? (nextTabs.at(-1) ?? "chat") : current.activeTab;
          return {
            ...current,
            openFileTabs: nextTabs,
            activeTab: nextActiveTab,
            revealedFilePath:
              current.revealedFilePath === relativePath ? undefined : current.revealedFilePath,
            activeContext: nextActiveTab === "chat" ? current.activeContext : "file",
          };
        }),
      };
      persistState(nextState);
      return nextState;
    }),
  showDiffContext: (scopeKey) =>
    set((state) => {
      const nextState = {
        ...state,
        ...withScope(state, scopeKey, (current) => ({
          ...current,
          activeContext: "diff",
        })),
      };
      persistState(nextState);
      return nextState;
    }),
  setDirectoryExpanded: (scopeKey, relativePath, expanded) =>
    set((state) => {
      const nextState = {
        ...state,
        ...withScope(state, scopeKey, (current) => ({
          ...current,
          expandedDirectories: {
            ...current.expandedDirectories,
            [relativePath]: expanded,
          },
        })),
      };
      persistState(nextState);
      return nextState;
    }),
  setRevealedFilePath: (scopeKey, relativePath) =>
    set((state) => {
      const nextState = {
        ...state,
        ...withScope(state, scopeKey, (current) => ({
          ...current,
          ...(relativePath ? { revealedFilePath: relativePath } : { revealedFilePath: undefined }),
        })),
      };
      persistState(nextState);
      return nextState;
    }),
  setFilesPanelWidth: (width) =>
    set((state) => {
      const nextState = { ...state, filesPanelWidth: width };
      persistState(nextState);
      return nextState;
    }),
  setContextPanelWidth: (width) =>
    set((state) => {
      const nextState = { ...state, contextPanelWidth: width };
      persistState(nextState);
      return nextState;
    }),
  clearScope: (scopeKey) =>
    set((state) => {
      const { [scopeKey]: _removed, ...rest } = state.scopes;
      const nextState = { ...state, scopes: rest };
      persistState(nextState);
      return nextState;
    }),
}));

export function getWorkspaceDockScopeKey(input: {
  environmentId: string;
  threadId: string;
  cwd: string;
}): string {
  return `${input.environmentId}:${input.threadId}:${input.cwd}`;
}

export function getWorkspaceDockScopeState(
  state: Pick<WorkspaceDockState, "scopes">,
  scopeKey: string | null | undefined,
): WorkspaceDockScopeState {
  if (!scopeKey) {
    return DEFAULT_SCOPE_STATE;
  }
  return state.scopes[scopeKey] ?? DEFAULT_SCOPE_STATE;
}

export function __resetWorkspaceDockStoreForTests() {
  useWorkspaceDockStore.setState({
    scopes: {},
    filesPanelWidth: DEFAULT_FILES_PANEL_WIDTH,
    contextPanelWidth: DEFAULT_CONTEXT_PANEL_WIDTH,
  });
}
