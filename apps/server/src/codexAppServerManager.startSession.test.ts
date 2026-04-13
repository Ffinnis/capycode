import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { ThreadId } from "@capycode/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import { CodexAppServerManager } from "./codexAppServerManager";

function asThreadId(value: string): ThreadId {
  return ThreadId.make(value);
}

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };

  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);

  return child;
}

describe("CodexAppServerManager startSession thread opening", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => createFakeChild());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts a fresh thread when no resume cursor is provided", async () => {
    const manager = new CodexAppServerManager();
    const sendRequest = vi
      .spyOn(
        manager as unknown as { sendRequest: (...args: unknown[]) => Promise<unknown> },
        "sendRequest",
      )
      .mockImplementation(async (_context, method) => {
        switch (method) {
          case "initialize":
            return {};
          case "model/list":
            return {};
          case "account/read":
            return {};
          case "thread/start":
            return {
              thread: {
                id: "provider-thread-fresh",
              },
            };
          default:
            throw new Error(`Unexpected request method: ${String(method)}`);
        }
      });
    vi.spyOn(
      manager as unknown as {
        assertSupportedCodexCliVersion: (input: {
          binaryPath: string;
          cwd: string;
          homePath?: string;
        }) => void;
      },
      "assertSupportedCodexCliVersion",
    ).mockImplementation(() => {});

    try {
      const session = await manager.startSession({
        threadId: asThreadId("thread-fresh"),
        provider: "codex",
        binaryPath: "codex",
        cwd: "/tmp/project-fresh",
        runtimeMode: "full-access",
      });

      expect(session.status).toBe("ready");
      expect(session.threadId).toBe("thread-fresh");
      expect(session.resumeCursor).toEqual({ threadId: "provider-thread-fresh" });
      expect(sendRequest).toHaveBeenCalledWith(
        expect.anything(),
        "thread/start",
        expect.objectContaining({
          cwd: "/tmp/project-fresh",
        }),
      );
    } finally {
      manager.stopAll();
    }
  });

  it("resumes an existing thread when a resume cursor thread id is available", async () => {
    const manager = new CodexAppServerManager();
    const sendRequest = vi
      .spyOn(
        manager as unknown as { sendRequest: (...args: unknown[]) => Promise<unknown> },
        "sendRequest",
      )
      .mockImplementation(async (_context, method, params) => {
        switch (method) {
          case "initialize":
            return {};
          case "model/list":
            return {};
          case "account/read":
            return {};
          case "thread/resume":
            expect(params).toEqual(
              expect.objectContaining({
                threadId: "provider-thread-existing",
              }),
            );
            return {
              thread: {
                id: "provider-thread-existing",
              },
            };
          default:
            throw new Error(`Unexpected request method: ${String(method)}`);
        }
      });
    vi.spyOn(
      manager as unknown as {
        assertSupportedCodexCliVersion: (input: {
          binaryPath: string;
          cwd: string;
          homePath?: string;
        }) => void;
      },
      "assertSupportedCodexCliVersion",
    ).mockImplementation(() => {});

    try {
      const session = await manager.startSession({
        threadId: asThreadId("thread-resume"),
        provider: "codex",
        binaryPath: "codex",
        cwd: "/tmp/project-resume",
        runtimeMode: "full-access",
        resumeCursor: {
          threadId: "provider-thread-existing",
        },
      });

      expect(session.status).toBe("ready");
      expect(session.resumeCursor).toEqual({ threadId: "provider-thread-existing" });
      expect(sendRequest).toHaveBeenCalledWith(
        expect.anything(),
        "thread/resume",
        expect.objectContaining({
          threadId: "provider-thread-existing",
        }),
      );
    } finally {
      manager.stopAll();
    }
  });

  it("falls back to a fresh thread start when resume fails with a recoverable error", async () => {
    const manager = new CodexAppServerManager();
    const events: string[] = [];
    manager.on("event", (event) => {
      events.push(event.method);
    });
    const sendRequest = vi
      .spyOn(
        manager as unknown as { sendRequest: (...args: unknown[]) => Promise<unknown> },
        "sendRequest",
      )
      .mockImplementation(async (_context, method) => {
        switch (method) {
          case "initialize":
            return {};
          case "model/list":
            return {};
          case "account/read":
            return {};
          case "thread/resume":
            throw new Error("thread/resume failed: thread not found");
          case "thread/start":
            return {
              thread: {
                id: "provider-thread-restarted",
              },
            };
          default:
            throw new Error(`Unexpected request method: ${String(method)}`);
        }
      });
    vi.spyOn(
      manager as unknown as {
        assertSupportedCodexCliVersion: (input: {
          binaryPath: string;
          cwd: string;
          homePath?: string;
        }) => void;
      },
      "assertSupportedCodexCliVersion",
    ).mockImplementation(() => {});

    try {
      const session = await manager.startSession({
        threadId: asThreadId("thread-resume-fallback"),
        provider: "codex",
        binaryPath: "codex",
        cwd: "/tmp/project-resume-fallback",
        runtimeMode: "full-access",
        resumeCursor: {
          threadId: "provider-thread-missing",
        },
      });

      expect(session.status).toBe("ready");
      expect(session.resumeCursor).toEqual({ threadId: "provider-thread-restarted" });
      expect(sendRequest.mock.calls.map((call) => call[1])).toContain("thread/resume");
      expect(sendRequest.mock.calls.map((call) => call[1])).toContain("thread/start");
      expect(events).toContain("session/threadResumeFallback");
    } finally {
      manager.stopAll();
    }
  });
});
