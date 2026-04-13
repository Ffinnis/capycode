import * as fs from "node:fs/promises";
import * as OS from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readClaudeHistoricalUsage } from "./ClaudeHistoricalUsage";

const temporaryDirectories: Array<string> = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(OS.tmpdir(), "capycode-claude-usage-"));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("readClaudeHistoricalUsage", () => {
  it("parses assistant usage and includes cache tokens in the cached input total", async () => {
    const rootPath = await makeTempDir();
    await fs.mkdir(path.join(rootPath, "project"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "project", "subagents"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, "project", "session.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-04-12T00:00:00.000Z",
          cwd: "/repo/capycode",
          type: "assistant",
          message: {
            model: "claude-sonnet-4-6",
            usage: {
              input_tokens: 100,
              cache_creation_input_tokens: 20,
              cache_read_input_tokens: 30,
              output_tokens: 40,
            },
          },
        }),
        "{not-json}",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(rootPath, "project", "subagents", "ignored.jsonl"),
      JSON.stringify({
        timestamp: "2026-04-12T00:00:00.000Z",
        type: "assistant",
        message: {
          model: "claude-opus-4-6",
          usage: {
            input_tokens: 999,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 999,
          },
        },
      }),
      "utf8",
    );

    const result = await readClaudeHistoricalUsage({ rootPath });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        models: ["claude-sonnet-4-6"],
        projectPath: "/repo/capycode",
        totals: expect.objectContaining({
          inputTokens: 100,
          cachedInputTokens: 50,
          outputTokens: 40,
          totalTokens: 190,
        }),
      }),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Skipped malformed Claude log line")]),
    );
  });

  it("returns an empty result when the Claude projects directory is missing", async () => {
    const rootPath = path.join(await makeTempDir(), "missing");

    const result = await readClaudeHistoricalUsage({ rootPath });

    expect(result.sessions).toEqual([]);
    expect(result.warnings[0]).toContain("No Claude session logs found");
  });
});
