import "../index.css";

import { TurnId } from "@capycode/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ComponentProps, ComponentType } from "react";
import type { GitDiffView } from "./DiffPanel";

const {
  settingsRef,
  threadRef,
  workspaceRef,
  gitActionControlPropsRef,
  updateSettingsSpy,
  gitFilterChangeSpy,
  gitBaseBranchChangeSpy,
  gitCommitSelectSpy,
  gitFileSelectSpy,
  gitFileSelectionToggleSpy,
} = vi.hoisted(() => ({
  settingsRef: {
    current: {
      diffPanelMode: "git" as const,
      diffWordWrap: false,
      timestampFormat: "locale" as const,
    },
  },
  threadRef: {
    current: {
      id: "thread-1",
      environmentId: "environment-local",
      projectId: "project-1",
      branch: "feature/panel-actions",
      workspaceId: null,
      worktreePath: "/repo/project",
    } as {
      id: string;
      environmentId: string;
      projectId: string;
      branch: string | null;
      workspaceId: string | null;
      worktreePath: string | null;
    },
  },
  workspaceRef: {
    current: null as null | { id: string; branch: string | null; worktreePath: string | null },
  },
  gitActionControlPropsRef: { current: null as unknown },
  updateSettingsSpy: vi.fn(),
  gitFilterChangeSpy: vi.fn(),
  gitBaseBranchChangeSpy: vi.fn(),
  gitCommitSelectSpy: vi.fn(),
  gitFileSelectSpy: vi.fn(),
  gitFileSelectionToggleSpy: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");

  return {
    ...actual,
    useQuery: vi.fn(() => ({
      data: null,
      isLoading: false,
      error: null,
    })),
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useParams: vi.fn(() => ({ environmentId: "environment-local", threadId: "thread-1" })),
  useSearch: vi.fn(() => ({ diff: "1" })),
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: vi.fn(() => ({ resolvedTheme: "light", colorScheme: "default" })),
}));

vi.mock("../hooks/useMediaQuery", () => ({
  useIsMobile: vi.fn(() => false),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: vi.fn(() => settingsRef.current),
  useUpdateSettings: vi.fn(() => ({
    updateSettings: (patch: Partial<typeof settingsRef.current>) => {
      updateSettingsSpy(patch);
      settingsRef.current = {
        ...settingsRef.current,
        ...patch,
      };
    },
  })),
}));

vi.mock("../store", () => ({
  useStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      environmentStateById: {
        "environment-local": {
          workspaceById: workspaceRef.current
            ? {
                [workspaceRef.current.id]: workspaceRef.current,
              }
            : {},
        },
      },
    }),
  ),
  selectEnvironmentState: vi.fn(
    (state: { environmentStateById: Record<string, unknown> }, environmentId: string) =>
      state.environmentStateById[environmentId],
  ),
  selectProjectByRef: vi.fn(() => ({
    cwd: "/repo/project",
  })),
}));

vi.mock("../storeSelectors", () => ({
  createThreadSelectorByRef: vi.fn(() => () => threadRef.current),
}));

vi.mock("~/lib/gitStatusState", () => ({
  useGitStatus: vi.fn(() => ({
    data: {
      isRepo: true,
    },
  })),
}));

vi.mock("../hooks/useTurnDiffSummaries", () => ({
  useTurnDiffSummaries: vi.fn(() => ({
    turnDiffSummaries: [],
    inferredCheckpointTurnCountByTurnId: {},
  })),
}));

vi.mock("../lib/providerReactQuery", () => ({
  checkpointDiffQueryOptions: vi.fn(() => ({ queryKey: ["checkpoint-diff"] })),
}));

vi.mock("~/lib/gitReactQuery", () => ({
  gitListRepositoriesQueryOptions: vi.fn(() => ({ queryKey: ["git", "repositories"] })),
  gitReviewStatusQueryOptions: vi.fn(() => ({ queryKey: ["git", "review-status"] })),
  gitListCommitsQueryOptions: vi.fn(() => ({ queryKey: ["git", "commits"] })),
  gitCommitFilesQueryOptions: vi.fn(() => ({ queryKey: ["git", "commit-files"] })),
  gitFileDiffQueryOptions: vi.fn(() => ({ queryKey: ["git", "file-diff"] })),
}));

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor: vi.fn(),
}));

