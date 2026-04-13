import * as fs from "node:fs";
import * as OS from "node:os";
import * as path from "node:path";

import type {
  ProviderRateWindow,
  ProviderRuntimeEvent,
  ProviderUsageDashboard,
  ProviderUsageIdentity,
  UsageDashboardSnapshot,
  UsageModelSummary,
  UsageRange,
  UsageRefreshState,
  UsageSessionSummary,
  UsageStreamEvent,
  UsageTotals,
} from "@capycode/contracts";
import { DEFAULT_USAGE_RANGE, EMPTY_USAGE_TOTALS, UsageDashboardError } from "@capycode/contracts";
import { Effect, Layer, PubSub, Ref, Stream } from "effect";

import { ProviderService } from "../../provider/Services/ProviderService";
import { ServerSettingsService } from "../../serverSettings";
import { UsageService, type UsageServiceShape } from "../Services/UsageService";
import { mergeClaudeRateLimits } from "../providers/ClaudeLimitsProjection";
import {
  readClaudeHistoricalUsage,
  type ClaudeHistoricalUsageResult,
} from "../providers/ClaudeHistoricalUsage";
import { probeClaudeLimits, type ClaudeLimitsProbeResult } from "../providers/ClaudeLimitsProbe";
import { probeCodexLimits, type CodexLimitsProbeResult } from "../providers/CodexLimitsProbe";
import {
  readCodexHistoricalUsage,
  type CodexHistoricalUsageResult,
} from "../providers/CodexHistoricalUsage";
import { normalizeCodexRateWindows } from "../normalize/rateWindows";

const HISTORICAL_USAGE_TTL_MS = 60_000;
const CODEX_LIMITS_TTL_MS = 30_000;
const CLAUDE_LIMITS_TTL_MS = 30_000;
const CLAUDE_LIMITS_STALE_MS = 30 * 60_000;
const DEFAULT_BUCKET_COUNT = 14;

interface HistoricalCacheEntry {
  readonly rootPath: string;
  readonly fetchedAt: string;
  readonly sessions: ReadonlyArray<UsageSessionSummary>;
  readonly warnings: ReadonlyArray<string>;
}

interface LimitsCacheEntry {
  readonly identity: ProviderUsageIdentity;
  readonly limits: ReadonlyArray<ProviderRateWindow>;
  readonly fetchedAt: string | null;
}

interface UsageCacheState {
  readonly historical: {
    readonly codex: HistoricalCacheEntry | null;
    readonly claudeAgent: HistoricalCacheEntry | null;
  };
  readonly limits: {
    readonly codex: LimitsCacheEntry | null;
    readonly claudeAgent: LimitsCacheEntry | null;
  };
  readonly refresh: Readonly<Record<UsageRange, UsageRefreshState>>;
}

function defaultRefreshState(range: UsageRange): UsageRefreshState {
  return {
    range,
    refreshing: false,
    lastStartedAt: null,
    lastCompletedAt: null,
  };
}

const INITIAL_STATE: UsageCacheState = {
  historical: {
    codex: null,
    claudeAgent: null,
  },
  limits: {
    codex: null,
    claudeAgent: null,
  },
  refresh: {
    "7d": defaultRefreshState("7d"),
    "30d": defaultRefreshState("30d"),
    "90d": defaultRefreshState("90d"),
    all: defaultRefreshState("all"),
  },
};

function usageNow(): string {
  return new Date().toISOString();
}

function addTotals(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    sessionCount: left.sessionCount + right.sessionCount,
  };
}

function toEmptyIdentity(): ProviderUsageIdentity {
  return {
    accountLabel: null,
    authLabel: null,
  };
}

