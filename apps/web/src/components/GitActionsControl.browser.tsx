import { scopeThreadRef } from "@capycode/client-runtime";
import {
  type GitRunStackedActionResult,
  type GitStatusResult,
  ThreadId,
} from "@capycode/contracts";
import { page } from "vitest/browser";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const SHARED_THREAD_ID = ThreadId.make("thread-shared");
const ENVIRONMENT_A = "environment-local" as never;
const ENVIRONMENT_B = "environment-remote" as never;
const GIT_CWD = "/repo/project";
const BRANCH_NAME = "feature/toast-scope";

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

const {
  activeRunStackedActionDeferredRef,
  activeDraftThreadRef,
  hasServerThreadRef,
  invalidateGitQueriesSpy,
  refreshGitStatusSpy,
  runStackedActionMutateAsyncSpy,
  setDraftThreadContextSpy,
  statusRef,
  setThreadBranchSpy,
  toastAddSpy,
  toastCloseSpy,
  toastPromiseSpy,
  toastUpdateSpy,
} = vi.hoisted(() => ({
  activeRunStackedActionDeferredRef: { current: createDeferredPromise<never>() },
  activeDraftThreadRef: { current: null as unknown },
  hasServerThreadRef: { current: true },
  invalidateGitQueriesSpy: vi.fn(() => Promise.resolve()),
  refreshGitStatusSpy: vi.fn(() => Promise.resolve(null)),
  runStackedActionMutateAsyncSpy: vi.fn(
    () => activeRunStackedActionDeferredRef.current.promise as Promise<GitRunStackedActionResult>,
  ),
  setDraftThreadContextSpy: vi.fn(),
  statusRef: {
    current: {
      branch: "feature/toast-scope",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 1,
      behindCount: 0,
      pr: null,
      hasOriginRemote: true,
      isRepo: true,
      isDefaultBranch: false,
    } as GitStatusResult,
  },
  setThreadBranchSpy: vi.fn(),
  toastAddSpy: vi.fn(() => "toast-1"),
  toastCloseSpy: vi.fn(),
  toastPromiseSpy: vi.fn(),
  toastUpdateSpy: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");

  return {
    ...actual,
    useIsMutating: vi.fn(() => 0),
    useMutation: vi.fn((options: { __kind?: string }) => {
      if (options.__kind === "run-stacked-action") {
        return {
          mutateAsync: runStackedActionMutateAsyncSpy,
          isPending: false,
        };
      }

      if (options.__kind === "pull") {
        return {
          mutateAsync: vi.fn(),
          isPending: false,
        };
      }

      return {
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isPending: false,
      };
    }),
    useQuery: vi.fn(() => ({ data: null, error: null })),
    useQueryClient: vi.fn(() => ({})),
  };
});

vi.mock("~/components/ui/toast", () => ({
  toastManager: {
    add: toastAddSpy,
    close: toastCloseSpy,
    promise: toastPromiseSpy,
    update: toastUpdateSpy,
  },
}));

vi.mock("~/editorPreferences", () => ({
  openInPreferredEditor: vi.fn(),
}));

vi.mock("~/lib/gitReactQuery", () => ({
  gitInitMutationOptions: vi.fn(() => ({ __kind: "init" })),
  gitMutationKeys: {
    pull: vi.fn(() => ["pull"]),
    runStackedAction: vi.fn(() => ["run-stacked-action"]),
  },
  gitPullMutationOptions: vi.fn(() => ({ __kind: "pull" })),
  gitRunStackedActionMutationOptions: vi.fn(() => ({ __kind: "run-stacked-action" })),
  invalidateGitQueries: invalidateGitQueriesSpy,
}));

vi.mock("~/lib/gitStatusState", () => ({
  refreshGitStatus: refreshGitStatusSpy,
  resetGitStatusStateForTests: () => undefined,
  useGitStatus: vi.fn(() => ({
    data: statusRef.current,
    error: null,
    isPending: false,
  })),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
  readLocalApi: vi.fn(() => null),
}));

vi.mock("~/composerDraftStore", async () => {
  const draftStoreState = {
    getDraftThreadByRef: () => activeDraftThreadRef.current,
    getDraftSession: () => activeDraftThreadRef.current,
    getDraftThread: () => activeDraftThreadRef.current,
    getDraftSessionByLogicalProjectKey: () => null,
    setDraftThreadContext: setDraftThreadContextSpy,
    setLogicalProjectDraftThreadId: vi.fn(),
    setProjectDraftThreadId: vi.fn(),
    hasDraftThreadsInEnvironment: () => false,
    clearDraftThread: vi.fn(),
  };

  return {
    DraftId: {
      makeUnsafe: (value: string) => value,
    },
    useComposerDraftStore: Object.assign(
      (selector: (state: unknown) => unknown) => selector(draftStoreState),
      { getState: () => draftStoreState },
    ),
    markPromotedDraftThread: vi.fn(),
    markPromotedDraftThreadByRef: vi.fn(),
    markPromotedDraftThreads: vi.fn(),
    markPromotedDraftThreadsByRef: vi.fn(),
    finalizePromotedDraftThreadByRef: vi.fn(),
    finalizePromotedDraftThreadsByRef: vi.fn(),
  };
});

vi.mock("~/store", () => ({
  selectEnvironmentState: (
    state: { environmentStateById: Record<string, unknown> },
    environmentId: string | null,
  ) => {
    if (!environmentId) {
      throw new Error("Missing environment id");
    }
    const environmentState = state.environmentStateById[environmentId];
    if (!environmentState) {
      throw new Error(`Unknown environment: ${environmentId}`);
    }
    return environmentState;
  },
  selectProjectsForEnvironment: () => [],
  selectProjectsAcrossEnvironments: () => [],
  selectThreadsForEnvironment: () => [],
  selectThreadsAcrossEnvironments: () => [],
  selectThreadShellsAcrossEnvironments: () => [],
  selectSidebarThreadsAcrossEnvironments: () => [],
  selectSidebarThreadsForProjectRef: () => [],
  selectSidebarThreadsForProjectRefs: () => [],
  selectBootstrapCompleteForActiveEnvironment: () => true,
  selectProjectByRef: () => null,
  selectThreadByRef: () => null,
  selectSidebarThreadSummaryByRef: () => null,
  selectThreadIdsByProjectRef: () => [],
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      setThreadBranch: setThreadBranchSpy,
      environmentStateById: {
        [ENVIRONMENT_A]: {
          threadShellById: hasServerThreadRef.current
            ? {
                [SHARED_THREAD_ID]: {
                  id: SHARED_THREAD_ID,
                  branch: BRANCH_NAME,
                  worktreePath: null,
                },
              }
            : {},
          threadSessionById: {},
          threadTurnStateById: {},
          messageIdsByThreadId: {},
          messageByThreadId: {},
          activityIdsByThreadId: {},
          activityByThreadId: {},
          proposedPlanIdsByThreadId: {},
          proposedPlanByThreadId: {},
          turnDiffIdsByThreadId: {},
          turnDiffSummaryByThreadId: {},
        },
        [ENVIRONMENT_B]: {
          threadShellById: hasServerThreadRef.current
            ? {
                [SHARED_THREAD_ID]: {
                  id: SHARED_THREAD_ID,
                  branch: BRANCH_NAME,
                  worktreePath: null,
                },
              }
            : {},
          threadSessionById: {},
          threadTurnStateById: {},
          messageIdsByThreadId: {},
          messageByThreadId: {},
          activityIdsByThreadId: {},
          activityByThreadId: {},
          proposedPlanIdsByThreadId: {},
          proposedPlanByThreadId: {},
          turnDiffIdsByThreadId: {},
          turnDiffSummaryByThreadId: {},
        },
      },
    }),
}));

