import * as fs from "node:fs/promises";
import * as OS from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import type { ProviderRateWindow, ProviderUsageIdentity } from "@capycode/contracts";

import { normalizeClaudeRateWindows } from "../normalize/rateWindows";

interface ClaudeOAuthCredentialsPayload {
  readonly claudeAiOauth?: {
    readonly accessToken?: unknown;
    readonly expiresAt?: unknown;
    readonly rateLimitTier?: unknown;
    readonly scopes?: unknown;
    readonly subscriptionType?: unknown;
  };
}

interface ClaudeLocalAccountState {
  readonly oauthAccount?: {
    readonly displayName?: unknown;
    readonly emailAddress?: unknown;
  };
}

interface ClaudeOAuthCredentials {
  readonly accessToken: string;
  readonly rateLimitTier: string | null;
  readonly scopes: ReadonlyArray<string>;
  readonly subscriptionType: string | null;
}

export interface ClaudeLimitsProbeResult {
  readonly identity: ProviderUsageIdentity;
  readonly limits: ReadonlyArray<ProviderRateWindow>;
}

export interface ClaudeLimitsProbeInput {
  readonly credentialsPath?: string;
  readonly fetchFn?: typeof fetch;
  readonly homeDir?: string;
  readonly keychainServiceName?: string;
  readonly platform?: NodeJS.Platform;
  readonly readKeychainSecret?: () => string | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function expandHomePath(homeDir: string, value: string): string {
  return value.startsWith("~") ? path.join(homeDir, value.slice(1)) : value;
}

function defaultCredentialsPath(homeDir: string): string {
  return path.join(homeDir, ".claude", ".credentials.json");
}

function defaultAccountStatePath(homeDir: string): string {
  return path.join(homeDir, ".claude.json");
}

function readClaudeSubscriptionLabel(
  credentials: ClaudeOAuthCredentials | null,
  accountState: ClaudeLocalAccountState | null,
): string | null {
  const subscriptionHint =
    `${credentials?.subscriptionType ?? ""} ${credentials?.rateLimitTier ?? ""}`.toLowerCase();
  if (subscriptionHint.includes("enterprise")) return "Claude Enterprise";
  if (subscriptionHint.includes("team")) return "Claude Team";
  if (subscriptionHint.includes("pro")) return "Claude Pro";
  if (subscriptionHint.includes("max")) return "Claude Max";
  if (accountState?.oauthAccount) return "Claude";
  return null;
}

function toIdentity(
  credentials: ClaudeOAuthCredentials | null,
  accountState: ClaudeLocalAccountState | null,
): ProviderUsageIdentity {
  return {
    accountLabel: readClaudeSubscriptionLabel(credentials, accountState),
    authLabel:
      readString(accountState?.oauthAccount?.emailAddress) ??
      readString(accountState?.oauthAccount?.displayName) ??
      null,
  };
}

function readKeychainSecret(input: { readonly keychainServiceName: string }): string | null {
  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", input.keychainServiceName, "-w"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (result.status !== 0) {
    return null;
  }

  const secret = result.stdout.trim();
  return secret.length > 0 ? secret : null;
}

function parseClaudeOAuthCredentials(raw: string): ClaudeOAuthCredentials | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const payload = asObject(parsed) as ClaudeOAuthCredentialsPayload | null;
  const oauth = asObject(payload?.claudeAiOauth);
  const accessToken = readString(oauth?.accessToken);
  if (!accessToken) {
    return null;
  }

  const scopes = Array.isArray(oauth?.scopes)
    ? oauth.scopes.flatMap((scope) => (typeof scope === "string" ? [scope] : []))
    : [];

  return {
    accessToken,
    rateLimitTier: readString(oauth?.rateLimitTier),
    scopes,
    subscriptionType: readString(oauth?.subscriptionType),
  };
}

async function readClaudeOAuthCredentials(
  input: Required<Pick<ClaudeLimitsProbeInput, "homeDir" | "keychainServiceName" | "platform">> &
    Pick<ClaudeLimitsProbeInput, "credentialsPath" | "readKeychainSecret">,
): Promise<ClaudeOAuthCredentials | null> {
  const readSecret = input.readKeychainSecret ?? (() => readKeychainSecret(input));
  if (input.platform === "darwin") {
    const fromKeychain = parseClaudeOAuthCredentials(readSecret() ?? "");
    if (fromKeychain) {
      return fromKeychain;
    }
  }

  const credentialsPath = expandHomePath(
    input.homeDir,
    input.credentialsPath ?? defaultCredentialsPath(input.homeDir),
  );
  try {
    return parseClaudeOAuthCredentials(await fs.readFile(credentialsPath, "utf8"));
  } catch {
    return null;
  }
}

async function readClaudeAccountState(homeDir: string): Promise<ClaudeLocalAccountState | null> {
  try {
    const raw = await fs.readFile(defaultAccountStatePath(homeDir), "utf8");
    return (JSON.parse(raw) as ClaudeLocalAccountState) ?? null;
  } catch {
    return null;
  }
}

async function fetchClaudeUsage(accessToken: string, fetchFn: typeof fetch): Promise<unknown> {
  const response = await fetchFn("https://api.anthropic.com/api/oauth/usage", {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "claude-code/2.1.0",
      "anthropic-beta": "oauth-2025-04-20",
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Claude OAuth usage request failed with HTTP ${response.status}${
        detail.trim().length > 0 ? `: ${detail.trim()}` : ""
      }`,
    );
  }

  return await response.json();
}

export async function probeClaudeLimits(
  input: ClaudeLimitsProbeInput = {},
): Promise<ClaudeLimitsProbeResult> {
  const homeDir = input.homeDir ?? OS.homedir();
  const accountState = await readClaudeAccountState(homeDir);
  const credentials = await readClaudeOAuthCredentials({
    homeDir,
    keychainServiceName: input.keychainServiceName ?? "Claude Code-credentials",
    platform: input.platform ?? process.platform,
    ...(input.credentialsPath ? { credentialsPath: input.credentialsPath } : {}),
    ...(input.readKeychainSecret ? { readKeychainSecret: input.readKeychainSecret } : {}),
  });
  const identity = toIdentity(credentials, accountState);

  if (!credentials || !credentials.scopes.includes("user:profile")) {
    return {
      identity,
      limits: [],
    };
  }

  const fetchFn = input.fetchFn ?? fetch;
  const usageSnapshot = await fetchClaudeUsage(credentials.accessToken, fetchFn);
  return {
    identity,
    limits: normalizeClaudeRateWindows(usageSnapshot, {
      stale: false,
      source: "claude-oauth-api",
    }),
  };
}
