import "../../index.css";

import type { UsageDashboardSnapshot } from "@capycode/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { UsageSettingsPanel } from "./UsageSettingsPanel";

const { ensureLocalApiMock, navigateMock } = vi.hoisted(() => ({
  ensureLocalApiMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../../localApi", () => ({
  ensureLocalApi: ensureLocalApiMock,
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function createSnapshot(): UsageDashboardSnapshot {
  return {
    providers: [
      {
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
          inputTokens: 1000,
          cachedInputTokens: 200,
          outputTokens: 500,
          reasoningOutputTokens: 100,
          totalTokens: 1700,
          sessionCount: 2,
        },
        topModels: [
          {
            model: "gpt-5.4",
            totals: {
              inputTokens: 1000,
              cachedInputTokens: 200,
              outputTokens: 500,
              reasoningOutputTokens: 100,
              totalTokens: 1700,
              sessionCount: 2,
            },
            sessionCount: 2,
            lastSeenAt: "2026-04-12T00:00:00.000Z",
            fallbackPricing: null,
          },
        ],
        buckets: Array.from({ length: 14 }, (_, index) => ({
          bucketStart: `2026-04-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
          bucketEnd: `2026-04-${String(index + 1).padStart(2, "0")}T23:59:59.000Z`,
          label: `04-${String(index + 1).padStart(2, "0")}`,
          totals: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 5,
            reasoningOutputTokens: 0,
            totalTokens: 15,
            sessionCount: 1,
          },
          modelCounts: { "gpt-5.4": 1 },
        })),
        sessions: [
          {
            id: "codex/session-1",
            startedAt: "2026-04-12T00:00:00.000Z",
            endedAt: "2026-04-12T00:30:00.000Z",
            provider: "codex",
            models: ["gpt-5.4"],
            totals: {
              inputTokens: 1000,
              cachedInputTokens: 200,
              outputTokens: 500,
              reasoningOutputTokens: 100,
              totalTokens: 1700,
              sessionCount: 1,
            },
            projectPath: "/repo/capycode",
          },
        ],
        lastHistoricalRefreshAt: "2026-04-12T00:00:00.000Z",
        lastLimitsRefreshAt: "2026-04-12T00:05:00.000Z",
        warnings: [],
      },
      {
        provider: "claudeAgent",
        identity: { accountLabel: "Claude Max", authLabel: null },
        limits: [],
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
        buckets: Array.from({ length: 14 }, (_, index) => ({
          bucketStart: `2026-04-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
          bucketEnd: `2026-04-${String(index + 1).padStart(2, "0")}T23:59:59.000Z`,
          label: `04-${String(index + 1).padStart(2, "0")}`,
          totals: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
            sessionCount: 0,
          },
          modelCounts: {},
        })),
        sessions: [],
        lastHistoricalRefreshAt: "2026-04-12T00:00:00.000Z",
        lastLimitsRefreshAt: null,
        warnings: [
          "No live quota snapshot yet. Start one turn with this provider to populate live limits.",
        ],
      },
    ],
    fetchedAt: "2026-04-12T00:05:00.000Z",
  };
}

describe("UsageSettingsPanel", () => {
  beforeEach(() => {
    const snapshot = createSnapshot();
    ensureLocalApiMock.mockReturnValue({
      usage: {
        getDashboard: vi.fn(async () => snapshot),
        refreshDashboard: vi.fn(async () => snapshot),
      },
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    ensureLocalApiMock.mockReset();
    navigateMock.mockReset();
  });

  it("renders provider usage sections and refreshes on demand", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <UsageSettingsPanel />
      </QueryClientProvider>,
      { container: host },
    );

    await expect.element(page.getByText("Provider usage and limits")).toBeInTheDocument();
    await expect.element(page.getByRole("heading", { name: "Codex" })).toBeInTheDocument();
    await expect.element(page.getByRole("heading", { name: "Claude" })).toBeInTheDocument();
    await expect.element(page.getByText("Model breakdown").first()).toBeInTheDocument();
    await expect.element(page.getByText("Recent sessions").first()).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "No live quota snapshot yet. Start one turn with this provider to populate live limits.",
        ),
      )
      .toBeInTheDocument();

    await page.getByRole("button", { name: "Refresh" }).click();

    const api = ensureLocalApiMock.mock.results[0]?.value as {
      usage: { refreshDashboard: ReturnType<typeof vi.fn> };
    };
    await vi.waitFor(() => {
      expect(api.usage.refreshDashboard).toHaveBeenCalledWith("30d");
    });

    await screen.unmount();
    host.remove();
  });
});
