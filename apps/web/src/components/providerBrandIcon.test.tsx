import { describe, expect, it } from "vitest";

import { getProviderBrandIcon } from "./providerBrandIcon";
import { ClaudeAI, OpenAI } from "./Icons";

describe("getProviderBrandIcon", () => {
  it("returns the OpenAI icon for codex", () => {
    expect(getProviderBrandIcon("codex")).toBe(OpenAI);
  });

  it("returns the Claude icon for claudeAgent", () => {
    expect(getProviderBrandIcon("claudeAgent")).toBe(ClaudeAI);
  });
});
