import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, PlayIcon, PlusIcon, SquareIcon, Volume2Icon } from "lucide-react";

import {
  BUILT_IN_NOTIFICATION_SOUNDS,
  CUSTOM_NOTIFICATION_SOUND_ID,
  DEFAULT_NOTIFICATION_SOUND_ID,
  DEFAULT_UNIFIED_SETTINGS,
  type NotificationSoundId,
} from "@capycode/contracts";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { cn } from "../../lib/utils";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

const VOLUME_LEVELS = [
  { value: 20, label: "Quiet" },
  { value: 40, label: "Low" },
  { value: 60, label: "Medium" },
  { value: 80, label: "High" },
  { value: 100, label: "Maximum" },
] as const;

type NotificationSoundOption = {
  id: NotificationSoundId;
  name: string;
  description: string;
  color: string;
  emoji: string;
  duration?: number;
};

function getVolumeLabel(volume: number): string {
  return VOLUME_LEVELS.find((entry) => entry.value === volume)?.label ?? "Custom";
}

function formatDuration(seconds: number | undefined): string | null {
  return typeof seconds === "number" ? `${seconds}s` : null;
}

function NotificationSoundCard(props: {
  sound: NotificationSoundOption;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onTogglePlay: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect();
        }
      }}
      className={cn(
        "relative overflow-hidden rounded-xl border-2 text-left transition-colors",
        props.isSelected ? "border-primary ring-2 ring-primary/20" : "border-border",
      )}
    >
      <div
        className={cn(
          "relative flex h-24 items-center justify-center bg-linear-to-br text-4xl",
          props.sound.color,
        )}
      >
        <span>{props.sound.emoji}</span>
        {formatDuration(props.sound.duration) ? (
          <span className="absolute right-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-xs text-muted-foreground">
            {formatDuration(props.sound.duration)}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={props.isPlaying ? "Stop preview" : "Play preview"}
          onClick={(event) => {
            event.stopPropagation();
            props.onTogglePlay();
          }}
          className={cn(
            "absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
            props.isPlaying
              ? "border-destructive bg-destructive text-destructive-foreground"
              : "border-border bg-background text-foreground hover:bg-accent",
          )}
        >
          {props.isPlaying ? (
            <SquareIcon className="h-4 w-4 fill-current" />
          ) : (
            <PlayIcon className="ml-0.5 h-4 w-4 fill-current" />
          )}
        </button>
      </div>
      <div className="flex items-center justify-between border-t bg-card p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{props.sound.name}</div>
          <div className="truncate text-xs text-muted-foreground">{props.sound.description}</div>
        </div>
        {props.isSelected ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
            <CheckIcon className="h-3 w-3 text-primary-foreground" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function NotificationsSettings() {
  const settings = useSettings((state) => ({
    notificationSoundsMuted: state.notificationSoundsMuted,
    notificationVolume: state.notificationVolume,
    selectedNotificationSoundId: state.selectedNotificationSoundId,
    customNotificationSound: state.customNotificationSound,
  }));
  const { updateSettings } = useUpdateSettings();
  const [playingId, setPlayingId] = useState<NotificationSoundId | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bridge = window.desktopBridge;
  const soundOptions = useMemo<ReadonlyArray<NotificationSoundOption>>(() => {
    const customOption: NotificationSoundOption[] = settings.customNotificationSound
      ? [
          {
            id: CUSTOM_NOTIFICATION_SOUND_ID,
            name: settings.customNotificationSound.name,
            description: "Imported from your local machine",
            emoji: "🎚️",
            color: "from-slate-400 to-slate-600",
          },
        ]
      : [];
    return [...BUILT_IN_NOTIFICATION_SOUNDS, ...customOption];
  }, [settings.customNotificationSound]);

  const resetPreviewState = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setPlayingId(null);
  }, []);

  useEffect(() => {
    return () => {
      resetPreviewState();
      void bridge?.stopNotificationSoundPreview();
    };
  }, [bridge, resetPreviewState]);

  const handleTogglePreview = useCallback(
    async (soundId: NotificationSoundId) => {
      if (!bridge) {
        return;
      }

      if (playingId === soundId) {
        await bridge.stopNotificationSoundPreview();
        resetPreviewState();
        return;
      }

      await bridge.stopNotificationSoundPreview();
      resetPreviewState();

      try {
        await bridge.previewNotificationSound({
          soundId,
          volume: settings.notificationVolume,
        });
        setPlayingId(soundId);
        const duration = soundOptions.find((sound) => sound.id === soundId)?.duration ?? 5;
        previewTimerRef.current = setTimeout(() => {
          setPlayingId((current) => (current === soundId ? null : current));
          previewTimerRef.current = null;
        }, Math.max(1500, duration * 1000 + 500));
      } catch (error) {
        resetPreviewState();
        toastManager.add({
          type: "error",
          title: "Unable to preview sound",
          description: error instanceof Error ? error.message : "Preview failed.",
        });
      }
    },
    [bridge, playingId, resetPreviewState, settings.notificationVolume, soundOptions],
  );

  const handleImportCustomAudio = useCallback(async () => {
    if (!bridge) {
      return;
    }
    try {
      const result = await bridge.importCustomNotificationSound();
      if (result.canceled || !result.sound) {
        return;
      }
      updateSettings({
        customNotificationSound: result.sound,
        selectedNotificationSoundId: CUSTOM_NOTIFICATION_SOUND_ID,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to import audio",
        description: error instanceof Error ? error.message : "Import failed.",
      });
    }
  }, [bridge, updateSettings]);

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Notifications"
        headerAction={
          <Button size="sm" variant="outline" onClick={() => void handleImportCustomAudio()}>
            <PlusIcon className="h-4 w-4" />
            Add Custom Audio
          </Button>
        }
      >
        <SettingsRow
          title="Notification sounds"
          description="Play a sound when an agent finishes or needs your attention."
          resetAction={
            settings.notificationSoundsMuted !==
            DEFAULT_UNIFIED_SETTINGS.notificationSoundsMuted ? (
              <SettingResetButton
                label="notification sounds"
                onClick={() => updateSettings({ notificationSoundsMuted: false })}
              />
            ) : null
          }
          control={
            <div className="flex items-center gap-3">
              <Label htmlFor="notification-sounds" className="text-sm">
                {settings.notificationSoundsMuted ? "Off" : "On"}
              </Label>
              <Switch
                id="notification-sounds"
                checked={!settings.notificationSoundsMuted}
                onCheckedChange={(enabled) =>
                  updateSettings({ notificationSoundsMuted: !enabled })
                }
              />
            </div>
          }
        />
        <SettingsRow
          title="Volume"
          description="Choose how loud Capycode notification sounds should be."
          resetAction={
            settings.notificationVolume !== DEFAULT_UNIFIED_SETTINGS.notificationVolume ? (
              <SettingResetButton
                label="notification volume"
                onClick={() =>
                  updateSettings({
                    notificationVolume: DEFAULT_UNIFIED_SETTINGS.notificationVolume,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.notificationVolume.toString()}
              onValueChange={(value) => {
                if (value === null) {
                  return;
                }
                updateSettings({ notificationVolume: Number.parseInt(value, 10) });
              }}
            >
              <SelectTrigger id="notification-volume" className="w-[200px]">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <Volume2Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      {getVolumeLabel(settings.notificationVolume)}
                    </span>
                    <span className="text-muted-foreground">
                      ({settings.notificationVolume}%)
                    </span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {VOLUME_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value.toString()}>
                    {level.label} ({level.value}%)
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="Sound"
          description="Select a preset or imported audio file. Use play to preview before saving."
          resetAction={
            settings.selectedNotificationSoundId !== DEFAULT_NOTIFICATION_SOUND_ID ? (
              <SettingResetButton
                label="notification sound"
                onClick={() =>
                  updateSettings({
                    selectedNotificationSoundId: DEFAULT_NOTIFICATION_SOUND_ID,
                  })
                }
              />
            ) : null
          }
        >
          <div className="grid gap-3 px-4 pb-4 pt-4 sm:grid-cols-2 sm:px-5">
            {soundOptions.map((sound) => (
              <NotificationSoundCard
                key={sound.id}
                sound={sound}
                isSelected={settings.selectedNotificationSoundId === sound.id}
                isPlaying={playingId === sound.id}
                onSelect={() =>
                  updateSettings({
                    selectedNotificationSoundId: sound.id,
                  })
                }
                onTogglePlay={() => void handleTogglePreview(sound.id)}
              />
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
