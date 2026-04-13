import { EnvironmentId, type ServerConfig } from "@capycode/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveRemotePairingTarget = vi.hoisted(() => vi.fn());
const mockFetchRemoteEnvironmentDescriptor = vi.hoisted(() => vi.fn());
const mockBootstrapRemoteBearerSession = vi.hoisted(() => vi.fn());
const mockFetchRemoteSessionState = vi.hoisted(() => vi.fn());
const mockCreateEnvironmentConnection = vi.hoisted(() => vi.fn());
const mockCreateWsRpcClient = vi.hoisted(() => vi.fn());
const mockPersistSavedEnvironmentRecord = vi.hoisted(() => vi.fn());
const mockWriteSavedEnvironmentBearerToken = vi.hoisted(() => vi.fn());
const mockReadSavedEnvironmentBearerToken = vi.hoisted(() => vi.fn());
const mockRemoveSavedEnvironmentBearerToken = vi.hoisted(() => vi.fn());
const mockRegistryUpsert = vi.hoisted(() => vi.fn());
const mockRegistryRemove = vi.hoisted(() => vi.fn());
const mockRegistryMarkConnected = vi.hoisted(() => vi.fn());
const mockRuntimeEnsure = vi.hoisted(() => vi.fn());
const mockRuntimePatch = vi.hoisted(() => vi.fn());
const mockRuntimeClear = vi.hoisted(() => vi.fn());

function MockWsTransport(..._args: ReadonlyArray<unknown>) {}

const savedEnvironmentState = vi.hoisted(
  () =>
    ({
      byId: {} as Record<string, any>,
    }) as {
      byId: Record<string, any>;
    },
);

const connectionState = vi.hoisted(
  () =>
    new Map<
      string,
      {
        reconnect: ReturnType<typeof vi.fn>;
        dispose: ReturnType<typeof vi.fn>;
        connection: any;
      }
    >(),
);

vi.mock("../remote/target", () => ({
  resolveRemotePairingTarget: mockResolveRemotePairingTarget,
}));

vi.mock("../remote/api", () => ({
  bootstrapRemoteBearerSession: mockBootstrapRemoteBearerSession,
  fetchRemoteEnvironmentDescriptor: mockFetchRemoteEnvironmentDescriptor,
  fetchRemoteSessionState: mockFetchRemoteSessionState,
  resolveRemoteWebSocketConnectionUrl: vi.fn(async () => "wss://remote.example.com/?wsToken=1"),
}));

vi.mock("./catalog", () => ({
  getSavedEnvironmentRecord: (environmentId: EnvironmentId) =>
    savedEnvironmentState.byId[environmentId] ?? null,
  hasSavedEnvironmentRegistryHydrated: () => true,
  listSavedEnvironmentRecords: () => Object.values(savedEnvironmentState.byId),
  persistSavedEnvironmentRecord: mockPersistSavedEnvironmentRecord,
  readSavedEnvironmentBearerToken: mockReadSavedEnvironmentBearerToken,
  removeSavedEnvironmentBearerToken: mockRemoveSavedEnvironmentBearerToken,
  useSavedEnvironmentRegistryStore: {
    getState: () => ({
      upsert: (record: any) => {
        savedEnvironmentState.byId[record.environmentId] = record;
        mockRegistryUpsert(record);
      },
      remove: (environmentId: EnvironmentId) => {
        delete savedEnvironmentState.byId[environmentId];
        mockRegistryRemove(environmentId);
      },
      markConnected: mockRegistryMarkConnected,
    }),
  },
  useSavedEnvironmentRuntimeStore: {
    getState: () => ({
      ensure: mockRuntimeEnsure,
      patch: mockRuntimePatch,
      clear: mockRuntimeClear,
    }),
  },
  waitForSavedEnvironmentRegistryHydration: async () => undefined,
  writeSavedEnvironmentBearerToken: mockWriteSavedEnvironmentBearerToken,
}));

vi.mock("./connection", () => ({
  createEnvironmentConnection: mockCreateEnvironmentConnection,
}));

vi.mock("../../rpc/wsTransport", () => ({
  WsTransport: MockWsTransport,
}));

vi.mock("../../rpc/wsRpcClient", () => ({
  createWsRpcClient: mockCreateWsRpcClient,
}));

const serverConfig = {
  environment: {
    environmentId: EnvironmentId.make("environment-remote"),
    label: "Remote environment",
    platform: { os: "linux" as const, arch: "x64" as const },
    serverVersion: "0.0.0-test",
    capabilities: { repositoryIdentity: true },
  },
} satisfies Pick<ServerConfig, "environment"> as ServerConfig;

