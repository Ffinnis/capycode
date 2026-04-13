import type { ProviderKind } from "@capycode/contracts";

import { ClaudeAI, type Icon, OpenAI } from "./Icons";

const PROVIDER_BRAND_ICON: Record<ProviderKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
};

export function getProviderBrandIcon(provider: ProviderKind): Icon {
  return PROVIDER_BRAND_ICON[provider];
}

export function getProviderBrandIconClassName(
  provider: ProviderKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" ? `${fallbackClassName} text-[#d97757]` : fallbackClassName;
}
