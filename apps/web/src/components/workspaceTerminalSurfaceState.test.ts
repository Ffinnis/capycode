import { describe, expect, it } from "vitest";

import { getWorkspaceTerminalSurfaceState } from "./workspaceTerminalSurfaceState";
import { WORKSPACE_TERMINAL_TAB_ID } from "~/workspaceDockStore";

describe("getWorkspaceTerminalSurfaceState", () => {
  it("keeps the detached terminal mounted while another workspace tab is active", () => {
    expect(
      getWorkspaceTerminalSurfaceState({
        terminalSurfaceOpen: true,
        terminalTabOpen: true,
        activeTab: "src/app.ts",
      }),
    ).toEqual({
      mounted: true,
      active: false,
    });
  });

  it("marks the detached terminal active when the terminal tab is selected", () => {
    expect(
      getWorkspaceTerminalSurfaceState({
        terminalSurfaceOpen: true,
        terminalTabOpen: true,
        activeTab: WORKSPACE_TERMINAL_TAB_ID,
      }),
    ).toEqual({
      mounted: true,
      active: true,
    });
  });

  it("does not mount the detached terminal once its route or tab is closed", () => {
    expect(
      getWorkspaceTerminalSurfaceState({
        terminalSurfaceOpen: false,
        terminalTabOpen: true,
        activeTab: WORKSPACE_TERMINAL_TAB_ID,
      }),
    ).toEqual({
      mounted: false,
      active: false,
    });

    expect(
      getWorkspaceTerminalSurfaceState({
        terminalSurfaceOpen: true,
        terminalTabOpen: false,
        activeTab: WORKSPACE_TERMINAL_TAB_ID,
      }),
    ).toEqual({
      mounted: false,
      active: false,
    });
  });
});