function resetSavedEnvironmentState() {
  for (const key of Object.keys(savedEnvironmentState.byId)) {
    delete savedEnvironmentState.byId[key];
  }
}

describe("environment runtime service lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    connectionState.clear();
    resetSavedEnvironmentState();

    mockResolveRemotePairingTarget.mockReturnValue({
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      credential: "pairing-code",
    });
    mockFetchRemoteEnvironmentDescriptor.mockResolvedValue({
      environmentId: EnvironmentId.make("environment-remote"),
      label: "Remote environment",
    });
    mockBootstrapRemoteBearerSession.mockResolvedValue({
      sessionToken: "bearer-token",
      role: "client",
    });
    mockFetchRemoteSessionState.mockResolvedValue({
      authenticated: true,
      role: "client",
    });
    mockPersistSavedEnvironmentRecord.mockResolvedValue(undefined);
    mockWriteSavedEnvironmentBearerToken.mockResolvedValue(true);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("bearer-token");
    mockRemoveSavedEnvironmentBearerToken.mockResolvedValue(undefined);
    mockCreateWsRpcClient.mockReturnValue({
      server: {
        getConfig: vi.fn(async () => serverConfig),
      },
    });
    mockCreateEnvironmentConnection.mockImplementation((input: any) => {
      const environmentId = input.knownEnvironment.environmentId;
      const reconnect = vi.fn(async () => undefined);
      const dispose = vi.fn(async () => undefined);
      const connection = {
        kind: "saved" as const,
        environmentId,
        knownEnvironment: input.knownEnvironment,
        client: input.client,
        ensureBootstrapped: vi.fn(async () => undefined),
        reconnect,
        dispose,
      };
      connectionState.set(environmentId, {
        reconnect,
        dispose,
        connection,
      });
      return connection;
    });
  });

  afterEach(async () => {
    const { resetEnvironmentServiceForTests } = await import("./service");
    await resetEnvironmentServiceForTests();
  });

  it("registers a saved environment and reconnects through the existing connection", async () => {
    const { addSavedEnvironment, reconnectSavedEnvironment } = await import("./service");

    const record = await addSavedEnvironment({
      label: "Remote environment",
      host: "remote.example.com",
      pairingCode: "123456",
    });

    expect(record.environmentId).toBe(EnvironmentId.make("environment-remote"));
    expect(mockPersistSavedEnvironmentRecord).toHaveBeenCalledTimes(1);
    expect(mockRegistryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: EnvironmentId.make("environment-remote"),
        label: "Remote environment",
      }),
    );

    await reconnectSavedEnvironment(EnvironmentId.make("environment-remote"));

    expect(mockRuntimePatch).toHaveBeenCalledWith(
      EnvironmentId.make("environment-remote"),
      expect.objectContaining({
        connectionState: "connecting",
        lastError: null,
      }),
    );
    expect(
      connectionState.get(EnvironmentId.make("environment-remote"))?.reconnect,
    ).toHaveBeenCalledTimes(1);
  });

  it("records reconnect failures and disposes the saved connection when removed", async () => {
    const { addSavedEnvironment, reconnectSavedEnvironment, removeSavedEnvironment } =
      await import("./service");

    await addSavedEnvironment({
      label: "Remote environment",
      pairingUrl: "https://remote.example.com/pair#token=pairing-code",
    });

    const existing = connectionState.get(EnvironmentId.make("environment-remote"));
    existing?.reconnect.mockRejectedValueOnce(new Error("socket closed"));

    await expect(
      reconnectSavedEnvironment(EnvironmentId.make("environment-remote")),
    ).rejects.toThrow("socket closed");

    expect(mockRuntimePatch).toHaveBeenCalledWith(
      EnvironmentId.make("environment-remote"),
      expect.objectContaining({
        connectionState: "error",
        lastError: "socket closed",
      }),
    );

    await removeSavedEnvironment(EnvironmentId.make("environment-remote"));

    expect(mockRegistryRemove).toHaveBeenCalledWith(EnvironmentId.make("environment-remote"));
    expect(mockRemoveSavedEnvironmentBearerToken).toHaveBeenCalledWith(
      EnvironmentId.make("environment-remote"),
    );
    expect(mockRuntimeClear).toHaveBeenCalledWith(EnvironmentId.make("environment-remote"));
    expect(existing?.dispose).toHaveBeenCalledTimes(1);
  });
});
