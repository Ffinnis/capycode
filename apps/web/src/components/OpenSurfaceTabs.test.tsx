import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OpenSurfaceTabs } from "./OpenSurfaceTabs";
import { WORKSPACE_TERMINAL_TAB_ID } from "~/workspaceDockStore";

describe("OpenSurfaceTabs", () => {
  it("renders the terminal workspace tab when requested", () => {
    const markup = renderToStaticMarkup(
      <OpenSurfaceTabs
        openFileTabs={["src/app.ts"]}
        activeTab={WORKSPACE_TERMINAL_TAB_ID}
        resolvedTheme="dark"
        showTerminalTab
        onSelectChat={() => {}}
        onSelectTerminal={() => {}}
        onSelectFile={() => {}}
        onCloseFile={() => {}}
      />,
    );

    expect(markup).toContain("Terminal");
    expect(markup).toContain("app.ts");
  });

  it("includes unsaved state text inside the focusable file tab button", () => {
    const markup = renderToStaticMarkup(
      <OpenSurfaceTabs
        openFileTabs={["src/app.ts"]}
        activeTab="src/app.ts"
        dirtyFileTabs={["src/app.ts"]}
        resolvedTheme="dark"
        showTerminalTab={false}
        onSelectChat={() => {}}
        onSelectTerminal={() => {}}
        onSelectFile={() => {}}
        onCloseFile={() => {}}
      />,
    );

    expect(markup).toContain("src/app.ts has unsaved changes");
    expect(markup).toContain("sr-only");
    expect(markup).toContain('aria-hidden="true"');
  });
});
