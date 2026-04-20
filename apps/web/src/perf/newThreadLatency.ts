import { useSyncExternalStore } from "react";

export type NewThreadLatencyFlow = "workspace-button" | "shortcut";

export interface NewThreadLatencySample {
  flow: NewThreadLatencyFlow;
  startedAt: string;
  durationMs: number;
  phaseBreakdown?: {
    draftMutationMs?: number;
    routeTransitionMs?: number;
    workspaceAckMs?: number;
    workspaceAckStatus?: "success" | "error";
  };
}

export interface NewThreadLatencyTracker {
  readonly flow: NewThreadLatencyFlow;
  readonly startedAt: string;
  markDraftMutationComplete: () => void;
  markRouteReady: () => void;
  markWorkspaceAck: (status?: "success" | "error") => void;
}

const MAX_SAMPLES = 50;
const IS_DEV = import.meta.env.DEV;

const listeners = new Set<() => void>();
let samplesWithId: Array<{ id: number; sample: NewThreadLatencySample }> = [];
let cachedNewThreadLatencySamples: ReadonlyArray<NewThreadLatencySample> = [];
let nextSampleId = 1;

let nowProvider = (): number => {
  if (typeof globalThis.performance?.now === "function") {
    return globalThis.performance.now();
  }
  return Date.now();
};

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function refreshCachedNewThreadLatencySamples(): void {
  cachedNewThreadLatencySamples = samplesWithId.map((entry) => entry.sample);
}

function appendSample(sample: NewThreadLatencySample): number {
  const sampleId = nextSampleId;
  nextSampleId += 1;
  samplesWithId = [...samplesWithId, { id: sampleId, sample }].slice(-MAX_SAMPLES);
  refreshCachedNewThreadLatencySamples();
  emitChange();
  return sampleId;
}

function updateSampleById(
  sampleId: number,
  updater: (sample: NewThreadLatencySample) => NewThreadLatencySample,
): void {
  const index = samplesWithId.findIndex((entry) => entry.id === sampleId);
  if (index < 0) {
    return;
  }
  const previous = samplesWithId[index];
  if (!previous) {
    return;
  }
  const next = updater(previous.sample);
  if (next === previous.sample) {
    return;
  }
  samplesWithId = [
    ...samplesWithId.slice(0, index),
    { id: previous.id, sample: next },
    ...samplesWithId.slice(index + 1),
  ];
  refreshCachedNewThreadLatencySamples();
  emitChange();
}

const NOOP_TRACKER: NewThreadLatencyTracker = {
  flow: "shortcut",
  startedAt: "",
  markDraftMutationComplete: () => undefined,
  markRouteReady: () => undefined,
  markWorkspaceAck: () => undefined,
};

export function startNewThreadLatency(flow: NewThreadLatencyFlow): NewThreadLatencyTracker {
  if (!IS_DEV) {
    return NOOP_TRACKER;
  }

  const startedAtMs = nowProvider();
  const startedAtIso = new Date().toISOString();
  let draftMutationAtMs: number | null = null;
  let routeReadyAtMs: number | null = null;
  let workspaceAckAtMs: number | null = null;
  let workspaceAckStatus: "success" | "error" | null = null;
  let sampleId: number | null = null;

  const buildSample = (): NewThreadLatencySample | null => {
    if (routeReadyAtMs === null) {
      return null;
    }
    const phaseBreakdown: NonNullable<NewThreadLatencySample["phaseBreakdown"]> = {
      routeTransitionMs:
        routeReadyAtMs - (draftMutationAtMs === null ? startedAtMs : draftMutationAtMs),
    };
    if (draftMutationAtMs !== null) {
      phaseBreakdown.draftMutationMs = draftMutationAtMs - startedAtMs;
    }
    if (workspaceAckAtMs !== null) {
      phaseBreakdown.workspaceAckMs = workspaceAckAtMs - startedAtMs;
    }
    if (workspaceAckStatus !== null) {
      phaseBreakdown.workspaceAckStatus = workspaceAckStatus;
    }
    return {
      flow,
      startedAt: startedAtIso,
      durationMs: routeReadyAtMs - startedAtMs,
      phaseBreakdown,
    };
  };

  return {
    flow,
    startedAt: startedAtIso,
    markDraftMutationComplete: () => {
      if (draftMutationAtMs !== null) {
        return;
      }
      draftMutationAtMs = nowProvider();
    },
    markRouteReady: () => {
      if (routeReadyAtMs !== null) {
        return;
      }
      routeReadyAtMs = nowProvider();
      const sample = buildSample();
      if (!sample) {
        return;
      }
      sampleId = appendSample(sample);
    },
    markWorkspaceAck: (status = "success") => {
      workspaceAckAtMs = nowProvider();
      workspaceAckStatus = status;
      if (sampleId === null) {
        return;
      }
      const nextSample = buildSample();
      if (!nextSample) {
        return;
      }
      updateSampleById(sampleId, () => nextSample);
    },
  };
}

export function getNewThreadLatencySamples(): ReadonlyArray<NewThreadLatencySample> {
  return cachedNewThreadLatencySamples;
}

export function useNewThreadLatencySamples(): ReadonlyArray<NewThreadLatencySample> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getNewThreadLatencySamples,
    getNewThreadLatencySamples,
  );
}

export function __resetNewThreadLatencyForTests(): void {
  samplesWithId = [];
  refreshCachedNewThreadLatencySamples();
  nextSampleId = 1;
  emitChange();
}

export function __setNewThreadLatencyNowProviderForTests(provider: (() => number) | null): void {
  nowProvider =
    provider ??
    (() => {
      if (typeof globalThis.performance?.now === "function") {
        return globalThis.performance.now();
      }
      return Date.now();
    });
}
