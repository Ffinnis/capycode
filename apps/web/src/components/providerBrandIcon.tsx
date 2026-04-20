import type { ProviderKind } from "@capycode/contracts";

import { ClaudeAI, CursorIcon, type Icon, OpenAI, OpenCodeIcon } from "./Icons";

const PROVIDER_BRAND_ICON: Record<ProviderKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
};

export function getProviderBrandIcon(provider: ProviderKind): Icon {
  return PROVIDER_BRAND_ICON[provider];
}

export function getProviderBrandIconClassName(
  provider: ProviderKind,
  fallbackClassName: string,
): string {
  if (provider === "claudeAgent") {
    return `${fallbackClassName} text-[#d97757]`;
  }
  return fallbackClassName;
}