vi.mock("~/terminal-links", () => ({
  resolvePathLinkTarget: vi.fn(),
}));

import GitActionsControl from "./GitActionsControl";

function findButtonByText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  ) ?? null) as HTMLButtonElement | null;
}

function findLastButtonByText(text: string): HTMLButtonElement | null {
  const matches = Array.from(document.querySelectorAll("button")).filter((button) =>
    button.textContent?.includes(text),
  );
  return (matches.at(-1) ?? null) as HTMLButtonElement | null;
}

function Harness() {
  const [activeThreadRef, setActiveThreadRef] = useState(
    scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setActiveThreadRef(scopeThreadRef(ENVIRONMENT_B, SHARED_THREAD_ID))}
      >
        Switch environment
      </button>
      <GitActionsControl gitCwd={GIT_CWD} activeThreadRef={activeThreadRef} />
    </>
  );
}

describe("GitActionsControl thread-scoped progress toast", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    activeRunStackedActionDeferredRef.current = createDeferredPromise<never>();
    activeDraftThreadRef.current = null;
    hasServerThreadRef.current = true;
    statusRef.current = {
      branch: "feature/toast-scope",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 1,
      behindCount: 0,
      pr: null,
      hasOriginRemote: true,
      isRepo: true,
      isDefaultBranch: false,
    } as GitStatusResult;
    document.body.innerHTML = "";
  });

  it("keeps an in-flight git action toast pinned to the thread ref that started it", async () => {
    vi.useFakeTimers();

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      const quickActionButton = findButtonByText("Push & create PR");
      expect(quickActionButton, 'Unable to find button containing "Push & create PR"').toBeTruthy();
      if (!(quickActionButton instanceof HTMLButtonElement)) {
        throw new Error('Unable to find button containing "Push & create PR"');
      }
      quickActionButton.click();

      expect(toastAddSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { threadRef: scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID) },
          title: "Pushing...",
          type: "loading",
        }),
      );

      await vi.advanceTimersByTimeAsync(1_000);

      expect(toastUpdateSpy).toHaveBeenLastCalledWith(
        "toast-1",
        expect.objectContaining({
          data: { threadRef: scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID) },
          title: "Pushing...",
          type: "loading",
        }),
      );

      const switchEnvironmentButton = findButtonByText("Switch environment");
      expect(
        switchEnvironmentButton,
        'Unable to find button containing "Switch environment"',
      ).toBeTruthy();
      if (!(switchEnvironmentButton instanceof HTMLButtonElement)) {
        throw new Error('Unable to find button containing "Switch environment"');
      }
      switchEnvironmentButton.click();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(toastUpdateSpy).toHaveBeenLastCalledWith(
        "toast-1",
        expect.objectContaining({
          data: { threadRef: scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID) },
          title: "Pushing...",
          type: "loading",
        }),
      );
    } finally {
      activeRunStackedActionDeferredRef.current.reject(new Error("test cleanup"));
      await Promise.resolve();
      vi.useRealTimers();
      await screen.unmount();
      host.remove();
    }
  });

  it("debounces focus-driven git status refreshes", async () => {
    vi.useFakeTimers();

    const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");
    let visibilityState: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <GitActionsControl
        gitCwd={GIT_CWD}
        activeThreadRef={scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID)}
      />,
      {
        container: host,
      },
    );

    try {
      window.dispatchEvent(new Event("focus"));
      visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));

      expect(refreshGitStatusSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(249);
      expect(refreshGitStatusSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(refreshGitStatusSpy).toHaveBeenCalledTimes(1);
      expect(refreshGitStatusSpy).toHaveBeenCalledWith({
        environmentId: ENVIRONMENT_A,
        cwd: GIT_CWD,
      });
    } finally {
      if (originalVisibilityState) {
        Object.defineProperty(document, "visibilityState", originalVisibilityState);
      }
      vi.useRealTimers();
      await screen.unmount();
      host.remove();
    }
  });

  it("syncs the live branch into the active draft thread when no server thread exists", async () => {
    hasServerThreadRef.current = false;
    activeDraftThreadRef.current = {
      threadId: SHARED_THREAD_ID,
      environmentId: ENVIRONMENT_A,
      branch: null,
      worktreePath: null,
    };

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <GitActionsControl
        gitCwd={GIT_CWD}
        activeThreadRef={scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID)}
      />,
      {
        container: host,
      },
    );

    try {
      await Promise.resolve();

      expect(setDraftThreadContextSpy).toHaveBeenCalledWith(
        scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID),
        {
          branch: BRANCH_NAME,
          worktreePath: null,
        },
      );
      expect(setThreadBranchSpy).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("syncs the draft branch from git status even for legacy worktree-mode drafts", async () => {
    hasServerThreadRef.current = false;
    activeDraftThreadRef.current = {
      threadId: SHARED_THREAD_ID,
      environmentId: ENVIRONMENT_A,
      branch: "feature/base-branch",
      worktreePath: null,
      envMode: "worktree",
    };

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <GitActionsControl
        gitCwd={GIT_CWD}
        activeThreadRef={scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID)}
      />,
      {
        container: host,
      },
    );

    try {
      await Promise.resolve();

      expect(setDraftThreadContextSpy).toHaveBeenCalledWith(
        scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID),
        {
          branch: BRANCH_NAME,
          worktreePath: null,
        },
      );
      expect(setThreadBranchSpy).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("opens a commit dialog for commit-capable quick actions and submits the typed message", async () => {
    statusRef.current = {
      branch: BRANCH_NAME,
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [
          { path: "src/selected.ts", insertions: 5, deletions: 1 },
          { path: "src/other.ts", insertions: 2, deletions: 0 },
        ],
        insertions: 7,
        deletions: 1,
      },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
      hasOriginRemote: true,
      isRepo: true,
      isDefaultBranch: false,
    };
    runStackedActionMutateAsyncSpy.mockResolvedValueOnce({
      action: "commit_push_pr",
      branch: { status: "skipped_not_requested" },
      commit: {
        status: "created",
        commitSha: "abc123",
        subject: "feat: selected files",
      },
      push: {
        status: "pushed",
        branch: BRANCH_NAME,
        upstreamBranch: `origin/${BRANCH_NAME}`,
        setUpstream: false,
      },
      pr: {
        status: "created",
        url: "https://example.com/pr/1",
        number: 1,
        baseBranch: "main",
        headBranch: BRANCH_NAME,
        title: "feat: selected files",
      },
      toast: {
        title: "Committed",
        description: "Created commit.",
        cta: { kind: "none" },
      },
    } satisfies GitRunStackedActionResult);

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <GitActionsControl
        variant="panel"
        gitCwd={GIT_CWD}
        activeThreadRef={scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID)}
        selectedFilePaths={["src/selected.ts"]}
        selectionSummary="Commit 1 selected file"
        enableAmbientSync={false}
      />,
      { container: host },
    );

    try {
      const quickActionButton = findButtonByText("Commit 1 selected file");
      expect(quickActionButton).toBeTruthy();
      if (!(quickActionButton instanceof HTMLButtonElement)) {
        throw new Error('Unable to find button containing "Commit 1 selected file"');
      }
      quickActionButton.click();

      await page.getByPlaceholder("Leave empty to auto-generate").fill("feat: selected files");
      const submitButton = findLastButtonByText("Commit, push & PR");
      expect(submitButton).toBeTruthy();
      if (!(submitButton instanceof HTMLButtonElement)) {
        throw new Error('Unable to find dialog button containing "Commit, push & PR"');
      }
      submitButton.click();

      expect(runStackedActionMutateAsyncSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "commit_push_pr",
          commitMessage: "feat: selected files",
          filePaths: ["src/selected.ts"],
        }),
      );
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("renders and commits the explicit selected file scope even when live status is grouped differently", async () => {
    statusRef.current = {
      branch: BRANCH_NAME,
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [
          {
            path: "capycode/apps/desktop/resources/notification-sounds/",
            insertions: 0,
            deletions: 0,
          },
          { path: "capycode/apps/web/src/components/files/", insertions: 0, deletions: 0 },
        ],
        insertions: 0,
        deletions: 0,
      },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
      hasOriginRemote: true,
      isRepo: true,
      isDefaultBranch: false,
    };
    runStackedActionMutateAsyncSpy.mockResolvedValueOnce({
      action: "commit_push_pr",
      branch: { status: "skipped_not_requested" },
      commit: {
        status: "created",
        commitSha: "abc123",
        subject: "feat: selected files",
      },
      push: {
        status: "pushed",
        branch: BRANCH_NAME,
        upstreamBranch: `origin/${BRANCH_NAME}`,
        setUpstream: false,
      },
      pr: {
        status: "created",
        url: "https://example.com/pr/1",
        number: 1,
        baseBranch: "main",
        headBranch: BRANCH_NAME,
        title: "feat: selected files",
      },
      toast: {
        title: "Committed",
        description: "Created commit.",
        cta: { kind: "none" },
      },
    } satisfies GitRunStackedActionResult);

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <GitActionsControl
        variant="panel"
        gitCwd={GIT_CWD}
        activeThreadRef={scopeThreadRef(ENVIRONMENT_A, SHARED_THREAD_ID)}
        selectedFilePaths={[
          "capycode/apps/desktop/resources/notification-sounds/agentisdonewoman.mp3",
          "capycode/apps/web/src/components/files/FilePreviewPanel.tsx",
        ]}
        selectionSummary="Commit 2 selected files"
        enableAmbientSync={false}
      />,
      { container: host },
    );

    try {
      const quickActionButton = findButtonByText("Commit 2 selected files");
      expect(quickActionButton).toBeTruthy();
      if (!(quickActionButton instanceof HTMLButtonElement)) {
        throw new Error('Unable to find button containing "Commit 2 selected files"');
      }
      quickActionButton.click();

      await expect
        .element(
          page.getByText(
            "capycode/apps/desktop/resources/notification-sounds/agentisdonewoman.mp3",
          ),
        )
        .toBeInTheDocument();
      await expect
        .element(page.getByText("capycode/apps/web/src/components/files/FilePreviewPanel.tsx"))
        .toBeInTheDocument();
      await expect
        .element(page.getByText(/^capycode\/apps\/desktop\/resources\/notification-sounds\/$/))
        .not.toBeInTheDocument();

      const submitButton = findLastButtonByText("Commit, push & PR");
      expect(submitButton).toBeTruthy();
      if (!(submitButton instanceof HTMLButtonElement)) {
        throw new Error('Unable to find dialog button containing "Commit, push & PR"');
      }
      submitButton.click();

      expect(runStackedActionMutateAsyncSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "commit_push_pr",
          filePaths: [
            "capycode/apps/desktop/resources/notification-sounds/agentisdonewoman.mp3",
            "capycode/apps/web/src/components/files/FilePreviewPanel.tsx",
          ],
        }),
      );
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
