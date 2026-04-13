import type { ProviderKind } from "@capycode/contracts";

import { ClaudeAI, type Icon, OpenAI } from "./Icons";

const PROVIDER_BRAND_ICON: Record<ProviderKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
};

export function getProviderBrandIcon(provider: ProviderKind): Icon {
  return PROVIDER_BRAND_ICON[provider];
}
