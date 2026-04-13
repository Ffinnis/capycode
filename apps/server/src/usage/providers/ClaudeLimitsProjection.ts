import type { ProviderRateWindow } from "@capycode/contracts";
import { normalizeClaudeRateWindows } from "../normalize/rateWindows";

export function mergeClaudeRateLimits(
  currentLimits: ReadonlyArray<ProviderRateWindow>,
  payload: unknown,
): ReadonlyArray<ProviderRateWindow> {
  const nextWindows = normalizeClaudeRateWindows(payload);
  if (nextWindows.length === 0) {
    return currentLimits;
  }

  const windowsByKind = new Map(currentLimits.map((window) => [window.kind, window] as const));
  for (const nextWindow of nextWindows) {
    windowsByKind.set(nextWindow.kind, nextWindow);
  }
  return Array.from(windowsByKind.values()).sort((left, right) =>
    left.windowMinutes - right.windowMinutes,
  );
}
