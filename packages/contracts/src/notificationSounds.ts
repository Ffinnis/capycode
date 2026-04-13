export interface NotificationSoundDescriptor {
  id: string;
  name: string;
  description: string;
  filename: string;
  emoji: string;
  color: string;
  duration?: number;
}

export const BUILT_IN_NOTIFICATION_SOUND_IDS = [
  "shamisen",
  "arcade",
  "ping",
  "quick",
  "doowap",
  "woman",
  "african",
  "afrobeat",
  "edm",
  "comeback",
  "shabala",
] as const;

export type BuiltInNotificationSoundId = (typeof BUILT_IN_NOTIFICATION_SOUND_IDS)[number];
export type NotificationSoundId = BuiltInNotificationSoundId | "custom";

export const CUSTOM_NOTIFICATION_SOUND_ID = "custom" as const satisfies NotificationSoundId;
export const DEFAULT_NOTIFICATION_SOUND_ID = "arcade" as const satisfies BuiltInNotificationSoundId;
export const DEFAULT_NOTIFICATION_VOLUME = 100;

export const BUILT_IN_NOTIFICATION_SOUNDS = [
  {
    id: "shamisen",
    name: "Shamisen",
    description: "Japanese string instrument",
    filename: "shamisen.mp3",
    emoji: "🪕",
    color: "from-slate-500 to-slate-600",
    duration: 1,
  },
  {
    id: "arcade",
    name: "Arcade",
    description: "Retro game sounds",
    filename: "arcade.mp3",
    emoji: "🕹️",
    color: "from-pink-500 to-red-500",
    duration: 3,
  },
  {
    id: "ping",
    name: "Ping",
    description: "Quick alert tone",
    filename: "ping.mp3",
    emoji: "📍",
    color: "from-teal-400 to-cyan-500",
    duration: 1,
  },
  {
    id: "quick",
    name: "Quick Ping",
    description: "Short & sweet",
    filename: "supersetquick.mp3",
    emoji: "⚡",
    color: "from-yellow-400 to-orange-500",
    duration: 3,
  },
  {
    id: "doowap",
    name: "Doo-Wap",
    description: "Retro vibes",
    filename: "supersetdoowap.mp3",
    emoji: "🎷",
    color: "from-purple-500 to-pink-500",
    duration: 10,
  },
  {
    id: "woman",
    name: "Agent is Done",
    description: "Your agent is done!",
    filename: "agentisdonewoman.mp3",
    emoji: "👩‍💻",
    color: "from-cyan-400 to-blue-500",
    duration: 8,
  },
  {
    id: "african",
    name: "Code Complete",
    description: "World music energy",
    filename: "codecompleteafrican.mp3",
    emoji: "🌍",
    color: "from-amber-500 to-red-500",
    duration: 9,
  },
  {
    id: "afrobeat",
    name: "Afrobeat Code Complete",
    description: "Groovy celebration",
    filename: "codecompleteafrobeat.mp3",
    emoji: "🥁",
    color: "from-green-400 to-emerald-600",
    duration: 9,
  },
  {
    id: "edm",
    name: "Long EDM",
    description: "Bass goes brrrr",
    filename: "codecompleteedm.mp3",
    emoji: "🎧",
    color: "from-violet-500 to-fuchsia-500",
    duration: 56,
  },
  {
    id: "comeback",
    name: "Come Back!",
    description: "Code needs you",
    filename: "comebacktothecode.mp3",
    emoji: "📢",
    color: "from-rose-400 to-red-500",
    duration: 7,
  },
  {
    id: "shabala",
    name: "Shabalaba",
    description: "Ding dong vibes",
    filename: "shabalabadingdong.mp3",
    emoji: "🎉",
    color: "from-indigo-400 to-purple-600",
    duration: 7,
  },
] as const satisfies readonly NotificationSoundDescriptor[];

export function isBuiltInNotificationSoundId(value: string): value is BuiltInNotificationSoundId {
  return BUILT_IN_NOTIFICATION_SOUND_IDS.includes(value as BuiltInNotificationSoundId);
}

export function isNotificationSoundId(value: string): value is NotificationSoundId {
  return value === CUSTOM_NOTIFICATION_SOUND_ID || isBuiltInNotificationSoundId(value);
}

export function getNotificationSoundById(id: BuiltInNotificationSoundId): NotificationSoundDescriptor {
  const sound = BUILT_IN_NOTIFICATION_SOUNDS.find((entry) => entry.id === id);
  if (!sound) {
    throw new Error(`Unknown notification sound: ${id}`);
  }
  return sound;
}
