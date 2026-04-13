import type {
  GitStatusLocalResult,
  GitStatusRemoteResult,
  GitStatusStreamEvent,
  UsageDashboardSnapshot,
  UsageStreamEvent,
} from "@capycode/contracts";
import { WS_METHODS } from "@capycode/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("./wsTransport", () => ({
  WsTransport: class WsTransport {
    dispose = vi.fn(async () => undefined);
    reconnect = vi.fn(async () => undefined);
    request = vi.fn();
    requestStream = vi.fn();
    subscribe = vi.fn(() => () => undefined);
  },
}));

import { createWsRpcClient } from "./wsRpcClient";
import { type WsTransport } from "./wsTransport";

const baseLocalStatus: GitStatusLocalResult = {
  isRepo: true,
  hasOriginRemote: true,
  isDefaultBranch: false,
  branch: "feature/demo",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

const baseRemoteStatus: GitStatusRemoteResult = {
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

describe("wsRpcClient", () => {
  it("reduces git status stream events into flat status snapshots", () => {
    const subscribe = vi.fn(<TValue>(_connect: unknown, listener: (value: TValue) => void) => {
      for (const event of [
        {
          _tag: "snapshot",
          local: baseLocalStatus,
          remote: null,
        },
        {
          _tag: "remoteUpdated",
          remote: baseRemoteStatus,
        },
        {
          _tag: "localUpdated",
          local: {
            ...baseLocalStatus,
            hasWorkingTreeChanges: true,
          },
        },
      ] satisfies GitStatusStreamEvent[]) {
        listener(event as TValue);
      }
      return () => undefined;
    });

    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: vi.fn(),
      requestStream: vi.fn(),
      subscribe,
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);
    const listener = vi.fn();

    client.git.onStatus({ cwd: "/repo" }, listener);

    expect(listener.mock.calls).toEqual([
      [
        {
          ...baseLocalStatus,
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
          hasWorkingTreeChanges: true,
        },
      ],
    ]);
  });

  it("sends usage RPCs with the expected range payloads", async () => {
    const snapshot: UsageDashboardSnapshot = {
      providers: [],
      fetchedAt: "2026-04-12T00:00:00.000Z",
    };
    const request = vi.fn(
      (resolver: (client: Record<string, (input: unknown) => unknown>) => unknown) =>
        Promise.resolve(
          resolver({
            [WS_METHODS.usageGetDashboard]: (input: unknown) => input,
            [WS_METHODS.usageRefreshDashboard]: (_input: unknown) => snapshot,
          }),
        ),
    );

    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: request as unknown as WsTransport["request"],
      requestStream: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);

    await expect(client.usage.getDashboard()).resolves.toEqual({ range: "30d" });
    await expect(client.usage.refreshDashboard("7d")).resolves.toEqual(snapshot);
  });

  it("forwards usage subscriptions through the transport", () => {
    const subscribe = vi.fn(<TValue>(_connect: unknown, listener: (value: TValue) => void) => {
      listener({
        type: "snapshot",
        snapshot: {
          providers: [],
          fetchedAt: "2026-04-12T00:00:00.000Z",
        },
      } as TValue);
      return () => undefined;
    });

    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: vi.fn(),
      requestStream: vi.fn(),
      subscribe,
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);
    const listener = vi.fn<(event: UsageStreamEvent) => void>();

    client.usage.subscribe(listener);

    expect(subscribe).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      type: "snapshot",
      snapshot: {
        providers: [],
        fetchedAt: "2026-04-12T00:00:00.000Z",
      },
    });
  });
});