vi.mock("../localApi", () => ({
  readLocalApi: vi.fn(() => null),
}));

vi.mock("./GitActionsControl", () => ({
  default: vi.fn((props: unknown) => {
    gitActionControlPropsRef.current = props;
    return <div data-testid="mock-git-actions-control">{JSON.stringify(props)}</div>;
  }),
}));

type GitDiffViewProps = ComponentProps<typeof GitDiffView>;

function createGitDiffViewProps(overrides: Partial<GitDiffViewProps> = {}): GitDiffViewProps {
  return {
    hasActiveThread: true,
    activeCwd: "/repo/project",
    environmentId: null,
    isGitRepo: true,
    repositories: [],
    repositoriesLoading: false,
    repositoriesError: null,
    selectedRepositoryCwd: null,
    onSelectRepository: () => undefined,
    actionBar: undefined,
    baseBranch: "main",
    baseBranchOptions: ["main", "release"],
    filterMode: "all-changes" as const,
    onSelectBaseBranch: gitBaseBranchChangeSpy,
    onSelectFilterMode: gitFilterChangeSpy,
    allChanges: [],
    staged: [],
    unstaged: [],
    commits: [],
    selectedCommitHash: null,
    onSelectCommit: gitCommitSelectSpy,
    commitFiles: [],
    selectedPreview: null,
    onSelectFile: gitFileSelectSpy,
    selectedFilePaths: new Set<string>(),
    onToggleFileSelection: gitFileSelectionToggleSpy,
    onBatchToggleFiles: vi.fn(),
    reviewStatusLoading: false,
    reviewStatusError: null,
    commitsLoading: false,
    commitsError: null,
    commitFilesLoading: false,
    commitFilesError: null,
    diffPatch: undefined,
    diffLoading: false,
    diffError: null,
    diffRenderMode: "stacked" as const,
    diffWordWrap: false,
    resolvedTheme: "light" as const,
    colorScheme: "default" as const,
    patchViewportRef: { current: null },
    onOpenFileInEditor: () => undefined,
    ...overrides,
  };
}

async function mountGitDiffView<P extends object>(
  Component: ComponentType<P>,
  props: P,
  options: { height?: number; width?: number } = {},
) {
  const host = document.createElement("div");
  host.style.width = `${options.width ?? 420}px`;
  host.style.height = `${options.height ?? 780}px`;
  host.style.display = "flex";
  host.style.minHeight = "0";
  host.style.minWidth = "0";
  document.body.append(host);

  const mounted = await render(
    <div
      style={{
        display: "flex",
        flex: "1 1 auto",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
      }}
    >
      <Component {...props} />
    </div>,
    { container: host },
  );

  return {
    host,
    rerender: async (nextProps: P) => {
      await mounted.rerender(
        <div
          style={{
            display: "flex",
            flex: "1 1 auto",
            height: "100%",
            minHeight: 0,
            minWidth: 0,
            width: "100%",
          }}
        >
          <Component {...nextProps} />
        </div>,
      );
    },
    unmount: async () => {
      await mounted.unmount();
      host.remove();
    },
  };
}

async function getElementHeight(testId: string) {
  const element = await page.getByTestId(testId).element();
  return Math.round(element.getBoundingClientRect().height);
}

async function dragVerticalResizeHandle(testId: string, deltaY: number) {
  const element = await page.getByTestId(testId).element();
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const pointerId = 1;

  element.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId,
      clientX,
      clientY,
    }),
  );
  element.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      pointerId,
      clientX,
      clientY: clientY + deltaY,
    }),
  );
  element.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId,
      clientX,
      clientY: clientY + deltaY,
    }),
  );
}

