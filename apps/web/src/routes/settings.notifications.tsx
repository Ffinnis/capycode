import { createFileRoute, redirect } from "@tanstack/react-router";

import { NotificationsSettings } from "../components/settings/NotificationsSettings";
import { isElectron } from "../env";

export const Route = createFileRoute("/settings/notifications")({
  beforeLoad: () => {
    if (!isElectron) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: NotificationsSettings,
});
