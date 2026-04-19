import { DEFAULT_UNIFIED_SETTINGS } from "@capycode/contracts/settings";
import { describe, expect, it } from "vitest";

import { getChangedSettingsRestoreLabels } from "./SettingsPanels";

describe("getChangedSettingsRestoreLabels", () => {
  it("includes file editor auto-save when it differs from the default", () => {
    const labels = getChangedSettingsRestoreLabels({
      theme: "system",
      settings: {
        ...DEFAULT_UNIFIED_SETTINGS,
        fileEditorAutoSave: !DEFAULT_UNIFIED_SETTINGS.fileEditorAutoSave,
      },
      isGitWritingModelDirty: false,
      areProviderSettingsDirty: false,
    });

    expect(labels).toContain("File editor auto-save");
  });

  it("does not include file editor auto-save when it matches the default", () => {
    const labels = getChangedSettingsRestoreLabels({
      theme: "system",
      settings: DEFAULT_UNIFIED_SETTINGS,
      isGitWritingModelDirty: false,
      areProviderSettingsDirty: false,
    });

    expect(labels).not.toContain("File editor auto-save");
  });
});
