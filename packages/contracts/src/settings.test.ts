import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { ClientSettingsSchema, DEFAULT_CLIENT_SETTINGS } from "./settings";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

describe("ClientSettingsSchema", () => {
  it("defaults diff panel mode to iterations", () => {
    const parsed = decodeClientSettings({});

    expect(parsed.diffPanelMode).toBe("iterations");
    expect(DEFAULT_CLIENT_SETTINGS.diffPanelMode).toBe("iterations");
  });

  it("defaults notification settings", () => {
    const parsed = decodeClientSettings({});

    expect(parsed.notificationSoundsMuted).toBe(false);
    expect(parsed.notificationVolume).toBe(100);
    expect(parsed.selectedNotificationSoundId).toBe("arcade");
    expect(parsed.customNotificationSound).toBeNull();
  });

  it("defaults file editor auto-save to false", () => {
    const parsed = decodeClientSettings({});

    expect(parsed.fileEditorAutoSave).toBe(false);
    expect(DEFAULT_CLIENT_SETTINGS.fileEditorAutoSave).toBe(false);
  });
});
