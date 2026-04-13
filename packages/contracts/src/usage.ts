import { Effect, Schema } from "effect";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const UsageRange = Schema.Literals(["7d", "30d", "90d", "all"]);
export type UsageRange = typeof UsageRange.Type;
export const DEFAULT_USAGE_RANGE: UsageRange = "30d";

export const UsageWindowKind = Schema.Literals(["rolling-5h", "weekly"]);
export type UsageWindowKind = typeof UsageWindowKind.Type;

export const ProviderRateWindowSource = Schema.Literals([
  "codex-app-server",
  "claude-runtime",
  "claude-oauth-api",
]);
export type ProviderRateWindowSource = typeof ProviderRateWindowSource.Type;

export const ProviderRateWindow = Schema.Struct({
  kind: UsageWindowKind,
  usedPercent: Schema.Number,
  remainingPercent: Schema.Number,
  windowMinutes: PositiveInt,
  resetsAt: Schema.NullOr(IsoDateTime),
  resetDescription: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  source: ProviderRateWindowSource,
  stale: Schema.Boolean,
});
export type ProviderRateWindow = typeof ProviderRateWindow.Type;

export const UsageTotals = Schema.Struct({
  inputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningOutputTokens: NonNegativeInt,
  totalTokens: NonNegativeInt,
  sessionCount: NonNegativeInt,
});
export type UsageTotals = typeof UsageTotals.Type;

export const EMPTY_USAGE_TOTALS: UsageTotals = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
  sessionCount: 0,
};

export const UsageFallbackPricing = Schema.Struct({
  inputPerMillionUsd: Schema.Number,
  outputPerMillionUsd: Schema.Number,
});
export type UsageFallbackPricing = typeof UsageFallbackPricing.Type;

export const UsageModelSummary = Schema.Struct({
  model: TrimmedNonEmptyString,
  totals: UsageTotals,
  sessionCount: NonNegativeInt,
  lastSeenAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  fallbackPricing: Schema.NullOr(UsageFallbackPricing).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type UsageModelSummary = typeof UsageModelSummary.Type;

export const UsageBucket = Schema.Struct({
  bucketStart: IsoDateTime,
  bucketEnd: IsoDateTime,
  label: TrimmedNonEmptyString,
  totals: UsageTotals,
  modelCounts: Schema.Record(Schema.String, NonNegativeInt),
});
export type UsageBucket = typeof UsageBucket.Type;

export const UsageSessionSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  startedAt: IsoDateTime,
  endedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  provider: ProviderKind,
  models: Schema.Array(TrimmedNonEmptyString),
  totals: UsageTotals,
  projectPath: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type UsageSessionSummary = typeof UsageSessionSummary.Type;

export const ProviderUsageIdentity = Schema.Struct({
  accountLabel: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  authLabel: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type ProviderUsageIdentity = typeof ProviderUsageIdentity.Type;

export const ProviderUsageDashboard = Schema.Struct({
  provider: ProviderKind,
  identity: ProviderUsageIdentity,
  limits: Schema.Array(ProviderRateWindow),
  range: UsageRange,
  totals: UsageTotals,
  topModels: Schema.Array(UsageModelSummary),
  buckets: Schema.Array(UsageBucket),
  sessions: Schema.Array(UsageSessionSummary),
  lastHistoricalRefreshAt: Schema.NullOr(IsoDateTime).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  lastLimitsRefreshAt: Schema.NullOr(IsoDateTime).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  warnings: Schema.Array(TrimmedNonEmptyString),
});
export type ProviderUsageDashboard = typeof ProviderUsageDashboard.Type;

export const UsageDashboardSnapshot = Schema.Struct({
  providers: Schema.Array(ProviderUsageDashboard),
  fetchedAt: IsoDateTime,
});
export type UsageDashboardSnapshot = typeof UsageDashboardSnapshot.Type;

export const UsageRefreshState = Schema.Struct({
  range: UsageRange,
  refreshing: Schema.Boolean,
  lastStartedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  lastCompletedAt: Schema.NullOr(IsoDateTime).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type UsageRefreshState = typeof UsageRefreshState.Type;

export const UsageSnapshotStreamEvent = Schema.Struct({
  type: Schema.Literal("snapshot"),
  snapshot: UsageDashboardSnapshot,
});
export type UsageSnapshotStreamEvent = typeof UsageSnapshotStreamEvent.Type;

export const UsageLimitsUpdatedStreamEvent = Schema.Struct({
  type: Schema.Literal("limitsUpdated"),
  provider: ProviderKind,
  limits: Schema.Array(ProviderRateWindow),
  snapshot: Schema.optional(UsageDashboardSnapshot),
});
export type UsageLimitsUpdatedStreamEvent = typeof UsageLimitsUpdatedStreamEvent.Type;

export const UsageHistoricalUpdatedStreamEvent = Schema.Struct({
  type: Schema.Literal("historicalUpdated"),
  provider: ProviderKind,
  range: UsageRange,
  snapshot: Schema.optional(UsageDashboardSnapshot),
});
export type UsageHistoricalUpdatedStreamEvent = typeof UsageHistoricalUpdatedStreamEvent.Type;

export const UsageRefreshStateChangedStreamEvent = Schema.Struct({
  type: Schema.Literal("refreshStateChanged"),
  state: UsageRefreshState,
});
export type UsageRefreshStateChangedStreamEvent = typeof UsageRefreshStateChangedStreamEvent.Type;

export const UsageStreamEvent = Schema.Union([
  UsageSnapshotStreamEvent,
  UsageLimitsUpdatedStreamEvent,
  UsageHistoricalUpdatedStreamEvent,
  UsageRefreshStateChangedStreamEvent,
]);
export type UsageStreamEvent = typeof UsageStreamEvent.Type;

export const UsageDashboardRequest = Schema.Struct({
  range: UsageRange.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_USAGE_RANGE))),
});
export type UsageDashboardRequest = typeof UsageDashboardRequest.Type;

export class UsageDashboardError extends Schema.TaggedErrorClass<UsageDashboardError>()(
  "UsageDashboardError",
  {
    detail: TrimmedNonEmptyString,
    provider: Schema.optional(ProviderKind),
  },
) {}
