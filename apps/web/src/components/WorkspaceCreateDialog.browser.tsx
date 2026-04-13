import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const {
  apiRef,
  branchesRef,
  createWorkspaceSpy,
  gitStatusRef,
  onCreatedSpy,
  onOpenChangeSpy,
  prefetchInfiniteQuerySpy,
} = vi.hoisted(() => ({
  apiRef: {
    current: null as null | {
      workspaces: {
        create: (input: unknown) => Promise<unknown>;
      };
    },
  },
  branchesRef: {
    current: [
      {
        name: "main",
        current: true,
        isDefault: true,
        worktreePath: null,
      },
      {
        name: "feature/release-shell",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ],
  },
  createWorkspaceSpy: vi.fn(() => Promise.resolve(undefined)),
  gitStatusRef: {
    current: {
      branch: "main",
      isRepo: true,
    },
  },
  onCreatedSpy: vi.fn(() => Promise.resolve()),
  onOpenChangeSpy: vi.fn(),
  prefetchInfiniteQuerySpy: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");

  return {
    ...actual,
    useInfiniteQuery: vi.fn(() => ({
      data: {
        pages: [
          {
            branches: branchesRef.current,
            totalCount: branchesRef.current.length,
            nextCursor: null,
            isRepo: true,
            hasOriginRemote: true,
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isPending: false,
    })),
    useQueryClient: vi.fn(() => ({
      prefetchInfiniteQuery: prefetchInfiniteQuerySpy,
    })),
  };
});

vi.mock("~/environmentApi", () => ({
  ensureEnvironmentApi: vi.fn(() => apiRef.current),
  readEnvironmentApi: vi.fn(() => apiRef.current),
}));

vi.mock("~/lib/gitStatusState", () => ({
  resetGitStatusStateForTests: () => undefined,
  useGitStatus: vi.fn(() => ({
    data: gitStatusRef.current,
    error: null,
    isPending: false,
  })),
}));

describe("WorkspaceCreateDialog", () => {
  afterEach(() => {
    createWorkspaceSpy.mockReset();
    createWorkspaceSpy.mockImplementation(() => Promise.resolve(undefined));
    onCreatedSpy.mockReset();
    onCreatedSpy.mockImplementation(() => Promise.resolve());
    onOpenChangeSpy.mockReset();
    prefetchInfiniteQuerySpy.mockReset();
    apiRef.current = {
      workspaces: {
        create: createWorkspaceSpy,
      },
    };
    branchesRef.current = [
      {
        name: "main",
        current: true,
        isDefault: true,
        worktreePath: null,
      },
      {
        name: "feature/release-shell",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];
    gitStatusRef.current = {
      branch: "main",
      isRepo: true,
    };
  });

  it("renders worktree mode with branch-name and base-branch controls", async () => {
    const { WorkspaceCreateDialog } = await import("./WorkspaceCreateDialog");
    const mounted = await render(
      <WorkspaceCreateDialog
        open
        mode="worktree"
        activeWorkspaceBranch={null}
        threadBranch={null}
        onCreated={onCreatedSpy}
        onOpenChange={onOpenChangeSpy}
        project={{
          id: "project-1" as never,
          environmentId: "environment-local" as never,
          name: "Capycode",
          cwd: "/repo/capycode",
        }}
        workspaceCount={2}
      />,
    );

    try {
      await expect.element(page.getByText("New worktree workspace")).toBeInTheDocument();
      await expect.element(page.getByLabelText("Workspace name (optional)")).toBeInTheDocument();
      await expect.element(page.getByLabelText("Branch name")).toBeInTheDocument();
      await expect.element(page.getByLabelText("From branch")).toBeInTheDocument();
      await expect.element(page.getByLabelText("Branch")).not.toBeInTheDocument();
    } finally {
      await mounted.unmount();
    }
  });

  it("renders branch mode with only the existing branch picker", async () => {
    const { WorkspaceCreateDialog } = await import("./WorkspaceCreateDialog");
    const mounted = await render(
      <WorkspaceCreateDialog
        open
        mode="branch"
        activeWorkspaceBranch={null}
        threadBranch={null}
        onCreated={onCreatedSpy}
        onOpenChange={onOpenChangeSpy}
        project={{
          id: "project-1" as never,
          environmentId: "environment-local" as never,
          name: "Capycode",
          cwd: "/repo/capycode",
        }}
        workspaceCount={2}
      />,
    );

    try {
      await expect.element(page.getByText("New branch workspace")).toBeInTheDocument();
      await expect.element(page.getByLabelText("Workspace name (optional)")).toBeInTheDocument();
      await expect.element(page.getByLabelText("Branch")).toBeInTheDocument();
      await expect.element(page.getByLabelText("Branch name")).not.toBeInTheDocument();
      await expect.element(page.getByLabelText("From branch")).not.toBeInTheDocument();
    } finally {
      await mounted.unmount();
    }
  });

  it("submits a worktree payload and auto-generates the workspace name when blank", async () => {
    const { WorkspaceCreateDialog } = await import("./WorkspaceCreateDialog");
    const mounted = await render(
      <WorkspaceCreateDialog
        open
        mode="worktree"
        activeWorkspaceBranch={null}
        threadBranch={null}
        onCreated={onCreatedSpy}
        onOpenChange={onOpenChangeSpy}
        project={{
          id: "project-1" as never,
          environmentId: "environment-local" as never,
          name: "Capycode",
          cwd: "/repo/capycode",
        }}
        workspaceCount={2}
      />,
    );

    try {
      await page.getByLabelText("Branch name").fill("feature/release-shell");
      await page.getByRole("button", { name: "From branch" }).click();
      await page.getByRole("option", { name: "main" }).click();
      await page.getByRole("button", { name: "Create workspace" }).click();

      expect(createWorkspaceSpy).toHaveBeenCalledWith({
        projectId: "project-1",
        type: "worktree",
        name: "Release shell",
        branch: "feature/release-shell",
        baseBranch: "main",
      });
      expect(onCreatedSpy).toHaveBeenCalledTimes(1);
      expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
    } finally {
      await mounted.unmount();
    }
  });

  it("keeps the dialog open and shows an inline error when creation fails", async () => {
    createWorkspaceSpy.mockRejectedValueOnce(new Error("Creation failed."));

    const { WorkspaceCreateDialog } = await import("./WorkspaceCreateDialog");
    const mounted = await render(
      <WorkspaceCreateDialog
        open
        mode="branch"
        activeWorkspaceBranch={null}
        threadBranch={null}
        onCreated={onCreatedSpy}
        onOpenChange={onOpenChangeSpy}
        project={{
          id: "project-1" as never,
          environmentId: "environment-local" as never,
          name: "Capycode",
          cwd: "/repo/capycode",
        }}
        workspaceCount={2}
      />,
    );

    try {
      await page.getByRole("button", { name: "Branch" }).click();
      await page.getByRole("option", { name: "feature/release-shell" }).click();
      await page.getByRole("button", { name: "Create workspace" }).click();

      await expect.element(page.getByText("Creation failed.")).toBeInTheDocument();
      expect(onCreatedSpy).not.toHaveBeenCalled();
      expect(onOpenChangeSpy).not.toHaveBeenCalledWith(false);
    } finally {
      await mounted.unmount();
    }
  });
});
