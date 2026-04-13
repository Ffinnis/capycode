import type { UsageDashboardSnapshot } from "@capycode/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { applyUsageEvent, getUsageSnapshot, resetUsageStateForTests } from "./usageState";

const baseSnapshot: UsageDashboardSnapshot = {
  providers: [
    {
      provider: "codex",
      identity: { accountLabel: "Pro", authLabel: null },
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
      buckets: [],
      sessions: [],
      lastHistoricalRefreshAt: "2026-04-12T00:00:00.000Z",
      lastLimitsRefreshAt: null,
      warnings: [],
    },
  ],
  fetchedAt: "2026-04-12T00:00:00.000Z",
};

afterEach(() => {
  resetUsageStateForTests();
});

describe("usageState", () => {
  it("stores the latest snapshot event", () => {
    applyUsageEvent({ type: "snapshot", snapshot: baseSnapshot });

    expect(getUsageSnapshot()).toEqual(baseSnapshot);
  });

  it("merges live limit updates into the existing snapshot", () => {
    applyUsageEvent({ type: "snapshot", snapshot: baseSnapshot });
    applyUsageEvent({
      type: "limitsUpdated",
      provider: "codex",
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
      ],
    });

    expect(getUsageSnapshot()?.providers[0]?.limits).toEqual([
      expect.objectContaining({
        kind: "rolling-5h",
        usedPercent: 42,
        remainingPercent: 58,
      }),
    ]);
    expect(getUsageSnapshot()?.providers[0]?.lastLimitsRefreshAt).not.toBeNull();
  });

  it("replaces the snapshot when a historical update provides one", () => {
    applyUsageEvent({ type: "snapshot", snapshot: baseSnapshot });
    applyUsageEvent({
      type: "historicalUpdated",
      provider: "codex",
      range: "7d",
      snapshot: {
        ...baseSnapshot,
        fetchedAt: "2026-04-12T01:00:00.000Z",
      },
    });

    expect(getUsageSnapshot()?.fetchedAt).toBe("2026-04-12T01:00:00.000Z");
  });
});
