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
});
