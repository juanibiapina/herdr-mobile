// What you can do to one session: details, interrupt, keep, kill, remove.
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { fleet } from "../fleet-store";
import { herdrLabels } from "../herdr-app";
import type { Session } from "../hc/fleet";
import { ago, sessionTitle, shortPath } from "./session-display";
import { Sheet, SheetAction } from "./Sheet";
import { colors } from "./theme";

export function SessionActions({ session, onClose }: { session: Session | null; onClose: () => void }) {
  const t = session?.terminal;
  const live = t?.state === "live";

  const call = async (method: string, params: object = {}) => {
    const route = session && fleet.route(session.key);
    if (!route) return Alert.alert("Not connected", "This session's machine is offline.");
    try {
      return await route.conn.call(method, { terminal: route.address, ...params });
    } catch (e) {
      Alert.alert("It did not work", e instanceof Error ? e.message : String(e));
    }
  };

  const run = (fn: () => unknown) => () => {
    onClose();
    void fn();
  };

  return (
    <Sheet visible={!!session} onClose={onClose}>
      {session && t && (
        <>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>
              {sessionTitle(session)}
            </Text>
            <Text style={styles.meta}>
              {session.machine} · {session.address} · {live ? `started ${ago(t.created_ms)} ago` : `exited${t.exit_code != null ? ` (${t.exit_code})` : ""}`}
            </Text>
            <Text style={styles.meta} numberOfLines={2}>
              {(t.template ? `template ${t.template} · ` : "") + (t.argv.join(" ") || "shell")}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {shortPath(t.foreground?.cwd || t.cwd)}
              {t.foreground?.name ? ` · now ${t.foreground.name}` : ""}
            </Text>
          </View>
          {live && (
            <SheetAction
              label="Interrupt"
              detail="Press its stop key (esc for agents, ctrl+c otherwise)"
              onPress={run(async () => {
                const r = await call("terminal.interrupt");
                if (r?.outcome) Alert.alert("Interrupted", `Pressed ${r.key}: ${r.outcome}`);
              })}
            />
          )}
          {live && (
            <SheetAction
              label={t.keep ? "Stop keeping it" : "Keep it alive"}
              detail={t.keep ? "If its program is lost, the terminal ends" : "If its program is lost, a shell takes its place"}
              onPress={run(() => call("terminal.keep", { keep: !t.keep }))}
            />
          )}
          {live && !t.labels?.["herdr.space"] && (
            <SheetAction
              label="Show in Herdr desktop app"
              detail="Give it a tab in the space for its folder"
              onPress={run(async () => {
                const target = fleet.targetOf(session.key);
                if (!target) return Alert.alert("Not connected", "This session's machine is offline.");
                await call("terminal.label", { labels: await herdrLabels(fleet, target, t.foreground?.cwd || t.cwd) });
              })}
            />
          )}
          <SheetAction
            label="Copy output"
            detail="The screen and up to 1000 lines of history"
            onPress={run(async () => {
              const r = await call("terminal.read", { lines: 1000 });
              if (typeof r?.text !== "string") return;
              // Drop the screen's empty rows and trailing spaces.
              const text = r.text.split("\n").map((l: string) => l.trimEnd()).join("\n").replace(/^\n+|\n+$/g, "");
              await Clipboard.setStringAsync(text + "\n");
            })}
          />
          <SheetAction label="Copy address" detail={`${session.machine}/${session.address.split("/").pop()}`} onPress={run(() => Clipboard.setStringAsync(session.address))} />
          {live ? (
            <SheetAction
              label="Kill"
              detail="End its program"
              danger
              onPress={run(() =>
                Alert.alert(`Kill ${sessionTitle(session)}?`, "Its program ends. This cannot be undone.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Kill", style: "destructive", onPress: () => void call("terminal.kill") },
                ]),
              )}
            />
          ) : (
            <SheetAction
              label="Remove"
              detail="Forget this finished session and its output"
              danger
              onPress={run(async () => {
                await call("terminal.rm");
                if (router.canGoBack()) router.back();
              })}
            />
          )}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 14, paddingBottom: 10, gap: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, marginBottom: 4 },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13, fontFamily: "monospace" },
});
