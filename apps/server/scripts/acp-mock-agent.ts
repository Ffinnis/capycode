import { appendFileSync } from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as AcpAgent from "effect-acp/agent";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpProtocol from "effect-acp/protocol";
import type * as EffectAcpSchema from "effect-acp/schema";

const sessionId = "mock-session-1";
const requestLogPath = process.env.T3_ACP_REQUEST_LOG_PATH;
const exitLogPath = process.env.T3_ACP_EXIT_LOG_PATH;

type SessionConfigOption = EffectAcpSchema.SessionConfigOption;
type SessionToolCall = Extract<
  EffectAcpSchema.SessionNotification["update"],
  { readonly sessionUpdate: "tool_call" }
>;
type SessionToolCallUpdate = Extract<
  EffectAcpSchema.SessionNotification["update"],
  { readonly sessionUpdate: "tool_call_update" }
>;

const state = {
  model: "default",
  mode: "ask",
  reasoning: "medium",
  context: "272k",
  fast: "false",
  thinking: true,
};

function appendJsonLine(filePath: string | undefined, entry: unknown) {
  if (!filePath) {
    return;
  }
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function appendExitSignal(signal: string) {
  if (!exitLogPath) {
    return;
  }
  appendFileSync(exitLogPath, `${signal}\n`, "utf8");
}

function appendRequest(method: string, params: unknown) {
  appendJsonLine(requestLogPath, {
    method,
    params,
  });
}

function buildBaseModelOption(): SessionConfigOption {
  return {
    type: "select",
    currentValue: state.model,
    options: [
      { name: "Auto", value: "default" },
      { name: "Composer 2", value: "composer-2" },
      { name: "GPT-5.4", value: "gpt-5.4" },
      { name: "Opus 4.6", value: "claude-opus-4-6" },
    ],
    category: "model",
    id: "model",
    name: "Model",
    description: "Controls which model is used for responses",
  };
}

function buildModeOption(): SessionConfigOption {
  return {
    type: "select",
    currentValue: state.mode,
    options: [
      { name: "Ask", value: "ask" },
      { name: "Agent", value: "agent" },
      { name: "Plan", value: "plan" },
      { name: "Architect", value: "architect" },
    ],
    category: "mode",
    id: "mode",
    name: "Mode",
    description: "Controls how the agent executes tasks",
  };
}

function buildConfigOptions(): ReadonlyArray<SessionConfigOption> {
  const base: Array<SessionConfigOption> = [buildModeOption(), buildBaseModelOption()];

  if (state.model === "gpt-5.4") {
    base.push(
      {
        type: "select",
        currentValue: state.reasoning,
        options: [
          { name: "Low", value: "low" },
          { name: "Medium", value: "medium" },
          { name: "High", value: "high" },
          { name: "Extra High", value: "xhigh" },
        ],
        category: "thought_level",
        id: "reasoning",
        name: "Reasoning",
      },
      {
        type: "select",
        currentValue: state.context,
        options: [
          { name: "272K", value: "272k" },
          { name: "1M", value: "1m" },
        ],
        category: "model_config",
        id: "context",
        name: "Context",
      },
      {
        type: "select",
        currentValue: state.fast,
        options: [
          { name: "Off", value: "false" },
          { name: "Fast", value: "true" },
        ],
        category: "model_config",
        id: "fast",
        name: "Fast",
      },
    );
    return base;
  }

  if (state.model === "claude-opus-4-6") {
    base.push(
      {
        type: "select",
        currentValue: "high",
        options: [
          { name: "Low", value: "low" },
          { name: "Medium", value: "medium" },
          { name: "High", value: "high" },
        ],
        category: "thought_level",
        id: "reasoning",
        name: "Reasoning",
      },
      {
        type: "boolean",
        currentValue: state.thinking,
        category: "model_config",
        id: "thinking",
        name: "Thinking",
      },
    );
    return base;
  }

  if (state.model === "composer-2") {
    base.push({
      type: "select",
      currentValue: state.fast,
      options: [
        { name: "Off", value: "false" },
        { name: "Fast", value: "true" },
      ],
      category: "model_config",
      id: "fast",
      name: "Fast",
    });
  }

  return base;
}

function buildModes(): NonNullable<EffectAcpSchema.NewSessionResponse["modes"]> {
  return {
    currentModeId: state.mode,
    availableModes: [
      { id: "ask", name: "Ask" },
      { id: "agent", name: "Agent" },
      { id: "plan", name: "Plan" },
      { id: "architect", name: "Architect" },
    ],
  };
}

function buildSessionSetupResponse(): EffectAcpSchema.NewSessionResponse {
  return {
    sessionId,
    configOptions: buildConfigOptions(),
    modes: buildModes(),
  };
}

function normalizeConfigValue(value: string | boolean) {
  return typeof value === "boolean" ? value : value.trim();
}

function updateConfig(configId: string, value: string | boolean) {
  const normalized = normalizeConfigValue(value);
  switch (configId) {
    case "model":
      state.model = String(normalized);
      if (state.model === "gpt-5.4") {
        state.reasoning = "medium";
        state.context = "272k";
        state.fast = "false";
      } else if (state.model === "claude-opus-4-6") {
        state.reasoning = "high";
        state.thinking = true;
      } else {
        state.fast = "false";
      }
      break;
    case "mode":
      state.mode = String(normalized);
      break;
    case "reasoning":
      state.reasoning = String(normalized);
      break;
    case "context":
      state.context = String(normalized);
      break;
    case "fast":
      state.fast = String(normalized);
      break;
    case "thinking":
      state.thinking = normalized === true || normalized === "true";
      break;
    default:
      throw new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage: `Unknown session config option: ${configId}`,
      });
  }
}

