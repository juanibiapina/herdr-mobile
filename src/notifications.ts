// A local notification when an agent needs you or finishes a turn, unless you
// are already looking at it.
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { AppState, Platform } from "react-native";
import type { Transition } from "./hc/fleet";
import { fleet } from "./fleet-store";
import { getSettings } from "./settings";
import { sessionTitle } from "./ui/session-display";

let viewing: string | null = null;
export const setViewingSession = (key: string | null) => {
  viewing = key;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function startNotifications() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("agents", {
      name: "Agents",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  // Answer an agent from the notification, without opening the app.
  await Notifications.setNotificationCategoryAsync("agent", [
    {
      identifier: "reply",
      buttonTitle: "Reply",
      textInput: { submitButtonTitle: "Send", placeholder: "Message to the agent" },
      options: { opensAppToForeground: false },
    },
  ]);
  await Notifications.requestPermissionsAsync();

  Notifications.addNotificationResponseReceivedListener((r) => void respond(r));

  fleet.onTransition((t) => void notify(t));
}

async function respond(r: Notifications.NotificationResponse) {
  const key = r.notification.request.content.data?.key;
  if (typeof key !== "string") return;
  if (r.actionIdentifier === "reply") {
    const text = r.userText?.trim();
    const route = fleet.route(key);
    if (text && route) {
      // An explicit answer: deliver it even if the agent is blocked on a question.
      await route.conn.call("terminal.send", { terminal: route.address, text, force: true }).catch(() => {});
    }
    await Notifications.dismissNotificationAsync(r.notification.request.identifier);
    return;
  }
  router.push({ pathname: "/session/[key]", params: { key } });
}

async function notify({ session, kind }: Transition) {
  if (AppState.currentState === "active" && viewing === session.key) return;
  const s = getSettings();
  const wanted = { blocked: s.notifyBlocked, error: s.notifyBlocked, turn: s.notifyTurn, exited: s.notifyExit }[kind];
  if (!wanted) return;
  const msg = session.terminal.status?.msg;
  const body = {
    blocked: msg || "Needs you",
    turn: msg || "Finished its turn",
    error: msg || "Reported an error",
    exited: "Exited",
  }[kind];
  await Notifications.scheduleNotificationAsync({
    identifier: session.key,
    content: {
      title: `${sessionTitle(session)} · ${session.machine}`,
      body,
      data: { key: session.key },
      categoryIdentifier: kind === "exited" ? undefined : "agent",
    },
    trigger: { channelId: "agents" } as Notifications.NotificationTriggerInput,
  });
}
