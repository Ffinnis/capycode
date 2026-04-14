import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

  it("refreshes stale bundled copies when the packaged source sound changes", () => {
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
    writeFileSync(sourcePath, "original-audio");

    const firstPlaybackPath = ensureExternalPlaybackSoundPath({
      stateDir,
      soundPath: sourcePath,
    });
    expect(readFileSync(firstPlaybackPath, "utf8")).toBe("original-audio");

    writeFileSync(sourcePath, "updated-audio");
    const futureTimestamp = new Date(Date.now() + 10_000);
    utimesSync(sourcePath, futureTimestamp, futureTimestamp);

    const refreshedPlaybackPath = ensureExternalPlaybackSoundPath({
      stateDir,
      soundPath: sourcePath,
    });

    expect(refreshedPlaybackPath).toBe(firstPlaybackPath);
    expect(readFileSync(refreshedPlaybackPath, "utf8")).toBe("updated-audio");
  });

  it("falls back to the packaged source path when the bundled cache directory cannot be created", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "capycode-notification-audio-"));
    tempDirs.push(tempDir);

    const stateDir = join(tempDir, "state-file");
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

    writeFileSync(stateDir, "not-a-directory");
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "packaged-audio");

    expect(
      ensureExternalPlaybackSoundPath({
        stateDir,
        soundPath: sourcePath,
      }),
    ).toBe(sourcePath);
  });

  it("falls back to the packaged source path when refreshing the bundled cache fails", () => {
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

    const blockedPlaybackPath = join(stateDir, "notification-sounds", "bundled", "ping.mp3");
    mkdirSync(blockedPlaybackPath, { recursive: true });
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "packaged-audio");

    expect(
      ensureExternalPlaybackSoundPath({
        stateDir,
        soundPath: sourcePath,
      }),
    ).toBe(sourcePath);
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
