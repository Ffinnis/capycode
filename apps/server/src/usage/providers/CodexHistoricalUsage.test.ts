import * as fs from "node:fs/promises";
import * as OS from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readCodexHistoricalUsage } from "./CodexHistoricalUsage";

const temporaryDirectories: Array<string> = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(OS.tmpdir(), "capycode-codex-usage-"));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("readCodexHistoricalUsage", () => {
  it("parses token usage without double-counting reasoning output tokens", async () => {
    const rootPath = await makeTempDir();
    await fs.mkdir(path.join(rootPath, "project"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, "project", "session.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-04-12T00:00:00.000Z",
          type: "session_meta",
          payload: { cwd: "/repo/capycode" },
        }),
        JSON.stringify({
          timestamp: "2026-04-12T00:01:00.000Z",
          type: "turn_context",
          payload: { model: "gpt-5.4" },
        }),
        JSON.stringify({
          timestamp: "2026-04-12T00:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 20,
                output_tokens: 30,
                reasoning_output_tokens: 10,
                total_tokens: 150,
              },
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await readCodexHistoricalUsage({ rootPath });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        models: ["gpt-5.4"],
        projectPath: "/repo/capycode",
        totals: expect.objectContaining({
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 30,
          reasoningOutputTokens: 10,
          totalTokens: 150,
        }),
      }),
    );
  });

  it("falls back to gpt-5 for legacy sessions without explicit turn context", async () => {
    const rootPath = await makeTempDir();
    await fs.mkdir(path.join(rootPath, "legacy"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, "legacy", "session.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-04-11T00:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 50,
                cached_input_tokens: 0,
                output_tokens: 10,
                reasoning_output_tokens: 0,
                total_tokens: 60,
              },
            },
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T00:05:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 70,
                cached_input_tokens: 0,
                output_tokens: 20,
                reasoning_output_tokens: 0,
                total_tokens: 90,
              },
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await readCodexHistoricalUsage({ rootPath });

    expect(result.sessions[0]?.models).toEqual(["gpt-5"]);
    expect(result.sessions[0]?.totals.totalTokens).toBe(90);
  });

  it("returns an empty result when the Codex sessions directory is missing", async () => {
    const rootPath = path.join(await makeTempDir(), "missing");

    const result = await readCodexHistoricalUsage({ rootPath });

    expect(result.sessions).toEqual([]);
    expect(result.warnings[0]).toContain("No Codex session logs found");
  });
});
