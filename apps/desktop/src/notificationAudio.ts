import type { ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { copyFile, rename, unlink } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";

import {
  BUILT_IN_NOTIFICATION_SOUNDS,
  CUSTOM_NOTIFICATION_SOUND_ID,
  DEFAULT_NOTIFICATION_SOUND_ID,
  DEFAULT_NOTIFICATION_VOLUME,
  type ClientCustomNotificationSound,
  type NotificationSoundId,
  getNotificationSoundById,
} from "@capycode/contracts";

const CUSTOM_NOTIFICATION_SOUND_FILE_STEM = "notification-custom";
const MAX_CUSTOM_NOTIFICATION_SOUND_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg"]);
const PACKAGED_APP_ARCHIVE_SEGMENT = `${sep}app.asar${sep}`;
const BUNDLED_NOTIFICATION_SOUND_CACHE_DIR = "bundled";

interface PlaySoundCallbacks {
  onComplete?: () => void;
  isCanceled?: () => boolean;
  onProcessChange?: (process: ChildProcess) => void;
}

export function resolveSoundPlayerExecutable(input: {
  command: string;
  candidates: readonly string[];
  fileExists?: (path: string) => boolean;
}): string {
  const fileExists = input.fileExists ?? existsSync;
  for (const candidate of input.candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return input.command;
}

export function clampNotificationVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_NOTIFICATION_VOLUME;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function playSoundFile(
  soundPath: string,
  volume: number = DEFAULT_NOTIFICATION_VOLUME,
  callbacks?: PlaySoundCallbacks,
): ChildProcess | null {
  if (!existsSync(soundPath)) {
    return null;
  }

  const clampedVolume = clampNotificationVolume(volume);
  const volumeDecimal = clampedVolume / 100;

  if (process.platform === "darwin") {
    const afplayCommand = resolveSoundPlayerExecutable({
      command: "afplay",
      candidates: ["/usr/bin/afplay"],
    });
    return execFile(afplayCommand, ["-v", volumeDecimal.toString(), soundPath], () =>
      callbacks?.onComplete?.(),
    );
  }

  if (process.platform === "linux") {
    const paplayCommand = resolveSoundPlayerExecutable({
      command: "paplay",
      candidates: ["/usr/bin/paplay", "/bin/paplay"],
    });
    const paVolume = Math.round(volumeDecimal * 65536);
    return execFile(paplayCommand, ["--volume", paVolume.toString(), soundPath], (error) => {
      if (error) {
        if (callbacks?.isCanceled?.()) {
          callbacks?.onComplete?.();
          return;
        }
        if (clampedVolume === 0) {
          callbacks?.onComplete?.();
          return;
        }
        const aplayCommand = resolveSoundPlayerExecutable({
          command: "aplay",
          candidates: ["/usr/bin/aplay", "/bin/aplay"],
        });
        const fallback = execFile(aplayCommand, [soundPath], () => callbacks?.onComplete?.());
        callbacks?.onProcessChange?.(fallback);
        return;
      }
      callbacks?.onComplete?.();
    });
  }

  callbacks?.onComplete?.();
  return null;
}

export function getCustomNotificationSoundsDir(stateDir: string): string {
  return join(stateDir, "notification-sounds");
}

function getBundledNotificationSoundsDir(stateDir: string): string {
  return join(getCustomNotificationSoundsDir(stateDir), BUNDLED_NOTIFICATION_SOUND_CACHE_DIR);
}

function ensureCustomNotificationSoundsDir(stateDir: string): void {
  mkdirSync(getCustomNotificationSoundsDir(stateDir), { recursive: true });
}

function isPackagedArchivePath(filePath: string): boolean {
  return filePath.includes(PACKAGED_APP_ARCHIVE_SEGMENT);
}

function isBundledPlaybackSoundFresh(sourcePath: string, playbackPath: string): boolean {
  if (!existsSync(playbackPath)) {
    return false;
  }

  try {
    const sourceStat = statSync(sourcePath);
    const playbackStat = statSync(playbackPath);
    return playbackStat.isFile() && playbackStat.mtimeMs >= sourceStat.mtimeMs;
  } catch {
    return false;
  }
}

export function ensureExternalPlaybackSoundPath(input: {
  stateDir: string;
  soundPath: string;
}): string {
  if (!isPackagedArchivePath(input.soundPath)) {
    return input.soundPath;
  }

  const bundledSoundsDir = getBundledNotificationSoundsDir(input.stateDir);
  try {
    mkdirSync(bundledSoundsDir, { recursive: true });
  } catch {
    return input.soundPath;
  }

  const playbackPath = join(bundledSoundsDir, basename(input.soundPath));
  if (!isBundledPlaybackSoundFresh(input.soundPath, playbackPath)) {
    try {
      copyFileSync(input.soundPath, playbackPath);
    } catch {
      return input.soundPath;
    }
  }

  return playbackPath;
}

function isAllowedAudioExtension(filePath: string): boolean {
  return ALLOWED_AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function sanitizeDisplayName(filename: string): string {
  const stripped = filename.replace(/\.[^/.]+$/, "").trim();
  if (!stripped) {
    return "Custom Audio";
  }
  return stripped.slice(0, 80);
}

function normalizePathForComparison(filePath: string): string {
  const resolved = resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function removeExistingCustomNotificationSounds(stateDir: string): void {
  const soundsDir = getCustomNotificationSoundsDir(stateDir);
  if (!existsSync(soundsDir)) {
    return;
  }

  for (const entry of readdirSync(soundsDir)) {
    if (
      entry.startsWith(`${CUSTOM_NOTIFICATION_SOUND_FILE_STEM}.`) &&
      isAllowedAudioExtension(entry)
    ) {
      unlinkSync(join(soundsDir, entry));
    }
  }
}

export function resolveCustomNotificationSoundPath(
  stateDir: string,
  customSound: ClientCustomNotificationSound | null,
): string | null {
  if (!customSound?.storedFilename) {
    return null;
  }

  const soundPath = join(getCustomNotificationSoundsDir(stateDir), customSound.storedFilename);
  return existsSync(soundPath) ? soundPath : null;
}

export function resolveNotificationSoundPath(input: {
  stateDir: string;
  soundId: NotificationSoundId;
  customSound: ClientCustomNotificationSound | null;
  resolveResourcePath: (relativePath: string) => string | null;
}): string | null {
  if (input.soundId === CUSTOM_NOTIFICATION_SOUND_ID) {
    return (
      resolveCustomNotificationSoundPath(input.stateDir, input.customSound) ??
      resolveNotificationSoundPath({
        ...input,
        soundId: DEFAULT_NOTIFICATION_SOUND_ID,
      })
    );
  }

  const sound = getNotificationSoundById(input.soundId);
  return input.resolveResourcePath(join("notification-sounds", sound.filename));
}

export async function importCustomNotificationSoundFromPath(input: {
  stateDir: string;
  sourcePath: string;
}): Promise<ClientCustomNotificationSound> {
  const sourceExtension = extname(input.sourcePath).toLowerCase();
  if (!isAllowedAudioExtension(input.sourcePath)) {
    throw new Error("Only .mp3, .wav, and .ogg files are supported.");
  }

  const sourceStat = statSync(input.sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error("Selected path is not a file.");
  }
  if (sourceStat.size > MAX_CUSTOM_NOTIFICATION_SOUND_SIZE_BYTES) {
    throw new Error("Audio file is too large. Maximum size is 20MB.");
  }

  ensureCustomNotificationSoundsDir(input.stateDir);

  const soundsDir = getCustomNotificationSoundsDir(input.stateDir);
  const destinationFilename = `${CUSTOM_NOTIFICATION_SOUND_FILE_STEM}${sourceExtension}`;
  const destinationPath = join(soundsDir, destinationFilename);
  const tempPath = join(soundsDir, `.tmp-${randomUUID()}${sourceExtension}`);

  if (
    normalizePathForComparison(input.sourcePath) === normalizePathForComparison(destinationPath)
  ) {
    return {
      name: sanitizeDisplayName(basename(input.sourcePath)),
      storedFilename: destinationFilename,
      importedAt: new Date().toISOString(),
    };
  }

  try {
    await copyFile(input.sourcePath, tempPath);
    removeExistingCustomNotificationSounds(input.stateDir);
    await rename(tempPath, destinationPath);
  } catch (error) {
    if (existsSync(tempPath)) {
      try {
        await unlink(tempPath);
      } catch {
        // Best effort cleanup only.
      }
    }
    throw error;
  }

  try {
    chmodSync(destinationPath, 0o600);
  } catch {
    // Best effort only.
  }

  return {
    name: sanitizeDisplayName(basename(input.sourcePath)),
    storedFilename: destinationFilename,
    importedAt: new Date().toISOString(),
  };
}

export class NotificationSoundPreviewController {
  private currentSession: {
    id: number;
    process: ChildProcess | null;
  } | null = null;

  private nextSessionId = 0;

  stop(): void {
    if (!this.currentSession) {
      return;
    }
    if (this.currentSession.process) {
      this.currentSession.process.kill("SIGKILL");
    }
    this.currentSession = null;
  }

  play(soundPath: string, volume: number = DEFAULT_NOTIFICATION_VOLUME): void {
    this.stop();

    const sessionId = this.nextSessionId++;
    this.currentSession = { id: sessionId, process: null };

    const process = playSoundFile(soundPath, volume, {
      isCanceled: () => this.currentSession?.id !== sessionId,
      onComplete: () => {
        if (this.currentSession?.id === sessionId) {
          this.currentSession = null;
        }
      },
      onProcessChange: (nextProcess) => {
        if (this.currentSession?.id === sessionId) {
          this.currentSession = { id: sessionId, process: nextProcess };
        }
      },
    });

    if (!this.currentSession || this.currentSession.id !== sessionId) {
      return;
    }
    this.currentSession.process = process;
  }
}

export function getNotificationSoundDuration(soundId: NotificationSoundId): number | null {
  if (soundId === CUSTOM_NOTIFICATION_SOUND_ID) {
    return null;
  }
  return BUILT_IN_NOTIFICATION_SOUNDS.find((sound) => sound.id === soundId)?.duration ?? null;
}
