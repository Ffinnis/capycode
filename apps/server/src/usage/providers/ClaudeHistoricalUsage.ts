import * as fs from "node:fs/promises";
import * as OS from "node:os";
import * as path from "node:path";

import type { UsageSessionSummary, UsageTotals } from "@capycode/contracts";

export interface ClaudeHistoricalUsageResult {
  readonly rootPath: string;
  readonly sessions: ReadonlyArray<UsageSessionSummary>;
  readonly warnings: ReadonlyArray<string>;
}

interface MutableTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function withHome(pathValue: string): string {
  return pathValue.startsWith("~") ? path.join(OS.homedir(), pathValue.slice(1)) : pathValue;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function emptyMutableTotals(): MutableTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function toUsageTotals(input: MutableTotals): UsageTotals {
  return {
    inputTokens: Math.max(0, Math.round(input.inputTokens)),
    cachedInputTokens: Math.max(0, Math.round(input.cachedInputTokens)),
    outputTokens: Math.max(0, Math.round(input.outputTokens)),
    reasoningOutputTokens: 0,
    totalTokens: Math.max(0, Math.round(input.totalTokens)),
    sessionCount: 1,
  };
}

async function collectSessionFiles(rootPath: string): Promise<Array<string>> {
  const results: Array<string> = [];

  async function visit(currentPath: string): Promise<void> {
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
          return;
        }
        if (
          entry.isFile() &&
          entry.name.endsWith(".jsonl") &&
          !entryPath.includes(`${path.sep}subagents${path.sep}`)
        ) {
          results.push(entryPath);
        }
      }),
    );
  }

  await visit(rootPath);
  results.sort();
  return results;
}

export async function readClaudeHistoricalUsage(
  input: {
    readonly rootPath?: string;
  } = {},
): Promise<ClaudeHistoricalUsageResult> {
  const configuredRoot =
    input.rootPath ??
    process.env.CLAUDE_CONFIG_DIR ??
    path.join(OS.homedir(), ".config", "claude", "projects");
  const rootPath = withHome(configuredRoot);
  const sessionFiles = await collectSessionFiles(rootPath);

  if (sessionFiles.length === 0) {
    return {
      rootPath,
      sessions: [],
      warnings: [`No Claude session logs found in ${rootPath}.`],
    };
  }

  const sessions: Array<UsageSessionSummary> = [];
  const warnings: Array<string> = [];

  for (const sessionFile of sessionFiles) {
    let content: string;
    try {
      content = await fs.readFile(sessionFile, "utf8");
    } catch {
      warnings.push(`Failed to read Claude session log ${sessionFile}.`);
      continue;
    }

    const relativeId = path.relative(rootPath, sessionFile).replace(/\.jsonl$/i, "");
    const models = new Set<string>();
    const totals = emptyMutableTotals();
    let startedAt: string | null = null;
    let endedAt: string | null = null;
    let projectPath: string | null = null;

    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        warnings.push(`Skipped malformed Claude log line in ${sessionFile}.`);
        continue;
      }

      const record = readObject(parsed);
      if (!record) continue;

      const timestamp = readString(record.timestamp);
      if (timestamp && !startedAt) startedAt = timestamp;
      if (timestamp) endedAt = timestamp;

      const cwd = readString(record.cwd);
      if (cwd) projectPath = cwd;

      const message = readObject(record.message);
      const model = readString(message?.model);
      if (model) {
        models.add(model);
      }

      if (readString(record.type) !== "assistant") {
        continue;
      }

      const usage = readObject(message?.usage);
      if (!usage) {
        continue;
      }

      const inputTokens = readNumber(usage.input_tokens) ?? 0;
      const cachedInputTokens =
        (readNumber(usage.cache_creation_input_tokens) ?? 0) +
        (readNumber(usage.cache_read_input_tokens) ?? 0);
      const outputTokens = readNumber(usage.output_tokens) ?? 0;

      totals.inputTokens += inputTokens;
      totals.cachedInputTokens += cachedInputTokens;
      totals.outputTokens += outputTokens;
      totals.totalTokens += inputTokens + cachedInputTokens + outputTokens;
    }

    if (!startedAt) {
      continue;
    }

    sessions.push({
      id: relativeId,
      startedAt,
      endedAt,
      provider: "claudeAgent",
      models: Array.from(models),
      totals: toUsageTotals(totals),
      projectPath,
    });
  }

  return {
    rootPath,
    sessions: sessions
      .filter((session) => session.totals.totalTokens > 0 || session.totals.inputTokens > 0)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    warnings,
  };
}
