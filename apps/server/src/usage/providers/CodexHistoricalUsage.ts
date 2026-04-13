import * as fs from "node:fs/promises";
import * as OS from "node:os";
import * as path from "node:path";

import type { UsageSessionSummary, UsageTotals } from "@capycode/contracts";

export interface CodexHistoricalUsageResult {
  readonly rootPath: string;
  readonly sessions: ReadonlyArray<UsageSessionSummary>;
  readonly warnings: ReadonlyArray<string>;
}

interface MutableTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

interface TokenUsageSnapshot extends MutableTotals {}

function withHome(pathValue: string): string {
  return pathValue.startsWith("~") ? path.join(OS.homedir(), pathValue.slice(1)) : pathValue;
}

function emptyMutableTotals(): MutableTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function toUsageTotals(input: MutableTotals): UsageTotals {
  return {
    inputTokens: Math.max(0, Math.round(input.inputTokens)),
    cachedInputTokens: Math.max(0, Math.round(input.cachedInputTokens)),
    outputTokens: Math.max(0, Math.round(input.outputTokens)),
    reasoningOutputTokens: Math.max(0, Math.round(input.reasoningOutputTokens)),
    totalTokens: Math.max(0, Math.round(input.totalTokens)),
    sessionCount: 1,
  };
}

function addMutableTotals(target: MutableTotals, value: TokenUsageSnapshot): void {
  target.inputTokens += value.inputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.outputTokens += value.outputTokens;
  target.reasoningOutputTokens += value.reasoningOutputTokens;
  target.totalTokens += value.totalTokens;
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

function readTokenSnapshot(value: unknown): TokenUsageSnapshot | null {
  const record = readObject(value);
  if (!record) return null;

  const inputTokens = readNumber(record.input_tokens) ?? 0;
  const cachedInputTokens = readNumber(record.cached_input_tokens) ?? 0;
  const outputTokens = readNumber(record.output_tokens) ?? 0;
  const reasoningOutputTokens = readNumber(record.reasoning_output_tokens) ?? 0;
  const totalTokens =
    readNumber(record.total_tokens) ?? inputTokens + cachedInputTokens + outputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
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
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          results.push(entryPath);
        }
      }),
    );
  }

  await visit(rootPath);
  return results.toSorted();
}

export async function readCodexHistoricalUsage(
  input: {
    readonly rootPath?: string;
  } = {},
): Promise<CodexHistoricalUsageResult> {
  const rootPath = withHome(input.rootPath ?? path.join(OS.homedir(), ".codex", "sessions"));
  const sessionFiles = await collectSessionFiles(rootPath);
  if (sessionFiles.length === 0) {
    return {
      rootPath,
      sessions: [],
      warnings: [`No Codex session logs found in ${rootPath}.`],
    };
  }

  const sessions: Array<UsageSessionSummary> = [];
  const warnings: Array<string> = [];

  for (const sessionFile of sessionFiles) {
    let content: string;
    try {
      content = await fs.readFile(sessionFile, "utf8");
    } catch {
      warnings.push(`Failed to read Codex session log ${sessionFile}.`);
      continue;
    }

    const relativeId = path.relative(rootPath, sessionFile).replace(/\.jsonl$/i, "");
    const models = new Set<string>();
    const totals = emptyMutableTotals();
    let currentModel = "gpt-5";
    let previousTotalSnapshot: TokenUsageSnapshot | null = null;
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
        warnings.push(`Skipped malformed Codex log line in ${sessionFile}.`);
        continue;
      }

      const record = readObject(parsed);
      if (!record) continue;

      const timestamp = readString(record.timestamp);
      if (timestamp && !startedAt) startedAt = timestamp;
      if (timestamp) endedAt = timestamp;

      const type = readString(record.type);
      const payload = readObject(record.payload);

      if (type === "session_meta") {
        const metaPayload = payload;
        const cwd = readString(metaPayload?.cwd);
        if (cwd) projectPath = cwd;
        continue;
      }

      if (type === "turn_context") {
        const model = readString(payload?.model);
        if (model) {
          currentModel = model;
          models.add(model);
        }
        continue;
      }

      if (type !== "event_msg" || readString(payload?.type) !== "token_count") {
        continue;
      }

      const info = readObject(payload?.info);
      const lastTokenUsage = readTokenSnapshot(info?.last_token_usage);
      const totalTokenUsage = readTokenSnapshot(info?.total_token_usage);
      let nextUsage = lastTokenUsage;

      if (!nextUsage && totalTokenUsage) {
        if (previousTotalSnapshot) {
          nextUsage = {
            inputTokens: Math.max(
              0,
              totalTokenUsage.inputTokens - previousTotalSnapshot.inputTokens,
            ),
            cachedInputTokens: Math.max(
              0,
              totalTokenUsage.cachedInputTokens - previousTotalSnapshot.cachedInputTokens,
            ),
            outputTokens: Math.max(
              0,
              totalTokenUsage.outputTokens - previousTotalSnapshot.outputTokens,
            ),
            reasoningOutputTokens: Math.max(
              0,
              totalTokenUsage.reasoningOutputTokens - previousTotalSnapshot.reasoningOutputTokens,
            ),
            totalTokens: Math.max(
              0,
              totalTokenUsage.totalTokens - previousTotalSnapshot.totalTokens,
            ),
          };
        } else {
          nextUsage = totalTokenUsage;
        }
      }

      if (totalTokenUsage) {
        previousTotalSnapshot = totalTokenUsage;
      }

      if (!nextUsage) {
        continue;
      }

      addMutableTotals(totals, nextUsage);
      models.add(currentModel);
    }

    if (!startedAt) {
      continue;
    }

    sessions.push({
      id: relativeId,
      startedAt,
      endedAt,
      provider: "codex",
      models: Array.from(models),
      totals: toUsageTotals(totals),
      projectPath,
    });
  }

  return {
    rootPath,
    sessions: sessions
      .filter((session) => session.totals.totalTokens > 0 || session.totals.inputTokens > 0)
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt)),
    warnings,
  };
}