function countTextOccurrences(text: string) {
  const bodyText = document.body.textContent ?? "";
  return bodyText.split(text).length - 1;
}

describe("DiffPanel", () => {
  afterEach(() => {
    settingsRef.current = {
      diffPanelMode: "git",
      diffWordWrap: false,
      timestampFormat: "locale",
    };
    threadRef.current = {
      id: "thread-1",
      environmentId: "environment-local",
      projectId: "project-1",
      branch: "feature/panel-actions",
      workspaceId: null,
      worktreePath: "/repo/project",
    };
    workspaceRef.current = null;
    gitActionControlPropsRef.current = null;
    updateSettingsSpy.mockReset();
    gitFilterChangeSpy.mockReset();
    gitBaseBranchChangeSpy.mockReset();
    gitCommitSelectSpy.mockReset();
    gitFileSelectSpy.mockReset();
    gitFileSelectionToggleSpy.mockReset();
    localStorage.clear();
  });

  it("opens in the remembered git mode and persists switching back to iterations", async () => {
    const { default: DiffPanel } = await import("./DiffPanel");
    const mounted = await render(<DiffPanel mode="inline" />);

    try {
      await expect.element(page.getByLabelText("Git diff filter")).toBeInTheDocument();

      await page.getByRole("button", { name: "Iterations diff mode" }).click();
      await mounted.rerender(<DiffPanel mode="inline" />);

      expect(updateSettingsSpy).toHaveBeenCalledWith({ diffPanelMode: "iterations" });
      await expect.element(page.getByText("No completed turns yet.")).toBeInTheDocument();
    } finally {
      await mounted.unmount();
    }
  });

  it("falls back to the project cwd when the thread worktree is unset", async () => {
    threadRef.current = {
      ...threadRef.current,
      workspaceId: "workspace-1",
      worktreePath: null,
    };
    workspaceRef.current = {
      id: "workspace-1",
      branch: "feature/workspace-checkout",
      worktreePath: "/repo/workspaces/feature-workspace",
    };

    const { default: DiffPanel } = await import("./DiffPanel");
    const mounted = await render(<DiffPanel mode="sidebar" />);

    try {
      await expect.element(page.getByTestId("mock-git-actions-control")).toBeInTheDocument();
      expect(gitActionControlPropsRef.current).toMatchObject({
        gitCwd: "/repo/project",
        effectiveBranch: "feature/panel-actions",
        variant: "panel",
      });
    } finally {
      await mounted.unmount();
    }
  });
});

