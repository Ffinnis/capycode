import { WORKSPACE_TERMINAL_TAB_ID } from "~/workspaceDockStore";

export function getWorkspaceTerminalSurfaceState(params: {
  terminalSurfaceOpen: boolean;
  terminalTabOpen: boolean;
  activeTab: string;
}) {
  const mounted = params.terminalSurfaceOpen && params.terminalTabOpen;

  return {
    mounted,
    active: mounted && params.activeTab === WORKSPACE_TERMINAL_TAB_ID,
  };
}
