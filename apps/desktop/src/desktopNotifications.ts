import type { DesktopNotificationAction, DesktopNotificationRequest } from "@capycode/contracts";
import type { Notification as ElectronNotification } from "electron";
import { Notification } from "electron";

interface TrackedDesktopNotification {
  notification: ElectronNotification;
  action: DesktopNotificationAction;
}

export class DesktopNotificationManager {
  private readonly activeByKey = new Map<string, TrackedDesktopNotification>();

  constructor(
    private readonly input: {
      readonly onAction: (action: DesktopNotificationAction) => void;
      readonly playSound: () => void;
    },
  ) {}

  show(request: DesktopNotificationRequest): void {
    if (!Notification.isSupported()) {
      return;
    }

    const workspaceLabel = request.workspaceName ?? request.projectName;
    const notification = new Notification({
      title:
        request.kind === "attention"
          ? `Input Needed — ${workspaceLabel}`
          : `Agent Complete — ${workspaceLabel}`,
      body:
        request.kind === "attention"
          ? `"${request.threadTitle}" needs your attention`
          : `"${request.threadTitle}" has finished its task`,
      silent: true,
    });

    const previous = this.activeByKey.get(request.dedupeKey);
    if (previous) {
      previous.notification.close();
    }

    const action: DesktopNotificationAction = {
      environmentId: request.environmentId,
      threadId: request.threadId,
    };

    this.activeByKey.set(request.dedupeKey, { notification, action });

    notification.on("click", () => {
      this.activeByKey.delete(request.dedupeKey);
      this.input.onAction(action);
    });
    notification.on("close", () => {
      const current = this.activeByKey.get(request.dedupeKey);
      if (current?.notification === notification) {
        this.activeByKey.delete(request.dedupeKey);
      }
    });

    this.input.playSound();
    notification.show();
  }
  dispose(): void {
    for (const tracked of this.activeByKey.values()) {
      tracked.notification.close();
    }
    this.activeByKey.clear();
  }
}
