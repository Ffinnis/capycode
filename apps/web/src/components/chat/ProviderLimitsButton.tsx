import type { ProviderKind, ProviderRateWindow, ProviderUsageDashboard } from "@capycode/contracts";
import { DEFAULT_USAGE_RANGE } from "@capycode/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon, BotIcon, FeatherIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ensureLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { usageDashboardQueryKey } from "../../hooks/useUsageDashboard";
import { useProviderLimits } from "../../hooks/useProviderLimits";
import { useUsageSnapshot } from "../../rpc/usageState";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

const providerIcon: Record<ProviderKind, typeof BotIcon> = {
  codex: BotIcon,
  claudeAgent: FeatherIcon,
};

function primaryWindow(provider: ProviderUsageDashboard | null) {
  if (!provider) return null;
  return (
    provider.limits.find((window) => window.kind === "rolling-5h") ??
    provider.limits.find((window) => window.kind === "weekly") ??
    null
  );
}

function isFresh(provider: ProviderUsageDashboard | null) {
  return Boolean(provider && provider.limits.some((window) => !window.stale));
}

function limitTone(window: ProviderRateWindow | null) {
  const used = window?.usedPercent ?? 0;
  if (used >= 85) return "bg-destructive/80";
  if (used >= 60) return "bg-warning/80";
  return "bg-foreground/25";
}

function LimitRow(props: { label: string; window: ProviderRateWindow | null }) {
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
          className={cn("h-full rounded-full transition-[width,background-color] duration-300", limitTone(props.window))}
          style={{ width: `${usedPercent}%` }}
        />
      </div>
      <div className="text-[11px] leading-tight text-muted-foreground">
        {props.window?.resetDescription ?? "Waiting for a live snapshot"}
      </div>
    </div>
  );
}

export function ProviderLimitsButton(props: { provider: ProviderKind }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const snapshot = useUsageSnapshot();
  const providerFromSnapshot = useMemo(
    () => snapshot?.providers.find((entry) => entry.provider === props.provider) ?? null,
    [props.provider, snapshot],
  );
  const [open, setOpen] = useState(false);
  const providerQuery = useProviderLimits(props.provider, { enabled: open, range: DEFAULT_USAGE_RANGE });
  const provider = providerQuery.provider ?? providerFromSnapshot;
  const primaryLimitWindow = primaryWindow(provider);
  const Icon = providerIcon[props.provider];

  useEffect(() => {
    if (!open || props.provider !== "codex") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void ensureLocalApi()
        .usage.refreshDashboard(DEFAULT_USAGE_RANGE)
        .then((nextSnapshot) => {
          queryClient.setQueryData(usageDashboardQueryKey(DEFAULT_USAGE_RANGE), nextSnapshot);
        });
    }, 30_000);

    return () => globalThis.window.clearInterval(intervalId);
  }, [open, props.provider, queryClient]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
              isFresh(provider)
                ? "border-border/70 bg-background/75 text-foreground hover:border-border"
                : "border-border/50 bg-background/60 text-muted-foreground hover:text-foreground",
            )}
            aria-label={`${props.provider} limits`}
          >
            <Icon className="size-3.5" />
            {isFresh(provider) && primaryLimitWindow ? (
              <span>{Math.round(primaryLimitWindow.remainingPercent)}% left</span>
            ) : (
              <span>Limits</span>
            )}
            {!isFresh(provider) ? <AlertTriangleIcon className="size-3.5 opacity-70" /> : null}
          </button>
        }
      />
      <PopoverPopup side="top" align="end" className="w-[280px] px-0 py-0">
        <div className="px-3 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {props.provider === "codex" ? "Codex" : "Claude"} limits
            </div>
            <div className="text-[11px] text-muted-foreground/70">
              {provider?.lastLimitsRefreshAt
                ? new Date(provider.lastLimitsRefreshAt).toLocaleTimeString()
                : "No snapshot"}
            </div>
          </div>

          <div className="mt-3 space-y-3">
            <LimitRow
              label="5h limit"
              window={provider?.limits.find((entry) => entry.kind === "rolling-5h") ?? null}
            />
            <LimitRow
              label="Weekly limit"
              window={provider?.limits.find((entry) => entry.kind === "weekly") ?? null}
            />
          </div>

          <div className="mt-3 border-t border-border/50 pt-2">
            <button
              type="button"
              className="w-full rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setOpen(false);
                void navigate({ to: "/settings/usage" });
              }}
            >
              Open Usage
            </button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
