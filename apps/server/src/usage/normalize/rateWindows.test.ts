import { describe, expect, it } from "vitest";

import {
  normalizeClaudeRateLimitWindow,
  normalizeClaudeRateWindows,
  normalizeCodexRateWindows,
} from "./rateWindows";

describe("rateWindows", () => {
  it("normalizes Codex app-server windows into 5h and weekly limits", () => {
    const windows = normalizeCodexRateWindows(
      {
        rateLimits: {
          primary: {
            used_percent: 42,
            window_minutes: 300,
            resets_at: "2026-04-12T05:00:00.000Z",
          },
          secondary: {
            usedPercent: 63,
            windowDurationMins: 10_080,
            resetsAt: "2026-04-18T00:00:00.000Z",
          },
        },
      },
      {
        stale: false,
        now: new Date("2026-04-12T03:00:00.000Z"),
      },
    );

    expect(windows).toEqual([
      expect.objectContaining({
        kind: "rolling-5h",
        usedPercent: 42,
        remainingPercent: 58,
        source: "codex-app-server",
        stale: false,
      }),
      expect.objectContaining({
        kind: "weekly",
        usedPercent: 63,
        remainingPercent: 37,
        source: "codex-app-server",
        stale: false,
      }),
    ]);
  });

  it("normalizes Claude runtime limits from utilization ratios", () => {
    const window = normalizeClaudeRateLimitWindow(
      {
        rate_limit_info: {
          rateLimitType: "seven_day_opus",
          utilization: 0.42,
          resetsAt: "2026-04-18T00:00:00.000Z",
        },
      },
      {
        stale: true,
        now: new Date("2026-04-12T00:00:00.000Z"),
      },
    );

    expect(window).toEqual(
      expect.objectContaining({
        kind: "weekly",
        usedPercent: 42,
        remainingPercent: 58,
        source: "claude-runtime",
        stale: true,
      }),
    );
  });

  it("normalizes Claude OAuth snapshot limits into 5h and weekly windows", () => {
    const windows = normalizeClaudeRateWindows(
      {
        five_hour: {
          utilization: 12.5,
          resets_at: "2026-04-12T05:00:00.000Z",
        },
        seven_day: {
          utilization: 30,
          resets_at: "2026-04-18T00:00:00.000Z",
        },
        seven_day_opus: {
          utilization: 42,
          resets_at: "2026-04-19T00:00:00.000Z",
        },
      },
      {
        stale: false,
        now: new Date("2026-04-12T00:00:00.000Z"),
        source: "claude-oauth-api",
      },
    );

    expect(windows).toEqual([
      expect.objectContaining({
        kind: "rolling-5h",
        usedPercent: 12.5,
        remainingPercent: 87.5,
        source: "claude-oauth-api",
        stale: false,
      }),
      expect.objectContaining({
        kind: "weekly",
        usedPercent: 30,
        remainingPercent: 70,
        source: "claude-oauth-api",
        stale: false,
      }),
    ]);
  });
});
