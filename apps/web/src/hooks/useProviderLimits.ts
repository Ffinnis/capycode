import type { ProviderKind, UsageRange } from "@capycode/contracts";
import { DEFAULT_USAGE_RANGE } from "@capycode/contracts";

import { findProviderDashboard, useUsageDashboard } from "./useUsageDashboard";

export function useProviderLimits(
  provider: ProviderKind,
  options?: {
    enabled?: boolean;
    range?: UsageRange;
  },
) {
  const range = options?.range ?? DEFAULT_USAGE_RANGE;
  const query = useUsageDashboard(range, options?.enabled ?? true);
  return {
    ...query,
    provider: findProviderDashboard(query.data, provider),
  };
}
