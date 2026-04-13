import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { settingsRef, updateSettingsSpy, openDiffSpy } = vi.hoisted(() => ({
  settingsRef: {
    current: {
      diffPanelMode: "iterations" as "iterations" | "git",
    },
  },
  updateSettingsSpy: vi.fn(),
  openDiffSpy: vi.fn(),
}));

vi.mock("~/hooks/useSettings", () => ({
  useSettings: vi.fn((selector?: (settings: { diffPanelMode: "iterations" | "git" }) => unknown) =>
    selector ? selector(settingsRef.current) : settingsRef.current,
  ),
  useUpdateSettings: vi.fn(() => ({
    updateSettings: (patch: Partial<typeof settingsRef.current>) => {
      updateSettingsSpy(patch);
      settingsRef.current = {
        ...settingsRef.current,
        ...patch,
      };
    },
  })),
}));

describe("DiffPanelSidebarModeToggle", () => {
  afterEach(() => {
    settingsRef.current = {
      diffPanelMode: "iterations",
    };
    updateSettingsSpy.mockReset();
    openDiffSpy.mockReset();
  });

  it("switches the saved mode and opens the sidebar when closed", async () => {
    const { default: DiffPanelSidebarModeToggle } = await import("./DiffPanelSidebarModeToggle");
    await render(<DiffPanelSidebarModeToggle diffOpen={false} onOpenDiff={openDiffSpy} />);

    await page.getByTestId("diff-sidebar-mode-git").click();

    expect(updateSettingsSpy).toHaveBeenCalledWith({ diffPanelMode: "git" });
    expect(openDiffSpy).toHaveBeenCalledTimes(1);
  });

  it("switches the saved mode without reopening an already open sidebar", async () => {
    settingsRef.current = {
      diffPanelMode: "git",
    };

    const { default: DiffPanelSidebarModeToggle } = await import("./DiffPanelSidebarModeToggle");
    await render(<DiffPanelSidebarModeToggle diffOpen={true} onOpenDiff={openDiffSpy} />);

    await page.getByTestId("diff-sidebar-mode-iterations").click();

    expect(updateSettingsSpy).toHaveBeenCalledWith({ diffPanelMode: "iterations" });
    expect(openDiffSpy).not.toHaveBeenCalled();
  });
});