function logDecodedProtocolEvent(event: EffectAcpProtocol.AcpProtocolLogEvent) {
  if (!requestLogPath || event.stage !== "decoded") {
    return;
  }
  const payload = event.payload as {
    readonly _tag?: string;
    readonly id?: unknown;
    readonly tag?: unknown;
    readonly payload?: unknown;
    readonly requestId?: unknown;
    readonly exit?: {
      readonly _tag?: string;
      readonly value?: unknown;
      readonly cause?: unknown;
    };
  };
  if (payload._tag === "Request" && typeof payload.tag === "string") {
    appendJsonLine(requestLogPath, {
      id: payload.id,
      method: payload.tag,
      params: payload.payload,
    });
    return;
  }
  if (payload._tag === "Exit" && payload.exit) {
    appendJsonLine(
      requestLogPath,
      payload.exit._tag === "Success"
        ? {
            id: payload.requestId,
            result: payload.exit.value,
          }
        : {
            id: payload.requestId,
            error: payload.exit.cause,
          },
    );
  }
}

function commandToolCall() {
  return {
    toolCallId: "tool-call-1",
    kind: "execute" as const,
    title: "Read file",
    rawInput: {
      command: ["cat", "server/package.json"],
    },
  } satisfies Pick<SessionToolCall, "toolCallId" | "kind" | "title" | "rawInput">;
}

function readFileToolCall() {
  return {
    toolCallId: "tool-call-1",
    kind: "read" as const,
    title: "Read file",
    rawInput: {
      path: "server/package.json",
    },
  } satisfies Pick<SessionToolCall, "toolCallId" | "kind" | "title" | "rawInput">;
}

const promptProgram = (agent: AcpAgent.AcpAgentShape) =>
  Effect.gen(function* () {
    if (process.env.T3_ACP_EMIT_ASK_QUESTION === "1") {
      const answer = yield* agent.client.extRequest("cursor/ask_question", {
        toolCallId: "ask-question-1",
        title: "Need confirmation",
        questions: [
          {
            id: "approved",
            prompt: "Need confirmation before continuing.",
            options: [{ id: "yes", label: "Yes" }],
          },
        ],
      });
      if (
        !answer ||
        typeof answer !== "object" ||
        !("answers" in answer) ||
        !answer.answers ||
        typeof answer.answers !== "object"
      ) {
        return {
          stopReason: "cancelled" as const,
        };
      }
    }

    if (process.env.T3_ACP_EMIT_TOOL_CALLS === "1") {
      const permission = yield* agent.client.requestPermission({
        sessionId,
        options: [
          {
            optionId: "allow-always",
            name: "Always Allow",
            kind: "allow_always",
          },
          {
            optionId: "allow",
            name: "Allow",
            kind: "allow_once",
          },
          {
            optionId: "deny",
            name: "Deny",
            kind: "reject_once",
          },
        ],
        toolCall: {
          ...commandToolCall(),
          status: "pending",
        },
      });
      appendJsonLine(requestLogPath, {
        result: permission,
      });
      if (permission.outcome.outcome === "cancelled") {
        return {
          stopReason: "cancelled" as const,
        };
      }

      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          ...commandToolCall(),
          status: "pending",
        } satisfies SessionToolCall,
      });
      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          ...commandToolCall(),
          status: "in_progress",
        } satisfies SessionToolCallUpdate,
      });
      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          ...commandToolCall(),
          status: "completed",
        } satisfies SessionToolCallUpdate,
      });
      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello from mock" },
        },
      });
      return {
        stopReason: "end_turn" as const,
      };
    }

    if (process.env.T3_ACP_EMIT_INTERLEAVED_ASSISTANT_TOOL_CALLS === "1") {
      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "before tool" },
        },
      });
      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          ...commandToolCall(),
          status: "pending",
        } satisfies SessionToolCall,
      });
      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          ...commandToolCall(),
          status: "completed",
        } satisfies SessionToolCallUpdate,
      });
      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "after tool" },
        },
      });
      return {
        stopReason: "end_turn" as const,
      };
    }

    if (process.env.T3_ACP_EMIT_GENERIC_TOOL_PLACEHOLDERS === "1") {
      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-call-1",
          kind: "read",
          title: "Working",
          status: "pending",
        } satisfies SessionToolCall,
      });
      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          ...readFileToolCall(),
          status: "completed",
        } satisfies SessionToolCallUpdate,
      });
      return {
        stopReason: "end_turn" as const,
      };
    }

    yield* agent.client.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "plan",
        entries: [
          {
            content: "Inspect mock ACP state",
            priority: "high",
            status: "completed",
          },
          {
            content: "Implement the requested change",
            priority: "high",
            status: "in_progress",
          },
        ],
      },
    });
    yield* agent.client.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello from mock" },
      },
    });
    return {
      stopReason: "end_turn" as const,
    };
  });

