import { describe, expect, it } from "vitest";

import { resolveSoundPlayerExecutable } from "./notificationAudio";

describe("notificationAudio", () => {
  it("prefers absolute afplay path on macOS", () => {
    expect(
      resolveSoundPlayerExecutable({
        command: "afplay",
        candidates: ["/usr/bin/afplay"],
        fileExists: (path) => path === "/usr/bin/afplay",
      }),
    ).toBe("/usr/bin/afplay");
  });

  it("falls back to the bare command when no absolute path exists", () => {
    expect(
      resolveSoundPlayerExecutable({
        command: "paplay",
        candidates: ["/usr/bin/paplay", "/bin/paplay"],
        fileExists: () => false,
      }),
    ).toBe("paplay");
  });
});
