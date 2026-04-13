import type {
  UsageDashboardError,
  UsageDashboardSnapshot,
  UsageRange,
  UsageStreamEvent,
} from "@capycode/contracts";
import { Context } from "effect";
import type { Effect, Stream } from "effect";

export interface UsageServiceShape {
  readonly getDashboard: (
    range: UsageRange,
  ) => Effect.Effect<UsageDashboardSnapshot, UsageDashboardError>;
  readonly refreshDashboard: (
    range: UsageRange,
  ) => Effect.Effect<UsageDashboardSnapshot, UsageDashboardError>;
  readonly streamChanges: Stream.Stream<UsageStreamEvent>;
}

export class UsageService extends Context.Service<UsageService, UsageServiceShape>()(
  "capycode/usage/Services/UsageService",
) {}
