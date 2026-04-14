import { ThreadId } from "@capycode/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarThreadProviderIcon } from "./Sidebar";

describe("SidebarThreadProviderIcon", () => {
  it("renders the Codex provider icon", () => {
    const threadId = ThreadId.make("thread-codex");
    const html = renderToStaticMarkup(
      <SidebarThreadProviderIcon provider="codex" threadId={threadId} />,
    );

    expect(html).toContain(`data-testid="thread-provider-icon-${threadId}"`);
    expect(html).toContain("text-muted-foreground/70");
  });

  it("renders the Claude provider icon with the brand tint", () => {
    const threadId = ThreadId.make("thread-claude");
    const html = renderToStaticMarkup(
      <SidebarThreadProviderIcon provider="claudeAgent" threadId={threadId} />,
    );

    expect(html).toContain(`data-testid="thread-provider-icon-${threadId}"`);
    expect(html).toContain("text-[#d97757]");
  });
});
