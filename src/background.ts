// Keeps the app process (and so its SSH lines) alive while it is closed,
// through an Android foreground service with a quiet, ongoing notification.
import { HcSsh } from "../modules/hc-ssh";
import { fleet } from "./fleet-store";
import { getSettings, onSettings } from "./settings";
import { needsYou } from "./ui/session-display";

let running = false;
let last = "";
let timer: ReturnType<typeof setTimeout> | null = null;

function summary(): { title: string; text: string } | null {
  const { links, sessions } = fleet.snapshot();
  if (links.length === 0) return null;
  const live = sessions.filter((s) => s.terminal.state === "live");
  const need = live.filter(needsYou).length;
  const working = live.filter((s) => s.terminal.status?.state === "working").length;
  const up = links.filter((l) => l.state === "connected").length;
  const parts = [need && `${need} need you`, working && `${working} working`, `${live.length} running`].filter(Boolean);
  return {
    title: `Watching ${up}/${links.length} machine${links.length === 1 ? "" : "s"}`,
    text: parts.join(" · "),
  };
}

function sync() {
  timer = null;
  const s = getSettings().background ? summary() : null;
  try {
    if (!s) {
      if (running) HcSsh.stopWatching();
      running = false;
      last = "";
      return;
    }
    const next = s.title + "|" + s.text;
    if (running && next === last) return;
    HcSsh.startWatching(s.title, s.text);
    running = true;
    last = next;
  } catch {
    // An older build without the service: notifications work while the app is open.
  }
}

const schedule = () => {
  if (!timer) timer = setTimeout(sync, 1500);
};

export function startBackgroundWatching() {
  fleet.subscribe(schedule);
  onSettings(schedule);
  schedule();
}
