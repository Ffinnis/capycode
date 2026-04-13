import type { ProviderRateWindow, UsageWindowKind } from "@capycode/contracts";

interface RawRateWindow {
  readonly usedPercent: number;
  readonly windowMinutes: number;
  readonly resetsAt: string | null;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function toIsoDateTime(value: unknown): string | null {
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function formatResetDescription(resetsAt: string | null, now: Date): string | null {
  if (!resetsAt) return null;
  const target = new Date(resetsAt);
  if (Number.isNaN(target.getTime())) return null;

  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    return "Resetting now";
  }

  const totalMinutes = Math.ceil(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: Array<string> = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0 && minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? `Resets in ${parts.join(" ")}` : "Reseting soon";
}

function classifyWindowKind(windowMinutes: number): UsageWindowKind | null {
  if (windowMinutes === 300) return "rolling-5h";
  if (windowMinutes === 10_080) return "weekly";
  return null;
}

function toProviderRateWindow(
  raw: RawRateWindow,
  input: {
    readonly kind: UsageWindowKind;
    readonly source: ProviderRateWindow["source"];
    readonly stale: boolean;
    readonly now: Date;
  },
): ProviderRateWindow {
  const usedPercent = clampPercent(raw.usedPercent);
  return {
    kind: input.kind,
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    windowMinutes: raw.windowMinutes,
    resetsAt: raw.resetsAt,
    resetDescription: formatResetDescription(raw.resetsAt, input.now),
    source: input.source,
    stale: input.stale,
  };
}

function readCodexRawWindow(value: unknown): RawRateWindow | null {
  const record = asObject(value);
  if (!record) return null;

  const usedPercent =
    asNumber(record.usedPercent) ?? asNumber(record.used_percent) ?? asNumber(record.utilization);
  const windowMinutes =
    asNumber(record.windowDurationMins) ??
    asNumber(record.window_minutes) ??
    asNumber(record.windowMinutes) ??
    ((asNumber(record.limitWindowSeconds) ?? asNumber(record.limit_window_seconds)) !== undefined
      ? (asNumber(record.limitWindowSeconds) ?? asNumber(record.limit_window_seconds))! / 60
      : undefined);
  const resetsAt = toIsoDateTime(
    record.resetsAt ?? record.resets_at ?? record.resetAt ?? record.reset_at,
  );

  if (usedPercent === undefined || windowMinutes === undefined) {
    return null;
  }

  return {
    usedPercent,
    windowMinutes,
    resetsAt,
  };
}

export function normalizeCodexRateWindows(
  payload: unknown,
  input: {
    readonly stale: boolean;
    readonly now?: Date;
    readonly source?: ProviderRateWindow["source"];
  } = { stale: false },
): ReadonlyArray<ProviderRateWindow> {
  const now = input.now ?? new Date();
  const record = asObject(payload);
  const rateLimits = asObject(record?.rateLimits) ?? asObject(record?.rate_limit) ?? record;
  const rawWindows = [
    rateLimits?.primary,
    rateLimits?.secondary,
    rateLimits?.primary_window,
    rateLimits?.secondary_window,
  ]
    .map(readCodexRawWindow)
    .filter((value): value is RawRateWindow => value !== null);
  const windowsByKind = new Map<UsageWindowKind, ProviderRateWindow>();

  for (const rawWindow of rawWindows) {
    const kind = classifyWindowKind(rawWindow.windowMinutes);
    if (!kind) continue;
    windowsByKind.set(
      kind,
      toProviderRateWindow(rawWindow, {
        kind,
        source: input.source ?? "codex-app-server",
        stale: input.stale,
        now,
      }),
    );
  }

  return Array.from(windowsByKind.values()).toSorted(
    (left, right) => left.windowMinutes - right.windowMinutes,
  );
}

function readClaudeUsedPercent(value: unknown): number | undefined {
  const utilization = asNumber(value);
  if (utilization === undefined) {
    return undefined;
  }
  return utilization <= 1 ? utilization * 100 : utilization;
}

function normalizeClaudeRuntimeWindow(
  value: unknown,
  input: {
    readonly stale: boolean;
    readonly now: Date;
    readonly source: ProviderRateWindow["source"];
  },
): ProviderRateWindow | null {
  const rateLimitInfo = asObject(value);
  if (!rateLimitInfo) return null;

  const rateLimitType = asString(rateLimitInfo.rateLimitType ?? rateLimitInfo.rate_limit_type);
  const kind =
    rateLimitType === "five_hour"
      ? "rolling-5h"
      : rateLimitType === "seven_day" ||
          rateLimitType === "seven_day_oauth_apps" ||
          rateLimitType === "seven_day_opus" ||
          rateLimitType === "seven_day_sonnet"
        ? "weekly"
        : null;

  if (!kind) return null;

  const usedPercent = readClaudeUsedPercent(rateLimitInfo.utilization);
  if (usedPercent === undefined) return null;

  return toProviderRateWindow(
    {
      usedPercent,
      windowMinutes: kind === "rolling-5h" ? 300 : 10_080,
      resetsAt: toIsoDateTime(rateLimitInfo.resetsAt ?? rateLimitInfo.resets_at),
    },
    {
      kind,
      source: input.source,
      stale: input.stale,
      now: input.now,
    },
  );
}

function normalizeClaudeSnapshotWindow(
  value: unknown,
  input: {
    readonly kind: UsageWindowKind;
    readonly stale: boolean;
    readonly now: Date;
    readonly source: ProviderRateWindow["source"];
  },
): ProviderRateWindow | null {
  const record = asObject(value);
  if (!record) return null;

  const usedPercent = readClaudeUsedPercent(record.utilization ?? record.used_percentage);
  if (usedPercent === undefined) return null;

  return toProviderRateWindow(
    {
      usedPercent,
      windowMinutes: input.kind === "rolling-5h" ? 300 : 10_080,
      resetsAt: toIsoDateTime(record.resetsAt ?? record.resets_at),
    },
    {
      kind: input.kind,
      source: input.source,
      stale: input.stale,
      now: input.now,
    },
  );
}

export function normalizeClaudeRateWindows(
  payload: unknown,
  input: {
    readonly stale: boolean;
    readonly now?: Date;
    readonly source?: ProviderRateWindow["source"];
  } = { stale: false },
): ReadonlyArray<ProviderRateWindow> {
  const now = input.now ?? new Date();
  const source = input.source ?? "claude-runtime";
  const record = asObject(payload);
  if (!record) return [];

  const runtimeWindow = normalizeClaudeRuntimeWindow(asObject(record.rate_limit_info) ?? record, {
    stale: input.stale,
    now,
    source,
  });
  if (runtimeWindow) {
    return [runtimeWindow];
  }

  const windowsByKind = new Map<UsageWindowKind, ProviderRateWindow>();
  const fiveHour = normalizeClaudeSnapshotWindow(record.five_hour, {
    kind: "rolling-5h",
    stale: input.stale,
    now,
    source,
  });
  if (fiveHour) {
    windowsByKind.set(fiveHour.kind, fiveHour);
  }

  for (const weeklyKey of [
    "seven_day",
    "seven_day_oauth_apps",
    "seven_day_sonnet",
    "seven_day_opus",
  ] as const) {
    const weeklyWindow = normalizeClaudeSnapshotWindow(record[weeklyKey], {
      kind: "weekly",
      stale: input.stale,
      now,
      source,
    });
    if (weeklyWindow) {
      windowsByKind.set(weeklyWindow.kind, weeklyWindow);
      break;
    }
  }

  return Array.from(windowsByKind.values()).toSorted(
    (left, right) => left.windowMinutes - right.windowMinutes,
  );
}

export function normalizeClaudeRateLimitWindow(
  payload: unknown,
  input: {
    readonly stale: boolean;
    readonly now?: Date;
    readonly source?: ProviderRateWindow["source"];
  } = { stale: false },
): ProviderRateWindow | null {
  return normalizeClaudeRateWindows(payload, input)[0] ?? null;
}