describe("GitDiffView", () => {
  it("renders one repository list and preserves persisted heights across temporary shrink", async () => {
    const { GitDiffView } = await import("./DiffPanel");
    const props = createGitDiffViewProps({
      repositories: [
        {
          cwd: "/repo/project",
          rootCwd: "/repo/project",
          parentCwd: null,
          name: "project",
          relativePath: ".",
          depth: 0,
          kind: "root",
          repositoryIdentity: null,
        },
        {
          cwd: "/repo/project/packages/shared",
          rootCwd: "/repo/project",
          parentCwd: "/repo/project",
          name: "shared",
          relativePath: "packages/shared",
          depth: 1,
          kind: "nested",
          repositoryIdentity: null,
        },
      ],
      selectedRepositoryCwd: "/repo/project",
      actionBar: <div data-testid="git-panel-action-bar">Panel actions</div>,
      allChanges: [
        {
          key: "unstaged:current:none:src/alpha.ts",
          category: "unstaged",
          label: "Unstaged",
          file: {
            path: "src/alpha.ts",
            status: "modified",
            additions: 4,
            deletions: 1,
          },
        },
      ],
    });
    const mounted = await mountGitDiffView(GitDiffView, props, { height: 1100, width: 720 });

    try {
      await expect.element(page.getByTestId("git-section-repositories")).toBeInTheDocument();
      await expect.element(page.getByTestId("git-section-review")).toBeInTheDocument();
      await expect.element(page.getByTestId("git-section-diff")).toBeInTheDocument();
      expect(countTextOccurrences("packages/shared")).toBe(1);

      await vi.waitFor(async () => {
        expect(await getElementHeight("git-section-review")).toBeGreaterThan(160);
      });

      const initialReviewHeight = await getElementHeight("git-section-review");
      await dragVerticalResizeHandle("git-resize-handle-review", 60);
      await vi.waitFor(async () => {
        expect(await getElementHeight("git-section-review")).toBeGreaterThan(initialReviewHeight);
      });

      const resizedReviewHeight = await getElementHeight("git-section-review");
      mounted.host.style.height = "760px";
      await vi.waitFor(async () => {
        expect(await getElementHeight("git-section-review")).toBeLessThan(resizedReviewHeight);
      });

      mounted.host.style.height = "1100px";
      await vi.waitFor(async () => {
        expect(await getElementHeight("git-section-review")).toBe(resizedReviewHeight);
      });
    } catch (error) {
      await mounted.unmount();
      throw error;
    }
  });

  it("renders staged and unstaged as independently scrollable resizable sections", async () => {
    const { GitDiffView } = await import("./DiffPanel");
    const mounted = await mountGitDiffView(
      GitDiffView,
      createGitDiffViewProps({
        filterMode: "uncommitted",
        staged: [
          {
            key: "staged:current:none:src/staged.ts",
            category: "staged",
            label: "Staged",
            file: {
              path: "src/staged.ts",
              status: "modified",
              additions: 2,
              deletions: 0,
            },
          },
        ],
        unstaged: [
          {
            key: "unstaged:current:none:src/unstaged.ts",
            category: "unstaged",
            label: "Unstaged",
            file: {
              path: "src/unstaged.ts",
              status: "modified",
              additions: 0,
              deletions: 3,
            },
          },
        ],
      }),
      { height: 960, width: 720 },
    );

    try {
      await expect.element(page.getByTestId("git-section-staged")).toBeInTheDocument();
      await expect.element(page.getByTestId("git-section-unstaged")).toBeInTheDocument();

      const initialStagedHeight = await getElementHeight("git-section-staged");
      await dragVerticalResizeHandle("git-resize-handle-staged", 50);
      await vi.waitFor(async () => {
        expect(await getElementHeight("git-section-staged")).toBeGreaterThan(initialStagedHeight);
      });
    } finally {
      await mounted.unmount();
    }
  });

  it("renders commits and commit files as resizable sections in commit mode", async () => {
    const { GitDiffView } = await import("./DiffPanel");
    const mounted = await mountGitDiffView(
      GitDiffView,
      createGitDiffViewProps({
        filterMode: "commit",
        commits: [
          {
            hash: "abc123",
            shortHash: "abc123",
            message: "feat: add git mode",
            author: "Capy",
            date: "2026-04-12T10:00:00.000Z",
          },
        ],
        selectedCommitHash: "abc123",
        commitFiles: [
          {
            key: "committed:abc123:none:src/DiffPanel.tsx",
            category: "committed",
            label: "Commit",
            file: {
              path: "src/DiffPanel.tsx",
              status: "modified",
              additions: 10,
              deletions: 2,
            },
          },
        ],
      }),
      { height: 960, width: 720 },
    );

    try {
      await expect.element(page.getByTestId("git-section-commits")).toBeInTheDocument();
      await expect.element(page.getByTestId("git-section-commit-files")).toBeInTheDocument();

      await vi.waitFor(async () => {
        expect(await getElementHeight("git-section-commit-files")).toBeGreaterThan(0);
      });

      const initialCommitFilesHeight = await getElementHeight("git-section-commit-files");
      await dragVerticalResizeHandle("git-resize-handle-commit-files", 40);
      await vi.waitFor(async () => {
        expect(await getElementHeight("git-section-commit-files")).toBeLessThan(
          initialCommitFilesHeight,
        );
      });
    } finally {
      await mounted.unmount();
    }
  });

  it("surfaces toolbar callbacks and commit file browsing", async () => {
    const { GitDiffView } = await import("./DiffPanel");
    const mounted = await render(
      <GitDiffView
        hasActiveThread
        activeCwd="/repo/project"
        environmentId={null}
        isGitRepo
        repositories={[]}
        repositoriesLoading={false}
        repositoriesError={null}
        selectedRepositoryCwd={null}
        onSelectRepository={() => undefined}
        actionBar={<div>Panel actions</div>}
        baseBranch="main"
        baseBranchOptions={["main", "release"]}
        filterMode="commit"
        onSelectBaseBranch={gitBaseBranchChangeSpy}
        onSelectFilterMode={gitFilterChangeSpy}
        allChanges={[]}
        staged={[]}
        unstaged={[]}
        commits={[
          {
            hash: "abc123",
            shortHash: "abc123",
            message: "feat: add git mode",
            author: "Capy",
            date: "2026-04-12T10:00:00.000Z",
          },
        ]}
        selectedCommitHash={null}
        onSelectCommit={gitCommitSelectSpy}
        commitFiles={[]}
        selectedPreview={null}
        onSelectFile={gitFileSelectSpy}
        selectedFilePaths={new Set()}
        onToggleFileSelection={gitFileSelectionToggleSpy}
        reviewStatusLoading={false}
        reviewStatusError={null}
        commitsLoading={false}
        commitsError={null}
        commitFilesLoading={false}
        commitFilesError={null}
        diffPatch={undefined}
        diffLoading={false}
        diffError={null}
        diffRenderMode="stacked"
        diffWordWrap={false}
        resolvedTheme="light"
        colorScheme="default"
        patchViewportRef={{ current: null }}
        onOpenFileInEditor={() => undefined}
      />,
    );

    try {
      await page.getByRole("button", { name: /feat: add git mode/i }).click();
      expect(gitCommitSelectSpy).toHaveBeenCalledWith("abc123");

      await mounted.rerender(
        <GitDiffView
          hasActiveThread
          activeCwd="/repo/project"
          environmentId={null}
          isGitRepo
          repositories={[]}
          repositoriesLoading={false}
          repositoriesError={null}
          selectedRepositoryCwd={null}
          onSelectRepository={() => undefined}
          actionBar={<div>Panel actions</div>}
          baseBranch="main"
          baseBranchOptions={["main", "release"]}
          filterMode="commit"
          onSelectBaseBranch={gitBaseBranchChangeSpy}
          onSelectFilterMode={gitFilterChangeSpy}
          allChanges={[]}
          staged={[]}
          unstaged={[]}
          commits={[
            {
              hash: "abc123",
              shortHash: "abc123",
              message: "feat: add git mode",
              author: "Capy",
              date: "2026-04-12T10:00:00.000Z",
            },
          ]}
          selectedCommitHash="abc123"
          onSelectCommit={gitCommitSelectSpy}
          commitFiles={[
            {
              key: "committed:abc123:none:src/DiffPanel.tsx",
              category: "committed",
              label: "Commit",
              file: {
                path: "src/DiffPanel.tsx",
                status: "modified",
                additions: 10,
                deletions: 2,
              },
            },
          ]}
          selectedPreview={null}
          onSelectFile={gitFileSelectSpy}
          selectedFilePaths={new Set()}
          onToggleFileSelection={gitFileSelectionToggleSpy}
          reviewStatusLoading={false}
          reviewStatusError={null}
          commitsLoading={false}
          commitsError={null}
          commitFilesLoading={false}
          commitFilesError={null}
          diffPatch={undefined}
          diffLoading={false}
          diffError={null}
          diffRenderMode="stacked"
          diffWordWrap={false}
          resolvedTheme="light"
          colorScheme="default"
          patchViewportRef={{ current: null }}
          onOpenFileInEditor={() => undefined}
        />,
      );

      await expect.element(page.getByText("Commit files")).toBeInTheDocument();
      await page.getByTestId("git-file-row-src/DiffPanel.tsx").click();
      expect(gitFileSelectSpy).toHaveBeenCalledWith({
        path: "src/DiffPanel.tsx",
        oldPath: undefined,
        category: "committed",
        commitHash: "abc123",
      });
    } finally {
      await mounted.unmount();
    }
  });

  it("shows the sticky action bar and toggles file selection for uncommitted entries", async () => {
    const { GitDiffView } = await import("./DiffPanel");
    const mounted = await render(
      <GitDiffView
        hasActiveThread
        activeCwd="/repo/project"
        environmentId={null}
        isGitRepo
        repositories={[]}
        repositoriesLoading={false}
        repositoriesError={null}
        selectedRepositoryCwd={null}
        onSelectRepository={() => undefined}
        actionBar={<div data-testid="git-panel-action-bar">Panel actions</div>}
        baseBranch="main"
        baseBranchOptions={["main"]}
        filterMode="all-changes"
        onSelectBaseBranch={gitBaseBranchChangeSpy}
        onSelectFilterMode={gitFilterChangeSpy}
        allChanges={[
          {
            key: "unstaged:current:none:src/selected.ts",
            category: "unstaged",
            label: "Unstaged",
            file: {
              path: "src/selected.ts",
              status: "modified",
              additions: 4,
              deletions: 1,
            },
          },
        ]}
        staged={[]}
        unstaged={[]}
        commits={[]}
        selectedCommitHash={null}
        onSelectCommit={gitCommitSelectSpy}
        commitFiles={[]}
        selectedPreview={null}
        onSelectFile={gitFileSelectSpy}
        selectedFilePaths={new Set(["src/selected.ts"])}
        onToggleFileSelection={gitFileSelectionToggleSpy}
        reviewStatusLoading={false}
        reviewStatusError={null}
        commitsLoading={false}
        commitsError={null}
        commitFilesLoading={false}
        commitFilesError={null}
        diffPatch={undefined}
        diffLoading={false}
        diffError={null}
        diffRenderMode="stacked"
        diffWordWrap={false}
        resolvedTheme="light"
        colorScheme="default"
        patchViewportRef={{ current: null }}
        onOpenFileInEditor={() => undefined}
      />,
    );

    try {
      await expect.element(page.getByTestId("git-panel-action-bar")).toBeInTheDocument();
      await page.getByTestId("git-file-select-src/selected.ts").click();
      expect(gitFileSelectionToggleSpy).toHaveBeenCalledWith("src/selected.ts");
    } finally {
      await mounted.unmount();
    }
  });
});

