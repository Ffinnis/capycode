import { useAtomValue } from "@effect/atom-react";
import type {
  UsageDashboardSnapshot,
  UsageRefreshState,
  UsageStreamEvent,
} from "@capycode/contracts";
import { Atom } from "effect/unstable/reactivity";
import type { QueryClient } from "@tanstack/react-query";

import { appAtomRegistry, resetAppAtomRegistryForTests } from "./atomRegistry";
import type { WsRpcClient } from "./wsRpcClient";

type UsageStateClient = Pick<WsRpcClient["usage"], "subscribe">;

function makeStateAtom<A>(label: string, initialValue: A) {
  return Atom.make(initialValue).pipe(Atom.keepAlive, Atom.withLabel(label));
}

export const usageSnapshotAtom = makeStateAtom<UsageDashboardSnapshot | null>(
  "usage-snapshot",
  null,
);
export const usageLastEventAtom = makeStateAtom<UsageStreamEvent | null>("usage-last-event", null);
export const usageRefreshStateAtom = makeStateAtom<Record<string, UsageRefreshState>>(
  "usage-refresh-state",
  {},
);

export function getUsageSnapshot(): UsageDashboardSnapshot | null {
  return appAtomRegistry.get(usageSnapshotAtom);
}

export function applyUsageEvent(event: UsageStreamEvent): void {
  appAtomRegistry.set(usageLastEventAtom, event);
  if (event.type === "snapshot") {
    appAtomRegistry.set(usageSnapshotAtom, event.snapshot);
    return;
  }

  if (event.type === "limitsUpdated") {
    const currentSnapshot = appAtomRegistry.get(usageSnapshotAtom);
    if (!currentSnapshot) {
      return;
    }

    appAtomRegistry.set(usageSnapshotAtom, {
      ...currentSnapshot,
      providers: currentSnapshot.providers.map((provider) =>
        provider.provider === event.provider
          ? {
              ...provider,
              limits:
                event.limits.length > 0 || provider.limits.length === 0
                  ? event.limits
                  : provider.limits,
              lastLimitsRefreshAt: new Date().toISOString(),
            }
          : provider,
      ),
    });
    return;
  }

  if (event.type === "historicalUpdated" && event.snapshot) {
    appAtomRegistry.set(usageSnapshotAtom, event.snapshot);
    return;
  }

  if (event.type === "refreshStateChanged") {
    appAtomRegistry.set(usageRefreshStateAtom, {
      ...appAtomRegistry.get(usageRefreshStateAtom),
      [event.state.range]: event.state,
    });
  }
}

export function startUsageStateSync(
  client: UsageStateClient,
  queryClient: QueryClient,
): () => void {
  return client.subscribe((event) => {
    applyUsageEvent(event);
    void queryClient.invalidateQueries({ queryKey: ["usage"] });
  });
}

export function resetUsageStateForTests() {
  resetAppAtomRegistryForTests();
}

export function useUsageSnapshot() {
  return useAtomValue(usageSnapshotAtom);
}
