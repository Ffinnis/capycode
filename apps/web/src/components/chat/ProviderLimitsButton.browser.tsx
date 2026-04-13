import "../../index.css";

import type { ProviderUsageDashboard } from "@capycode/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProviderLimitsButton } from "./ProviderLimitsButton";

const { ensureLocalApiMock, navigateMock, useProviderLimitsMock, useUsageSnapshotMock } =
  vi.hoisted(() => ({
    ensureLocalApiMock: vi.fn(),
    navigateMock: vi.fn(),
    useProviderLimitsMock: vi.fn(),
    useUsageSnapshotMock: vi.fn(),
  }));

const providerDashboard: ProviderUsageDashboard = {
  provider: "codex",
  identity: { accountLabel: "OpenAI Pro", authLabel: null },
  limits: [
    {
      kind: "rolling-5h",
      usedPercent: 42,
      remainingPercent: 58,
      windowMinutes: 300,
      resetsAt: "2026-04-12T05:00:00.000Z",
      resetDescription: "Resets in 2h",
      source: "codex-app-server",
      stale: false,
    },
    {
      kind: "weekly",
      usedPercent: 63,
      remainingPercent: 37,
      windowMinutes: 10_080,
      resetsAt: "2026-04-18T00:00:00.000Z",
      resetDescription: "Resets in 6d",
      source: "codex-app-server",
      stale: false,
    },
  ],
  range: "30d",
  totals: {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    sessionCount: 0,
  },
  topModels: [],
  buckets: [],
  sessions: [],
  lastHistoricalRefreshAt: "2026-04-12T00:00:00.000Z",
  lastLimitsRefreshAt: "2026-04-12T00:05:00.000Z",
  warnings: [],
};

vi.mock("../../localApi", () => ({
  ensureLocalApi: ensureLocalApiMock,
}));

vi.mock("../../hooks/useProviderLimits", () => ({
  useProviderLimits: useProviderLimitsMock,
}));

vi.mock("../../rpc/usageState", () => ({
  useUsageSnapshot: useUsageSnapshotMock,
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("ProviderLimitsButton", () => {
  beforeEach(() => {
    ensureLocalApiMock.mockReturnValue({
      usage: {
        refreshDashboard: vi.fn(async () => ({
          providers: [providerDashboard],
          fetchedAt: "2026-04-12T00:05:00.000Z",
        })),
      },
    });
    useProviderLimitsMock.mockReturnValue({
      provider: providerDashboard,
      data: { providers: [providerDashboard], fetchedAt: "2026-04-12T00:05:00.000Z" },
      isLoading: false,
      isError: false,
    });
    useUsageSnapshotMock.mockReturnValue({
      providers: [providerDashboard],
      fetchedAt: "2026-04-12T00:05:00.000Z",
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    ensureLocalApiMock.mockReset();
    navigateMock.mockReset();
    useProviderLimitsMock.mockReset();
    useUsageSnapshotMock.mockReset();
  });

  it("shows the remaining limit on the button and renders both windows in the popover", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <ProviderLimitsButton provider="codex" />
      </QueryClientProvider>,
      { container: host },
    );

    await expect.element(page.getByRole("button", { name: "codex limits" })).toHaveTextContent(
      "58% left",
    );

    await page.getByRole("button", { name: "codex limits" }).click();

    await expect.element(page.getByText("5h limit")).toBeInTheDocument();
    await expect.element(page.getByText("Weekly limit")).toBeInTheDocument();
    await expect.element(page.getByText("Resets in 2h")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Open Usage" })).toBeInTheDocument();

    await screen.unmount();
    host.remove();
  });
});