describe("IterationsDiffView", () => {
  it("keeps turn chips visible alongside the existing iteration browser", async () => {
    const { IterationsDiffView } = await import("./DiffPanel");
    const mounted = await render(
      <IterationsDiffView
        activeThread
        isGitRepo
        orderedTurnDiffSummaries={[
          {
            turnId: TurnId.make("turn-2"),
            completedAt: "2026-04-12T10:00:00.000Z",
            checkpointTurnCount: 2,
          },
        ]}
        inferredCheckpointTurnCountByTurnId={{}}
        selectedTurnId={TurnId.make("turn-2")}
        selectedTurn={{
          turnId: TurnId.make("turn-2"),
          completedAt: "2026-04-12T10:00:00.000Z",
          checkpointTurnCount: 2,
        }}
        settingsTimestampFormat="locale"
        onSelectTurn={() => undefined}
        onSelectWholeConversation={() => undefined}
        patch={undefined}
        isLoading={false}
        error={null}
        diffRenderMode="stacked"
        diffWordWrap={false}
        resolvedTheme="light"
        colorScheme="default"
        selectedFilePath={null}
        patchViewportRef={{ current: null }}
        onOpenFileInEditor={() => undefined}
      />,
    );

    try {
      await expect.element(page.getByText("All turns")).toBeInTheDocument();
      await expect.element(page.getByText("Turn 2")).toBeInTheDocument();
      await expect
        .element(page.getByText("No patch available for this selection."))
        .toBeInTheDocument();
    } finally {
      await mounted.unmount();
    }
  });
});
