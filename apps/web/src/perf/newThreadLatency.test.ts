import { afterEach, describe, expect, it } from "vitest";

import {
  __resetNewThreadLatencyForTests,
  __setNewThreadLatencyNowProviderForTests,
  getNewThreadLatencySamples,
  startNewThreadLatency,
} from "./newThreadLatency";

afterEach(() => {
  __setNewThreadLatencyNowProviderForTests(null);
  __resetNewThreadLatencyForTests();
});

describe("newThreadLatency", () => {
  it("records draft mutation and route transition phases", () => {
    let nowMs = 0;
    __setNewThreadLatencyNowProviderForTests(() => nowMs);

    const tracker = startNewThreadLatency("shortcut");
    nowMs = 24;
    tracker.markDraftMutationComplete();
    nowMs = 84;
    tracker.markRouteReady();

    expect(getNewThreadLatencySamples()).toMatchObject([
      {
        flow: "shortcut",
        durationMs: 84,
        phaseBreakdown: {
          draftMutationMs: 24,
          routeTransitionMs: 60,
        },
      },
    ]);
  });

  it("updates workspace ack latency after route readiness", () => {
    let nowMs = 10;
    __setNewThreadLatencyNowProviderForTests(() => nowMs);

    const tracker = startNewThreadLatency("workspace-button");
    nowMs = 25;
    tracker.markDraftMutationComplete();
    nowMs = 70;
    tracker.markRouteReady();
    nowMs = 130;
    tracker.markWorkspaceAck("error");

    expect(getNewThreadLatencySamples()).toMatchObject([
      {
        flow: "workspace-button",
        durationMs: 60,
        phaseBreakdown: {
          draftMutationMs: 15,
          routeTransitionMs: 45,
          workspaceAckMs: 120,
          workspaceAckStatus: "error",
        },
      },
    ]);
  });

  it("keeps only the latest 50 samples", () => {
    let nowMs = 0;
    __setNewThreadLatencyNowProviderForTests(() => nowMs);

    for (let index = 0; index < 55; index += 1) {
      const tracker = startNewThreadLatency("shortcut");
      nowMs += 1;
      tracker.markRouteReady();
    }

    const samples = getNewThreadLatencySamples();
    expect(samples).toHaveLength(50);
    expect(samples[0]?.durationMs).toBe(1);
    expect(samples[49]?.durationMs).toBe(1);
  });
});
