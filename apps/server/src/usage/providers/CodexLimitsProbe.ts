import type { ProviderRateWindow, ProviderUsageIdentity } from "@capycode/contracts";
import { codexAuthSubLabel, type CodexAccountSnapshot } from "../../provider/codexAccount";
import type { CodexDiscoverySnapshot } from "../../provider/codexAppServer";
import { probeCodexDiscovery } from "../../provider/codexAppServer";
import { normalizeCodexRateWindows } from "../normalize/rateWindows";

export interface CodexLimitsProbeResult {
  readonly identity: ProviderUsageIdentity;
  readonly limits: ReadonlyArray<ProviderRateWindow>;
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

export async function probeCodexLimits(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly cwd: string;
}): Promise<CodexLimitsProbeResult> {
  const snapshot = await probeCodexDiscovery(input);
  return {
    identity: toIdentity(snapshot),
    limits: normalizeCodexRateWindows(snapshot.rateLimits),
  };
}
