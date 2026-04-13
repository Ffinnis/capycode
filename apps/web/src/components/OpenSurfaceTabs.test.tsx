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
});
