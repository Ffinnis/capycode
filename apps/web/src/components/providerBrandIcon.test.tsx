import { describe, expect, it } from "vitest";

import { getProviderBrandIcon } from "./providerBrandIcon";
import { ClaudeAI, CursorIcon, OpenAI, OpenCodeIcon } from "./Icons";

describe("getProviderBrandIcon", () => {
  it("returns the OpenAI icon for codex", () => {
    expect(getProviderBrandIcon("codex")).toBe(OpenAI);
  });

  it("returns the Claude icon for claudeAgent", () => {
    expect(getProviderBrandIcon("claudeAgent")).toBe(ClaudeAI);
  });

  it("returns the Cursor icon for cursor", () => {
    expect(getProviderBrandIcon("cursor")).toBe(CursorIcon);
  });

  it("returns the OpenCode icon for opencode", () => {
    expect(getProviderBrandIcon("opencode")).toBe(OpenCodeIcon);
  });
});
