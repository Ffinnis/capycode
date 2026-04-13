import * as fs from "node:fs/promises";
import * as OS from "node:os";
import * as path from "node:path";

import type { ProviderRateWindow, ProviderUsageIdentity } from "@capycode/contracts";
import { codexAuthSubLabel, type CodexAccountSnapshot } from "../../provider/codexAccount";
import type { CodexDiscoverySnapshot } from "../../provider/codexAppServer";
import { probeCodexDiscovery } from "../../provider/codexAppServer";
import { normalizeCodexRateWindows } from "../normalize/rateWindows";

interface CodexOAuthUsageResponse {
  readonly email?: unknown;
  readonly plan_type?: unknown;
  readonly rate_limit?: unknown;
}

interface CodexAuthTokens {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly account_id?: unknown;
}

interface CodexAuthPayload {
  readonly OPENAI_API_KEY?: unknown;
  readonly tokens?: CodexAuthTokens;
}

interface CodexOAuthCredentials {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly accountId: string | null;
}

export interface CodexLimitsProbeResult {
  readonly identity: ProviderUsageIdentity;
  readonly limits: ReadonlyArray<ProviderRateWindow>;
}

interface CodexLimitsProbeInput {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly cwd: string;
  readonly authPath?: string;
  readonly configPath?: string;
  readonly fetchFn?: typeof fetch;
  readonly probeDiscovery?: (
    input: Pick<CodexLimitsProbeInput, "binaryPath" | "homePath" | "cwd">,
  ) => Promise<CodexDiscoverySnapshot>;
}

function toAccountLabel(account: CodexAccountSnapshot): string | null {
  if (account.type === "apiKey") return "OpenAI API";
  if (account.type === "chatgpt") {
    return account.planType && account.planType !== "unknown"
      ? `ChatGPT ${account.planType}`
      : "ChatGPT";
  }
  return null;
}

function toIdentity(snapshot: CodexDiscoverySnapshot): ProviderUsageIdentity {
  return {
    accountLabel: toAccountLabel(snapshot.account),
    authLabel: codexAuthSubLabel(snapshot.account) ?? null,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function expandHomePath(homePath: string): string {
  return homePath.startsWith("~") ? path.join(OS.homedir(), homePath.slice(1)) : homePath;
}

function resolveCodexHome(inputHomePath?: string): string {
  if (inputHomePath && inputHomePath.trim().length > 0) {
    return expandHomePath(inputHomePath.trim());
  }
  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim().length > 0) {
    return expandHomePath(process.env.CODEX_HOME.trim());
  }
  return path.join(OS.homedir(), ".codex");
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return asObject(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

function readCodexOAuthCredentials(payload: Record<string, unknown> | null): CodexOAuthCredentials | null {
  const auth = payload as CodexAuthPayload | null;
  const tokens = asObject(auth?.tokens);
  const accessToken = readString(tokens?.access_token);
  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken: readString(tokens?.refresh_token),
    accountId: readString(tokens?.account_id),
  };
}

function readCodexPlanLabel(value: unknown): string | null {
  const planType = readString(value)?.toLowerCase();
  switch (planType) {
    case "guest":
    case "free":
      return "ChatGPT Free";
    case "go":
      return "ChatGPT Go";
    case "plus":
    case "prolite":
      return "ChatGPT Plus";
    case "pro":
      return "ChatGPT Pro";
    case "team":
      return "ChatGPT Team";
    case "business":
      return "ChatGPT Business";
    case "enterprise":
      return "ChatGPT Enterprise";
    case "edu":
    case "education":
    case "k12":
    case "quorum":
      return "ChatGPT Edu";
    default:
      return null;
  }
}

function mergeIdentity(
  primary: ProviderUsageIdentity,
  fallback: ProviderUsageIdentity,
): ProviderUsageIdentity {
  return {
    accountLabel: primary.accountLabel ?? fallback.accountLabel,
    authLabel: primary.authLabel ?? fallback.authLabel,
  };
}

function toOAuthIdentity(payload: Record<string, unknown> | null): ProviderUsageIdentity {
  return {
    accountLabel: readCodexPlanLabel(payload?.plan_type),
    authLabel: readString(payload?.email),
  };
}

async function resolveCodexUsageUrl(configPath: string): Promise<string> {
  let baseUrl = "https://chatgpt.com/backend-api/";
  try {
    const config = await fs.readFile(configPath, "utf8");
    const match = config.match(/^\s*chatgpt_base_url\s*=\s*["']?([^"'\n]+)["']?/m);
    if (match?.[1]?.trim()) {
      baseUrl = match[1].trim();
    }
  } catch {}

  const normalized = baseUrl.replace(/\/+$/, "");
  const baseWithBackend =
    (normalized.startsWith("https://chatgpt.com") ||
      normalized.startsWith("https://chat.openai.com")) &&
    !normalized.includes("/backend-api")
      ? `${normalized}/backend-api`
      : normalized;
  return `${baseWithBackend}${baseWithBackend.includes("/backend-api") ? "/wham/usage" : "/api/codex/usage"}`;
}

async function fetchCodexOAuthUsage(input: {
  readonly credentials: CodexOAuthCredentials;
  readonly configPath: string;
  readonly fetchFn: typeof fetch;
}): Promise<Record<string, unknown>> {
  const url = await resolveCodexUsageUrl(input.configPath);
  const response = await input.fetchFn(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.credentials.accessToken}`,
      "User-Agent": "capycode-server",
      ...(input.credentials.accountId ? { "ChatGPT-Account-Id": input.credentials.accountId } : {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Codex OAuth usage request failed with HTTP ${response.status}${
        detail.trim().length > 0 ? `: ${detail.trim()}` : ""
      }`,
    );
  }

  return (asObject((await response.json()) as CodexOAuthUsageResponse) ?? {}) as Record<string, unknown>;
}

export async function probeCodexLimits(input: CodexLimitsProbeInput): Promise<CodexLimitsProbeResult> {
  const snapshot = await (input.probeDiscovery ?? probeCodexDiscovery)(input);
  const discoveredIdentity = toIdentity(snapshot);
  const appServerLimits = normalizeCodexRateWindows(snapshot.rateLimits, {
    stale: false,
    source: "codex-app-server",
  });

  if (appServerLimits.length > 0) {
    return {
      identity: discoveredIdentity,
      limits: appServerLimits,
    };
  }

  const codexHome = resolveCodexHome(input.homePath);
  const authPath = input.authPath ?? path.join(codexHome, "auth.json");
  const configPath = input.configPath ?? path.join(codexHome, "config.toml");
  const credentials = readCodexOAuthCredentials(await readJsonFile(authPath));
  if (!credentials) {
    return {
      identity: discoveredIdentity,
      limits: [],
    };
  }

  const oauthPayload = await fetchCodexOAuthUsage({
    credentials,
    configPath,
    fetchFn: input.fetchFn ?? fetch,
  });

  return {
    identity: mergeIdentity(toOAuthIdentity(oauthPayload), discoveredIdentity),
    limits: normalizeCodexRateWindows(oauthPayload, {
      stale: false,
      source: "codex-oauth-api",
    }),
  };
}
