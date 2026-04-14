import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureExternalPlaybackSoundPath, resolveSoundPlayerExecutable } from "./notificationAudio";

describe("notificationAudio", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

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

  it("copies packaged app sounds out of app.asar for external playback", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "capycode-notification-audio-"));
    tempDirs.push(tempDir);

    const stateDir = join(tempDir, "state");
    const sourcePath = join(
      tempDir,
      "Capycode.app",
      "Contents",
      "Resources",
      "app.asar",
      "apps",
      "desktop",
      "resources",
      "notification-sounds",
      "ping.mp3",
    );

    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "ping-audio");

    const playbackPath = ensureExternalPlaybackSoundPath({
      stateDir,
      soundPath: sourcePath,
    });

    expect(playbackPath).toBe(join(stateDir, "notification-sounds", "bundled", "ping.mp3"));
    expect(readFileSync(playbackPath, "utf8")).toBe("ping-audio");
  });

  it("keeps non-packaged sound paths unchanged", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "capycode-notification-audio-"));
    tempDirs.push(tempDir);

    const soundPath = join(tempDir, "notification-sounds", "custom.mp3");
    mkdirSync(dirname(soundPath), { recursive: true });
    writeFileSync(soundPath, "custom-audio");

    expect(
      ensureExternalPlaybackSoundPath({
        stateDir: join(tempDir, "state"),
        soundPath,
      }),
    ).toBe(soundPath);
  });
});