if (exitLogPath) {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      appendExitSignal(signal);
      process.exit(0);
    });
  }
}

if (process.env.ACP_MOCK_MALFORMED_OUTPUT === "1") {
  process.stdout.write("{not-json}\n");
  process.exit(Number(process.env.ACP_MOCK_MALFORMED_OUTPUT_EXIT_CODE ?? "0"));
}

if (process.env.ACP_MOCK_EXIT_IMMEDIATELY_CODE !== undefined) {
  process.exit(Number(process.env.ACP_MOCK_EXIT_IMMEDIATELY_CODE));
}

const program = Effect.gen(function* () {
  const agent = yield* AcpAgent.AcpAgent;

  yield* agent.handleInitialize((request) =>
    Effect.sync(() => {
      appendRequest("initialize", request);
      return {
        protocolVersion: 1,
        agentCapabilities: {
          sessionCapabilities: {
            list: {},
          },
        },
        agentInfo: {
          name: "mock-agent",
          version: "0.0.0",
        },
      } satisfies EffectAcpSchema.InitializeResponse;
    }),
  );

  yield* agent.handleAuthenticate((request) =>
    Effect.sync(() => {
      appendRequest("authenticate", request);
      return {};
    }),
  );
  yield* agent.handleLogout((request) =>
    Effect.sync(() => {
      appendRequest("logout", request);
      return {};
    }),
  );
  yield* agent.handleCreateSession((request) =>
    Effect.sync(() => {
      appendRequest("session/new", request);
      return buildSessionSetupResponse();
    }),
  );
  yield* agent.handleLoadSession((request) =>
    Effect.sync(() => {
      appendRequest("session/load", request);
      return buildSessionSetupResponse();
    }),
  );
  yield* agent.handleListSessions((request) =>
    Effect.sync(() => {
      appendRequest("session/list", request);
      return {
        sessions: [
          {
            sessionId,
            cwd: process.cwd(),
          },
        ],
      };
    }),
  );
  yield* agent.handleSetSessionConfigOption((request) =>
    Effect.sync(() => {
      appendRequest("session/set_config_option", request);
      updateConfig(request.configId, request.value);
      return {
        configOptions: buildConfigOptions(),
      } satisfies EffectAcpSchema.SetSessionConfigOptionResponse;
    }),
  );
  yield* agent.handlePrompt((request) =>
    Effect.sync(() => {
      appendRequest("session/prompt", request);
      return request;
    }).pipe(Effect.flatMap(() => promptProgram(agent))),
  );
  yield* agent.handleCancel((notification) =>
    Effect.sync(() => {
      appendRequest("session/cancel", notification);
    }),
  );
  yield* agent.handleUnknownExtRequest((method, params) =>
    Effect.succeed({
      echoedMethod: method,
      echoedParams: params ?? null,
    }),
  );
  yield* agent.handleUnknownExtNotification(() => Effect.void);

  return yield* Effect.never;
});

program.pipe(
  Effect.provide(
    Layer.provide(
      AcpAgent.layerStdio({
        logIncoming: Boolean(requestLogPath),
        logOutgoing: Boolean(requestLogPath),
        logger: (event) =>
          Effect.sync(() => {
            logDecodedProtocolEvent(event);
          }),
      }),
      NodeServices.layer,
    ),
  ),
  NodeRuntime.runMain,
);
