import type {
  ProviderKind,
  ProviderRateWindow,
  ProviderUsageDashboard,
  UsageRange,
} from "@capycode/contracts";
import { DEFAULT_USAGE_RANGE } from "@capycode/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3Icon, RefreshCcwIcon } from "lucide-react";
import { startTransition, useMemo, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { useUsageDashboard, usageDashboardQueryKey } from "../../hooks/useUsageDashboard";
import { useUsageSnapshot } from "../../rpc/usageState";
import { getProviderBrandIcon } from "../providerBrandIcon";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsSection, useRelativeTimeTick } from "./settingsLayout";

const RANGE_OPTIONS: ReadonlyArray<{ label: string; value: UsageRange }> = [
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
  { label: "All", value: "all" },
];

const numberFormatter = new Intl.NumberFormat("en-US");

const providerMeta: Record<ProviderKind, { label: string }> = {
  codex: { label: "Codex" },
  claudeAgent: { label: "Claude" },
};

function formatInteger(value: number) {
  return numberFormatter.format(value);
}

function formatCompact(value: number) {
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(1).replace(/\.0$/, "")}T`;
  }
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return formatInteger(value);
}

function formatDateTime(value: string | null, nowMs: number): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMs = nowMs - date.getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 24 * 60 * 60_000) return `${Math.floor(diffMs / (60 * 60_000))}h ago`;
  return date.toLocaleString();
}

function limitTone(window: ProviderRateWindow | null) {
  const usedPercent = window?.usedPercent ?? 0;
  if (usedPercent >= 85) return "bg-destructive/80";
  if (usedPercent >= 60) return "bg-warning/80";
  return "bg-foreground/25";
}

function UsageLimitRow(props: { label: string; window: ProviderRateWindow | null }) {
  const usedPercent = Math.max(0, Math.min(100, props.window?.usedPercent ?? 0));

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs font-medium text-foreground">{props.label}</div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {props.window ? `${Math.round(usedPercent)}%` : "—"}
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-border/80">
        <div
          className={cn(
            "h-full rounded-full transition-[width,background-color] duration-300",
            limitTone(props.window),
          )}
          style={{ width: `${usedPercent}%` }}
        />
      </div>
      <div className="text-[11px] leading-tight text-muted-foreground">
        {props.window?.resetDescription ?? "Waiting for a live snapshot"}
      </div>
    </div>
  );
}

/** Attempt a smooth monotone-cubic spline through points; falls back to polyline. */
function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${points[0]!.x},${points[0]!.y} L${points[1]!.x},${points[1]!.y}`;
  }

  // Monotone cubic Hermite (Fritsch–Carlson)
  const n = points.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]!.x - points[i]!.x);
    dy.push(points[i + 1]!.y - points[i]!.y);
    m.push(dy[i]! / dx[i]!);
  }

  const tangents: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1]! * m[i]! <= 0) {
      tangents.push(0);
    } else {
      tangents.push((m[i - 1]! + m[i]!) / 2);
    }
  }
  tangents.push(m[n - 2]!);

  // Ensure monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]!) < 1e-6) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const alpha = tangents[i]! / m[i]!;
      const beta = tangents[i + 1]! / m[i]!;
      const s = alpha * alpha + beta * beta;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        tangents[i] = tau * alpha * m[i]!;
        tangents[i + 1] = tau * beta * m[i]!;
      }
    }
  }

  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 0; i < n - 1; i++) {
    const seg = dx[i]! / 3;
    const cp1x = points[i]!.x + seg;
    const cp1y = points[i]!.y + tangents[i]! * seg;
    const cp2x = points[i + 1]!.x - seg;
    const cp2y = points[i + 1]!.y - tangents[i + 1]! * seg;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${points[i + 1]!.x},${points[i + 1]!.y}`;
  }
  return d;
}

function UsageLineChart(props: { buckets: ProviderUsageDashboard["buckets"]; range: string }) {
  const { buckets } = props;
  if (buckets.length === 0) return null;

  const maxTokens = Math.max(...buckets.map((b) => b.totals.totalTokens), 1);
  const width = 560;
  const height = 140;
  const padX = 40;
  const padTop = 8;
  const padBottom = 20;
  const chartW = width - padX;
  const chartH = height - padTop - padBottom;

  const points = buckets.map((bucket, i) => ({
    x: padX + (i / Math.max(buckets.length - 1, 1)) * chartW,
    y: padTop + chartH - (bucket.totals.totalTokens / maxTokens) * chartH,
    label: bucket.label,
    tokens: bucket.totals.totalTokens,
  }));

  const linePath = smoothPath(points);
  const areaPath = linePath
    ? `${linePath} L${points[points.length - 1]!.x},${padTop + chartH} L${points[0]!.x},${padTop + chartH} Z`
    : "";

  // Y-axis ticks (3 lines)
  const yTicks = [0, 0.5, 1].map((frac) => ({
    y: padTop + chartH - frac * chartH,
    label: formatCompact(Math.round(frac * maxTokens)),
  }));

  // X-axis labels (show ~5 evenly spaced)
  const labelStep = Math.max(1, Math.floor(buckets.length / 5));
  const xLabels = points.filter((_, i) => i % labelStep === 0 || i === points.length - 1);

  const [hover, setHover] = useState<number | null>(null);

  // Tooltip positioning: flip to left side when point is in right half of chart
  const hoverPt = hover !== null ? points[hover] : null;
  const tooltipW = 110;
  const tooltipH = 34;
  const tooltipGap = 8;
  let tooltipX = 0;
  let tooltipY = 0;
  if (hoverPt) {
    const flipsLeft = hoverPt.x + tooltipGap + tooltipW > width;
    tooltipX = flipsLeft ? hoverPt.x - tooltipGap - tooltipW : hoverPt.x + tooltipGap;
    tooltipY = Math.max(padTop, Math.min(hoverPt.y - tooltipH / 2, padTop + chartH - tooltipH));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          Usage over time
        </div>
        <div className="text-[11px] text-muted-foreground/70">
          {buckets.length} periods ·{" "}
          {props.range === "all" ? "all time" : props.range.toUpperCase()}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
      >
        {/* Grid lines */}
        {yTicks.map((tick) => (
          <g key={tick.label}>
            <line
              x1={padX}
              y1={tick.y}
              x2={width}
              y2={tick.y}
              className="stroke-border/40"
              strokeWidth={0.5}
            />
            <text
              x={padX - 6}
              y={tick.y + 3}
              textAnchor="end"
              className="fill-muted-foreground/60 text-[8px]"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* Area fill */}
        {areaPath ? <path d={areaPath} className="fill-foreground/[0.04]" /> : null}

        {/* Line */}
        {linePath ? (
          <path
            d={linePath}
            fill="none"
            className="stroke-foreground/30"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {/* X-axis labels */}
        {xLabels.map((pt) => (
          <text
            key={pt.label}
            x={pt.x}
            y={height - 4}
            textAnchor="middle"
            className="fill-muted-foreground/60 text-[8px]"
          >
            {pt.label}
          </text>
        ))}

        {/* Hover targets */}
        {points.map((pt, i) => (
          <g key={pt.label} onMouseEnter={() => setHover(i)}>
            <rect
              x={pt.x - chartW / points.length / 2}
              y={padTop}
              width={chartW / points.length}
              height={chartH}
              fill="transparent"
            />
          </g>
        ))}

        {/* Hover indicator + inline tooltip */}
        {hoverPt ? (
          <g>
            <line
              x1={hoverPt.x}
              y1={padTop}
              x2={hoverPt.x}
              y2={padTop + chartH}
              className="stroke-border"
              strokeWidth={0.5}
              strokeDasharray="3,3"
            />
            <circle cx={hoverPt.x} cy={hoverPt.y} r={3} className="fill-foreground/50" />

            {/* Tooltip bubble */}
            <rect
              x={tooltipX}
              y={tooltipY}
              width={tooltipW}
              height={tooltipH}
              rx={5}
              className="fill-foreground/90"
            />
            <text
              x={tooltipX + 8}
              y={tooltipY + 13}
              className="fill-background text-[7px] font-medium"
            >
              {hoverPt.label}
            </text>
            <text
              x={tooltipX + 8}
              y={tooltipY + 26}
              className="fill-background text-[8px] font-semibold"
            >
              {formatCompact(hoverPt.tokens)} tokens
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function UsageProviderSection(props: {
  provider: ProviderUsageDashboard;
  nowMs: number;
  onOpenConnections: () => void;
}) {
  const meta = providerMeta[props.provider.provider];
  const ProviderIcon = getProviderBrandIcon(props.provider.provider);
  const topModel = props.provider.topModels[0] ?? null;
  const latestSession = props.provider.sessions[0] ?? null;
  const rollingWindow =
    props.provider.limits.find((window) => window.kind === "rolling-5h") ?? null;
  const weeklyWindow = props.provider.limits.find((window) => window.kind === "weekly") ?? null;

  return (
    <SettingsSection
      title={meta.label}
      icon={<ProviderIcon className="size-3.5" />}
      headerAction={
        <span className="text-[11px] text-muted-foreground/70">
          {props.provider.identity.accountLabel ?? "Local logs"}
          {" · "}
          updated {formatDateTime(props.provider.lastHistoricalRefreshAt, props.nowMs)}
        </span>
      }
    >
      <div className="space-y-6 p-4 sm:p-5">
        {/* Limits */}
        <div className="grid gap-4 lg:grid-cols-2">
          <UsageLimitRow label="5h limit" window={rollingWindow} />
          <UsageLimitRow label="Weekly limit" window={weeklyWindow} />
        </div>

        {/* Summary stats */}
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {[
            { label: "Total tokens", value: formatCompact(props.provider.totals.totalTokens) },
            { label: "Sessions", value: formatInteger(props.provider.totals.sessionCount) },
            { label: "Top model", value: topModel?.model ?? "—" },
            {
              label: "Last session",
              value: latestSession ? formatDateTime(latestSession.startedAt, props.nowMs) : "—",
            },
          ].map((item) => (
            <div key={item.label}>
              <div className="text-[11px] text-muted-foreground">{item.label}</div>
              <div className="text-sm font-medium text-foreground">{item.value}</div>
            </div>
          ))}
        </div>

        {/* Line chart */}
        <UsageLineChart buckets={props.provider.buckets} range={props.provider.range} />

        {/* Model breakdown */}
        {props.provider.topModels.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Models
            </div>
            <div className="divide-y divide-border/40">
              {props.provider.topModels.map((model) => (
                <div
                  key={model.model}
                  className="flex items-baseline justify-between gap-4 py-2 text-sm"
                >
                  <div className="min-w-0 truncate font-medium text-foreground">{model.model}</div>
                  <div className="flex shrink-0 items-baseline gap-3 text-xs text-muted-foreground">
                    <span>{formatInteger(model.sessionCount)} sessions</span>
                    <span className="tabular-nums text-foreground">
                      {formatCompact(model.totals.totalTokens)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No usage logs found.{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-4"
              onClick={props.onOpenConnections}
            >
              Check connections
            </button>
          </div>
        )}

        {/* Recent sessions */}
        {props.provider.sessions.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Recent sessions
            </div>
            <div className="divide-y divide-border/40">
              {props.provider.sessions.map((session) => (
                <div key={session.id} className="py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-medium text-foreground">
                      {session.projectPath ?? session.id}
                    </div>
                    <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatCompact(session.totals.totalTokens)}
                    </div>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
                    <span className="truncate">{session.models.join(", ") || "Unknown model"}</span>
                    <span className="shrink-0">
                      {formatDateTime(session.startedAt, props.nowMs)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Warnings */}
        {props.provider.warnings.length > 0 ? (
          <div className="text-sm text-warning">
            {props.provider.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

export function UsageSettingsPanel() {
  const [range, setRange] = useState<UsageRange>(DEFAULT_USAGE_RANGE);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const nowMs = useRelativeTimeTick(60_000);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const usageQuery = useUsageDashboard(range, true);
  const realtimeSnapshot = useUsageSnapshot();

  const providers = useMemo(
    () => {
      // Use real-time snapshot if available, fall back to query data
      const snapshot = realtimeSnapshot || usageQuery.data;
      return (snapshot?.providers ?? []).toSorted((left, right) =>
        left.provider === right.provider ? 0 : left.provider === "codex" ? -1 : 1,
      );
    },
    [realtimeSnapshot, usageQuery.data],
  );

  const refreshDashboard = () => {
    setIsRefreshing(true);
    startTransition(() => {
      void ensureLocalApi()
        .usage.refreshDashboard(range)
        .then((snapshot) => {
          queryClient.setQueryData(usageDashboardQueryKey(range), snapshot);
        })
        .finally(() => setIsRefreshing(false));
    });
  };

  return (
    <SettingsPageContainer>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Usage</h1>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Token usage and rate limits across providers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full border border-border/70 bg-background/70 p-1">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    range === option.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setRange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <Button size="sm" variant="outline" onClick={refreshDashboard} disabled={isRefreshing}>
              <RefreshCcwIcon className={cn("size-4", isRefreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {usageQuery.isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading usage…</div>
        ) : null}

        {usageQuery.isError ? (
          <div className="py-6 text-sm text-destructive">Failed to load usage data.</div>
        ) : null}

        {providers.map((provider) => (
          <UsageProviderSection
            key={provider.provider}
            provider={provider}
            nowMs={nowMs}
            onOpenConnections={() => void navigate({ to: "/settings/connections" })}
          />
        ))}

        {!usageQuery.isLoading && providers.length === 0 ? (
          <SettingsSection title="No usage data" icon={<BarChart3Icon className="size-3.5" />}>
            <div className="p-5 text-sm text-muted-foreground">
              No usage snapshot is available yet. Start a provider session, then refresh this page.
            </div>
          </SettingsSection>
        ) : null}
      </div>
    </SettingsPageContainer>
  );
}
