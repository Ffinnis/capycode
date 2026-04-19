import { WsRpcGroup } from "@capycode/contracts";
import { Duration, Effect, Layer, Schedule } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import {
  acknowledgeRpcRequest,
  clearAllTrackedRpcRequests,
  trackRpcRequestSent,
} from "./requestLatencyState";
import {
  getWsReconnectDelayMsForRetry,
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionErrored,
  recordWsConnectionOpened,
  WS_RECONNECT_MAX_RETRIES,
} from "./wsConnectionState";

export interface WsProtocolLifecycleHandlers {
  readonly onAttempt?: (socketUrl: string) => void;
  readonly onOpen?: () => void;
  readonly onError?: (message: string) => void;
  readonly onClose?: (details: { readonly code: number; readonly reason: string }) => void;
}

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup);
type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;
export type WsRpcProtocolSocketUrlProvider = string | (() => Promise<string>);

const LEGACY_PROJECT_ERROR_CODE = "not_found";
const ALL_LEGACY_PROJECT_ERROR_TAGS = new Set([
  "ProjectSearchEntriesError",
  "ProjectListDirectoryError",
  "ProjectWriteFileError",
  "ProjectReadFileError",
  "ProjectCreateDirectoryError",
  "ProjectDeleteEntryError",
  "ProjectMoveEntryError",
]);

export function normalizeLegacyProjectRpcPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLegacyProjectRpcPayload(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  let mutated = false;
  const nextRecord: Record<string, unknown> = { ...record };

  if (
    typeof record._tag === "string" &&
    ALL_LEGACY_PROJECT_ERROR_TAGS.has(record._tag) &&
    typeof record.code !== "string" &&
    !("code" in record)
  ) {
    nextRecord.code = LEGACY_PROJECT_ERROR_CODE;
    mutated = true;
  }

  for (const [key, child] of Object.entries(record)) {
    const normalizedChild = normalizeLegacyProjectRpcPayload(child);
    if (normalizedChild !== child) {
      nextRecord[key] = normalizedChild;
      mutated = true;
    }
  }

  return mutated ? nextRecord : value;
}

const projectRpcCompatibilitySerialization = RpcSerialization.RpcSerialization.of({
  contentType: RpcSerialization.json.contentType,
  includesFraming: RpcSerialization.json.includesFraming,
  makeUnsafe: () => {
    const parser = RpcSerialization.json.makeUnsafe();
    return {
      decode: (data) => parser.decode(data).map((value) => normalizeLegacyProjectRpcPayload(value)),
      encode: parser.encode,
    };
  },
});

function formatSocketErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

function resolveWsRpcSocketUrl(rawUrl: string): string {
  const resolved = new URL(rawUrl);
  if (resolved.protocol !== "ws:" && resolved.protocol !== "wss:") {
    throw new Error(`Unsupported websocket transport URL protocol: ${resolved.protocol}`);
  }

  resolved.pathname = "/ws";
  return resolved.toString();
}

function defaultLifecycleHandlers(): Required<WsProtocolLifecycleHandlers> {
  return {
    onAttempt: recordWsConnectionAttempt,
    onOpen: recordWsConnectionOpened,
    onError: (message) => {
      clearAllTrackedRpcRequests();
      recordWsConnectionErrored(message);
    },
    onClose: (details) => {
      clearAllTrackedRpcRequests();
      recordWsConnectionClosed(details);
    },
  };
}

function composeLifecycleHandlers(
  handlers?: WsProtocolLifecycleHandlers,
): Required<WsProtocolLifecycleHandlers> {
  const defaults = defaultLifecycleHandlers();

  return {
    onAttempt: (socketUrl) => {
      defaults.onAttempt(socketUrl);
      handlers?.onAttempt?.(socketUrl);
    },
    onOpen: () => {
      defaults.onOpen();
      handlers?.onOpen?.();
    },
    onError: (message) => {
      defaults.onError(message);
      handlers?.onError?.(message);
    },
    onClose: (details) => {
      defaults.onClose(details);
      handlers?.onClose?.(details);
    },
  };
}

export function createWsRpcProtocolLayer(
  url: WsRpcProtocolSocketUrlProvider,
  handlers?: WsProtocolLifecycleHandlers,
) {
  const lifecycle = composeLifecycleHandlers(handlers);
  const resolvedUrl =
    typeof url === "function"
      ? Effect.promise(() => url()).pipe(
          Effect.map((rawUrl) => resolveWsRpcSocketUrl(rawUrl)),
          Effect.tapError((error) =>
            Effect.sync(() => {
              lifecycle.onError(formatSocketErrorMessage(error));
            }),
          ),
          Effect.orDie,
        )
      : resolveWsRpcSocketUrl(url);

  const trackingWebSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) => {
      lifecycle.onAttempt(socketUrl);
      const socket = new globalThis.WebSocket(socketUrl, protocols);

      socket.addEventListener(
        "open",
        () => {
          lifecycle.onOpen();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          lifecycle.onError("Unable to connect to the T3 server WebSocket.");
        },
        { once: true },
      );
      socket.addEventListener(
        "close",
        (event) => {
          lifecycle.onClose({
            code: event.code,
            reason: event.reason,
          });
        },
        { once: true },
      );

      return socket;
    },
  );
  const socketLayer = Socket.layerWebSocket(resolvedUrl).pipe(
    Layer.provide(trackingWebSocketConstructorLayer),
  );
  const retryPolicy = Schedule.addDelay(Schedule.recurs(WS_RECONNECT_MAX_RETRIES), (retryCount) =>
    Effect.succeed(Duration.millis(getWsReconnectDelayMsForRetry(retryCount) ?? 0)),
  );
  const protocolLayer = Layer.effect(
    RpcClient.Protocol,
    Effect.map(
      RpcClient.makeProtocolSocket({
        retryPolicy,
        retryTransientErrors: true,
      }),
      (protocol) => ({
        ...protocol,
        run: (clientId, writeResponse) =>
          protocol.run(clientId, (response) => {
            if (response._tag === "Chunk" || response._tag === "Exit") {
              acknowledgeRpcRequest(response.requestId);
            } else if (response._tag === "ClientProtocolError" || response._tag === "Defect") {
              clearAllTrackedRpcRequests();
            }
            return writeResponse(response);
          }),
        send: (clientId, request, transferables) => {
          if (request._tag === "Request") {
            trackRpcRequestSent(request.id, request.tag);
          }
          return protocol.send(clientId, request, transferables);
        },
      }),
    ),
  );

  return protocolLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        socketLayer,
        Layer.succeed(RpcSerialization.RpcSerialization, projectRpcCompatibilitySerialization),
      ),
    ),
  );
}
