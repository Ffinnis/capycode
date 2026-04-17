import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

function findSubmitButtonByText(text: string): HTMLButtonElement | null {
  return (
    (Array.from(document.querySelectorAll('button[type="submit"]')).find((button) =>
      button.textContent?.includes(text),
    ) as HTMLButtonElement | null) ?? null
  );
}

const {
  apiRef,
  branchesRef,
  checkoutSpy,
  mutateSpy,
  onOpenChangeSpy,
  onSwitchedSpy,
  prefetchInfiniteQuerySpy,
} = vi.hoisted(() => ({
  apiRef: {
    current: null as null | {
      git: {
        checkout: (input: unknown) => Promise<unknown>;
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
  checkoutSpy: vi.fn(() => Promise.resolve(undefined)),
  mutateSpy: vi.fn(),
  onOpenChangeSpy: vi.fn(),
  onSwitchedSpy: vi.fn(() => Promise.resolve()),
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
    useMutation: vi.fn((options: { mutationFn: (branch: string) => Promise<unknown> }) => ({
      isPending: false,
      mutateAsync: async (branch: string) => {
        mutateSpy(branch);
        return options.mutationFn(branch);
      },
    })),
    useQueryClient: vi.fn(() => ({
      prefetchInfiniteQuery: prefetchInfiniteQuerySpy,
      invalidateQueries: vi.fn(() => Promise.resolve()),
    })),
  };
});

vi.mock("~/environmentApi", () => ({
  ensureEnvironmentApi: vi.fn(() => apiRef.current),
}));

describe("RootBranchSwitchDialog", () => {
  beforeEach(() => {
    checkoutSpy.mockReset();
    checkoutSpy.mockImplementation(() => Promise.resolve(undefined));
    mutateSpy.mockReset();
    onOpenChangeSpy.mockReset();
    onSwitchedSpy.mockReset();
    onSwitchedSpy.mockImplementation(() => Promise.resolve());
    prefetchInfiniteQuerySpy.mockReset();
    apiRef.current = {
      git: {
        checkout: checkoutSpy,
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
  });

  it("switches the project root checkout to the selected branch", async () => {
    const { RootBranchSwitchDialog } = await import("./RootBranchSwitchDialog");
    const mounted = await render(
      <RootBranchSwitchDialog
        open
        currentBranch={null}
        onSwitched={onSwitchedSpy}
        onOpenChange={onOpenChangeSpy}
        project={{
          id: "project-1" as never,
          environmentId: "environment-local" as never,
          name: "Capycode",
          cwd: "/repo/capycode",
        }}
      />,
    );

    try {
      await expect
        .element(page.getByRole("heading", { name: "Switch branch" }))
        .toBeInTheDocument();
      await expect.element(page.getByText("Current branch:")).toBeInTheDocument();
      await expect
        .element(page.getByRole("combobox", { name: "Branch" }))
        .toHaveTextContent("main");

      const switchButton = findSubmitButtonByText("Switch branch");
      expect(switchButton, 'Submit button "Switch branch" not found').toBeTruthy();
      switchButton!.click();

      await vi.waitFor(() => {
        expect(mutateSpy).toHaveBeenCalledWith("main");
        expect(checkoutSpy).toHaveBeenCalledWith({
          cwd: "/repo/capycode",
          branch: "main",
        });
        expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
        expect(onSwitchedSpy).toHaveBeenCalledTimes(1);
      });
    } finally {
      await mounted.unmount();
    }
  });
});