function isWithinRange(timestamp: string, range: UsageRange, now: Date): boolean {
  if (range === "all") return true;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return false;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return date.getTime() >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

function timeRangeStart(
  range: UsageRange,
  now: Date,
  sessions: ReadonlyArray<UsageSessionSummary>,
): Date {
  if (range === "all") {
    const lastSession = sessions[sessions.length - 1];
    return lastSession
      ? new Date(lastSession.startedAt)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function buildBuckets(
  range: UsageRange,
  sessions: ReadonlyArray<UsageSessionSummary>,
  now: Date,
): ProviderUsageDashboard["buckets"] {
  const bucketStart = timeRangeStart(range, now, sessions);
  const endTime = now.getTime();
  const startTime = bucketStart.getTime();
  const bucketWidthMs = Math.max(1, Math.ceil((endTime - startTime) / DEFAULT_BUCKET_COUNT));

  const buckets = Array.from({ length: DEFAULT_BUCKET_COUNT }, (_, index) => {
    const start = new Date(startTime + index * bucketWidthMs);
    const end = new Date(Math.min(endTime, start.getTime() + bucketWidthMs));
    return {
      bucketStart: start.toISOString(),
      bucketEnd: end.toISOString(),
      label: start.toISOString().slice(5, 10),
      totals: { ...EMPTY_USAGE_TOTALS },
      modelCounts: {} as Record<string, number>,
    };
  });

  for (const session of sessions) {
    const sessionTime = new Date(session.startedAt).getTime();
    if (Number.isNaN(sessionTime) || sessionTime < startTime || sessionTime > endTime) {
      continue;
    }
    const index = Math.min(
      buckets.length - 1,
      Math.max(0, Math.floor((sessionTime - startTime) / bucketWidthMs)),
    );
    const bucket = buckets[index];
    if (!bucket) {
      continue;
    }
    bucket.totals = addTotals(bucket.totals, session.totals);
    for (const model of session.models) {
      bucket.modelCounts[model] = (bucket.modelCounts[model] ?? 0) + 1;
    }
  }

  return buckets;
}

function buildTopModels(
  sessions: ReadonlyArray<UsageSessionSummary>,
): ReadonlyArray<UsageModelSummary> {
  const models = new Map<
    string,
    { totals: UsageTotals; sessionIds: Set<string>; lastSeenAt: string | null }
  >();

  for (const session of sessions) {
    for (const model of session.models) {
      const current = models.get(model) ?? {
        totals: { ...EMPTY_USAGE_TOTALS },
        sessionIds: new Set<string>(),
        lastSeenAt: null,
      };
      current.totals = addTotals(current.totals, session.totals);
      current.sessionIds.add(session.id);
      current.lastSeenAt =
        current.lastSeenAt === null || session.startedAt > current.lastSeenAt
          ? session.startedAt
          : current.lastSeenAt;
      models.set(model, current);
    }
  }

  return Array.from(models.entries())
    .map(([model, value]) => ({
      model,
      totals: value.totals,
      sessionCount: value.sessionIds.size,
      lastSeenAt: value.lastSeenAt,
      fallbackPricing: null,
    }))
    .toSorted((left, right) => right.totals.totalTokens - left.totals.totalTokens);
}

function staleWindows(
  limits: ReadonlyArray<ProviderRateWindow>,
  stale: boolean,
): ReadonlyArray<ProviderRateWindow> {
  return limits.map((window) => ({ ...window, stale }));
}

function mergeCodexRateLimits(
  current: ReadonlyArray<ProviderRateWindow>,
  payload: unknown,
): ReadonlyArray<ProviderRateWindow> {
  const next = normalizeCodexRateWindows(payload);
  return next.length > 0 ? next : current;
}

function toProviderDashboard(input: {
  readonly provider: "codex" | "claudeAgent";
  readonly range: UsageRange;
  readonly now: Date;
  readonly historical: HistoricalCacheEntry | null;
  readonly limits: LimitsCacheEntry | null;
}): ProviderUsageDashboard {
  const filteredSessions = (input.historical?.sessions ?? []).filter((session) =>
    isWithinRange(session.startedAt, input.range, input.now),
  );
  const totals = filteredSessions.reduce(
    (accumulator, session) => addTotals(accumulator, session.totals),
    { ...EMPTY_USAGE_TOTALS },
  );
  const topModels = buildTopModels(filteredSessions);
  const limits = input.limits?.limits ?? [];
  const warnings = [...(input.historical?.warnings ?? [])];

  if (limits.length === 0) {
    warnings.push(
      "No live quota snapshot yet. Start one turn with this provider to populate live limits.",
    );
  }

  return {
    provider: input.provider,
    identity: input.limits?.identity ?? toEmptyIdentity(),
    limits,
    range: input.range,
    totals,
    topModels,
    buckets: buildBuckets(input.range, filteredSessions, input.now),
    sessions: filteredSessions.slice(0, 8),
    lastHistoricalRefreshAt: input.historical?.fetchedAt ?? null,
    lastLimitsRefreshAt: input.limits?.fetchedAt ?? null,
    warnings,
  };
}

function readCodexHistoricalRoot(homePath: string): string {
  return path.join(homePath || path.join(OS.homedir(), ".codex"), "sessions");
}

function resolveCodexHomePath(homePath: string): string {
  const trimmed = homePath.trim();
  if (trimmed.length > 0) {
    return trimmed.startsWith("~") ? path.join(OS.homedir(), trimmed.slice(1)) : trimmed;
  }
  return process.env.CODEX_HOME || path.join(OS.homedir(), ".codex");
}

function resolveClaudeProjectsRoot(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configured) {
    const normalized = configured.startsWith("~")
      ? path.join(OS.homedir(), configured.slice(1))
      : configured;
    return path.basename(normalized) === "projects"
      ? normalized
      : path.join(normalized, "projects");
  }

  const primary = path.join(OS.homedir(), ".config", "claude", "projects");
  if (fs.existsSync(primary)) {
    return primary;
  }

  return path.join(OS.homedir(), ".claude", "projects");
}

function nowMs(): number {
  return Date.now();
}

function isFresh(isoTimestamp: string | null, ttlMs: number): boolean {
  if (!isoTimestamp) return false;
  const timestamp = new Date(isoTimestamp).getTime();
  return Number.isFinite(timestamp) && nowMs() - timestamp <= ttlMs;
}

function mapHistoricalResult(
  result: CodexHistoricalUsageResult | ClaudeHistoricalUsageResult,
): HistoricalCacheEntry {
  return {
    rootPath: result.rootPath,
    fetchedAt: usageNow(),
    sessions: result.sessions,
    warnings: result.warnings,
  };
}

function mapCodexLimits(result: CodexLimitsProbeResult): LimitsCacheEntry {
  return {
    identity: result.identity,
    limits: result.limits,
    fetchedAt: usageNow(),
  };
}

function mapClaudeLimits(result: ClaudeLimitsProbeResult): LimitsCacheEntry {
  return {
    identity: result.identity,
    limits: result.limits,
    fetchedAt: usageNow(),
  };
}

function toUsageError(detail: string, provider?: "codex" | "claudeAgent"): UsageDashboardError {
  return new UsageDashboardError({
    detail,
    ...(provider ? { provider } : {}),
  });
}

const makeUsageService = Effect.gen(function* () {
  const providerService = yield* ProviderService;
  const settingsService = yield* ServerSettingsService;
  const changesPubSub = yield* PubSub.unbounded<UsageStreamEvent>();
  const stateRef = yield* Ref.make<UsageCacheState>(INITIAL_STATE);

  const publish = (event: UsageStreamEvent) =>
    PubSub.publish(changesPubSub, event).pipe(Effect.asVoid);

  const setRefreshState = (
    range: UsageRange,
    updater: (current: UsageRefreshState) => UsageRefreshState,
  ) =>
    Ref.updateAndGet(stateRef, (state) => ({
      ...state,
      refresh: {
        ...state.refresh,
        [range]: updater(state.refresh[range]),
      },
    })).pipe(
      Effect.map((state) => state.refresh[range]),
      Effect.tap((refreshState) =>
        publish({
          type: "refreshStateChanged",
          state: refreshState,
        }),
      ),
      Effect.asVoid,
    );

  const readCodexHistoricalCache = (force: boolean) =>
    Effect.gen(function* () {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(() => toUsageError("Failed to read server settings.", "codex")),
      );
      const homePath = resolveCodexHomePath(settings.providers.codex.homePath);
      const rootPath = readCodexHistoricalRoot(homePath);
      const state = yield* Ref.get(stateRef);
      const current = state.historical.codex;
      if (
        !force &&
        current &&
        current.rootPath === rootPath &&
        isFresh(current.fetchedAt, HISTORICAL_USAGE_TTL_MS)
      ) {
        return current;
      }

      const next = yield* Effect.tryPromise({
        try: () => readCodexHistoricalUsage({ rootPath }),
        catch: () => toUsageError("Failed to parse Codex usage logs.", "codex"),
      }).pipe(Effect.map(mapHistoricalResult));

      yield* Ref.update(stateRef, (currentState) => ({
        ...currentState,
        historical: {
          ...currentState.historical,
          codex: next,
        },
      }));
      yield* publish({ type: "historicalUpdated", provider: "codex", range: DEFAULT_USAGE_RANGE });
      return next;
    });

  const readClaudeHistoricalCache = (force: boolean) =>
    Effect.gen(function* () {
      const rootPath = resolveClaudeProjectsRoot();
      const state = yield* Ref.get(stateRef);
      const current = state.historical.claudeAgent;
      if (
        !force &&
        current &&
        current.rootPath === rootPath &&
        isFresh(current.fetchedAt, HISTORICAL_USAGE_TTL_MS)
      ) {
        return current;
      }

      const next = yield* Effect.tryPromise({
        try: () => readClaudeHistoricalUsage({ rootPath }),
        catch: () => toUsageError("Failed to parse Claude usage logs.", "claudeAgent"),
      }).pipe(Effect.map(mapHistoricalResult));

      yield* Ref.update(stateRef, (currentState) => ({
        ...currentState,
        historical: {
          ...currentState.historical,
          claudeAgent: next,
        },
      }));
      yield* publish({
        type: "historicalUpdated",
        provider: "claudeAgent",
        range: DEFAULT_USAGE_RANGE,
      });
      return next;
    });

  const refreshCodexLimits = (force: boolean) =>
    Effect.gen(function* () {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(() => toUsageError("Failed to read server settings.", "codex")),
      );
      const current = (yield* Ref.get(stateRef)).limits.codex;
      if (!force && current && isFresh(current.fetchedAt, CODEX_LIMITS_TTL_MS)) {
        return current;
      }

      const next = yield* Effect.tryPromise({
        try: () =>
          probeCodexLimits({
            binaryPath: settings.providers.codex.binaryPath,
            ...(settings.providers.codex.homePath.trim().length > 0
              ? { homePath: settings.providers.codex.homePath }
              : {}),
            cwd: process.cwd(),
          }),
        catch: () => toUsageError("Failed to fetch Codex rate limits.", "codex"),
      }).pipe(Effect.map(mapCodexLimits));

      yield* Ref.update(stateRef, (currentState) => ({
        ...currentState,
        limits: {
          ...currentState.limits,
          codex: next,
        },
      }));
      yield* publish({
        type: "limitsUpdated",
        provider: "codex",
        limits: next.limits,
      });
      return next;
    }).pipe(
      Effect.catchTag("UsageDashboardError", (error) =>
        Ref.get(stateRef).pipe(
          Effect.map((state) => state.limits.codex),
          Effect.flatMap((current) =>
            current
              ? Effect.succeed({
                  ...current,
                  limits: staleWindows(current.limits, true),
                })
              : Effect.fail(error),
          ),
        ),
      ),
    );

  const readClaudeLimits = Effect.gen(function* () {
    const current = (yield* Ref.get(stateRef)).limits.claudeAgent;
    return {
      ...(current ?? {
        identity: toEmptyIdentity(),
        limits: [] as ReadonlyArray<ProviderRateWindow>,
        fetchedAt: null,
      }),
      limits: staleWindows(
        current?.limits ?? [],
        !isFresh(current?.fetchedAt ?? null, CLAUDE_LIMITS_STALE_MS),
      ),
    } satisfies LimitsCacheEntry;
  });

  const refreshClaudeLimits = (force: boolean) =>
    Effect.gen(function* () {
      const current = (yield* Ref.get(stateRef)).limits.claudeAgent;
      if (!force && current && isFresh(current.fetchedAt, CLAUDE_LIMITS_TTL_MS)) {
        return {
          ...current,
          limits: staleWindows(current.limits, false),
        } satisfies LimitsCacheEntry;
      }

      const next = yield* Effect.tryPromise({
        try: () => probeClaudeLimits(),
        catch: () => toUsageError("Failed to fetch Claude rate limits.", "claudeAgent"),
      }).pipe(Effect.map(mapClaudeLimits));

      yield* Ref.update(stateRef, (currentState) => ({
        ...currentState,
        limits: {
          ...currentState.limits,
          claudeAgent: next,
        },
      }));
      yield* publish({
        type: "limitsUpdated",
        provider: "claudeAgent",
        limits: next.limits,
      });
      return next;
    }).pipe(
      Effect.catchTag("UsageDashboardError", () =>
        readClaudeLimits.pipe(
          Effect.map((current) =>
            current.fetchedAt
              ? current
              : {
                  identity: current.identity,
                  limits: [] as ReadonlyArray<ProviderRateWindow>,
                  fetchedAt: null,
                },
          ),
        ),
      ),
    );

  const getDashboard = (range: UsageRange, force: boolean) =>
    Effect.gen(function* () {
      const now = new Date();
      const [codexHistorical, claudeHistorical, codexLimits, claudeLimits] = yield* Effect.all([
        readCodexHistoricalCache(force),
        readClaudeHistoricalCache(force),
        refreshCodexLimits(force),
        refreshClaudeLimits(force),
      ]);

      return {
        providers: [
          toProviderDashboard({
            provider: "codex",
            range,
            now,
            historical: codexHistorical,
            limits: codexLimits,
          }),
          toProviderDashboard({
            provider: "claudeAgent",
            range,
            now,
            historical: claudeHistorical,
            limits: claudeLimits,
          }),
        ],
        fetchedAt: now.toISOString(),
      } satisfies UsageDashboardSnapshot;
    });

  const updateLimitsFromRuntimeEvent = (event: ProviderRuntimeEvent) => {
    if (event.type !== "account.rate-limits.updated") {
      return Effect.void;
    }

    return Ref.updateAndGet(stateRef, (state) => {
      if (event.provider === "claudeAgent") {
        const current = state.limits.claudeAgent ?? {
          identity: toEmptyIdentity(),
          limits: [] as ReadonlyArray<ProviderRateWindow>,
          fetchedAt: null,
        };
        return {
          ...state,
          limits: {
            ...state.limits,
            claudeAgent: {
              ...current,
              limits: mergeClaudeRateLimits(current.limits, event.payload.rateLimits),
              fetchedAt: usageNow(),
            },
          },
        };
      }

      if (event.provider === "codex") {
        const current = state.limits.codex ?? {
          identity: toEmptyIdentity(),
          limits: [] as ReadonlyArray<ProviderRateWindow>,
          fetchedAt: null,
        };
        return {
          ...state,
          limits: {
            ...state.limits,
            codex: {
              ...current,
              limits: mergeCodexRateLimits(current.limits, event.payload.rateLimits),
              fetchedAt: usageNow(),
            },
          },
        };
      }

      return state;
    }).pipe(
      Effect.flatMap((state) => {
        const nextLimits =
          event.provider === "codex" ? state.limits.codex : state.limits.claudeAgent;
        if (!nextLimits) {
          return Effect.void;
        }
        return publish({
          type: "limitsUpdated",
          provider: event.provider,
          limits: nextLimits.limits,
        });
      }),
    );
  };

  yield* Stream.runForEach(providerService.streamEvents, updateLimitsFromRuntimeEvent).pipe(
    Effect.forkScoped,
  );

  return {
    getDashboard: (range) => getDashboard(range, false),
    refreshDashboard: (range) =>
      Effect.gen(function* () {
        const startedAt = usageNow();
        yield* setRefreshState(range, () => ({
          range,
          refreshing: true,
          lastStartedAt: startedAt,
          lastCompletedAt: null,
        }));

        const snapshot = yield* getDashboard(range, true);
        const completedAt = usageNow();

        yield* setRefreshState(range, (current) => ({
          ...current,
          refreshing: false,
          lastCompletedAt: completedAt,
        }));
        yield* publish({ type: "snapshot", snapshot });
        return snapshot;
      }),
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies UsageServiceShape;
});

export const UsageServiceLive = Layer.effect(UsageService, makeUsageService);
