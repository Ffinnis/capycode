import { TurnId } from "@capycode/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

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
