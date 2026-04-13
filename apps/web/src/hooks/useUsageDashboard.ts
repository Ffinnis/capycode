import type {
  ProviderKind,
  ProviderUsageDashboard,
  UsageDashboardSnapshot,
  UsageRange,
} from "@capycode/contracts";
import { DEFAULT_USAGE_RANGE } from "@capycode/contracts";
import { useQuery } from "@tanstack/react-query";

import { ensureLocalApi } from "../localApi";

export function usageDashboardQueryKey(range: UsageRange = DEFAULT_USAGE_RANGE) {
  return ["usage", "dashboard", range] as const;
}

export function findProviderDashboard(
  snapshot: UsageDashboardSnapshot | undefined,
  provider: ProviderKind,
): ProviderUsageDashboard | null {
  return snapshot?.providers.find((entry) => entry.provider === provider) ?? null;
}

export function useUsageDashboard(range: UsageRange = DEFAULT_USAGE_RANGE, enabled = true) {
  return useQuery({
    queryKey: usageDashboardQueryKey(range),
    queryFn: () => ensureLocalApi().usage.getDashboard(range),
    staleTime: 5_000, // Reduced from 30s for faster real-time updates
    enabled,
  });
}
