import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { fleet, setMachines, useFleet, useMachines } from "../src/fleet-store";
import type { MachineConfig } from "../src/hc/fleet";
import { phonePublicKey } from "../src/ssh/ssh-transport";
import { hostKeys } from "../src/storage";
import { useKeyboardHeight } from "../src/ui/keyboard";
import { explainError } from "../src/ui/connection-error";
import { colors } from "../src/ui/theme";

export default function Machines() {
  const { links } = useFleet();
  const { machines } = useMachines();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const keyboard = useKeyboardHeight();

  useEffect(() => {
    phonePublicKey().then(setPublicKey, (e) => setPublicKey(`Could not create a key: ${e.message}`));
  }, []);

  const remove = (m: MachineConfig) =>
    Alert.alert(`Remove ${m.name}?`, "Its terminals keep running there.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void setMachines(machines.filter((x) => x.id !== m.id)) },
    ]);

  const trustNewKey = async (m: MachineConfig) => {
    await hostKeys.forget(`${m.host}:${m.port}`);
    fleet.reconnect();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: 48 + keyboard }]} keyboardShouldPersistTaps="handled">
      {links.map((l) => {
        const m = l.config;
        const keyChanged = l.error?.includes("HOST_KEY_CHANGED");
        return (
          <View key={m.id} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={[styles.dot, { backgroundColor: l.state === "connected" ? colors.done : l.state === "connecting" ? colors.working : colors.blocked }]} />
              <Text style={styles.name}>{m.name}</Text>
              <Pressable onPress={() => remove(m)} hitSlop={10}>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
            <Text style={styles.muted}>
              {m.user}@{m.host}
              {m.port !== 22 ? `:${m.port}` : ""}
            </Text>
            {l.state === "connected" && (
              <Text style={styles.muted}>
                herdr-core {l.version} · core “{l.core?.name}”
                {l.machines.length > 0 ? ` · sees ${l.machines.map((x) => `${x.name} (${x.state})`).join(", ")}` : ""}
              </Text>
            )}
            {l.state !== "connected" && l.error && <Text style={styles.error}>{explainError(l.error, m)}</Text>}
            {keyChanged && (
              <Pressable style={styles.secondary} onPress={() => void trustNewKey(m)}>
                <Text style={styles.secondaryText}>Trust its new host key</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {adding ? (
        <AddMachine
          onCancel={() => setAdding(false)}
          onAdd={async (m) => {
            await setMachines([...machines, m]);
            setAdding(false);
          }}
        />
      ) : (
        <Pressable style={styles.primary} onPress={() => setAdding(true)}>
          <Text style={styles.primaryText}>Add a machine</Text>
        </Pressable>
      )}

      <View style={[styles.card, { marginTop: 24 }]}>
        <Text style={styles.name}>This phone's SSH key</Text>
        <Text style={styles.muted}>Add it to ~/.ssh/authorized_keys on each machine. The phone runs herdr-core there over SSH.</Text>
        <Text selectable style={styles.key}>
          {publicKey ?? "…"}
        </Text>
        {publicKey?.startsWith("ssh-") && (
          <View style={styles.actions}>
            <Pressable style={styles.secondary} onPress={() => void Clipboard.setStringAsync(publicKey)}>
              <Text style={styles.secondaryText}>Copy</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={() => void Share.share({ message: publicKey })}>
              <Text style={styles.secondaryText}>Share</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function AddMachine({ onAdd, onCancel }: { onAdd: (m: MachineConfig) => void; onCancel: () => void }) {
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [name, setName] = useState("");
  const ready = host.trim() && user.trim() && Number(port) > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.name}>Add a machine</Text>
      <Field label="Host" value={host} onChange={setHost} placeholder="server or 100.64.0.1" />
      <Field label="User" value={user} onChange={setUser} placeholder="your user" />
      <Field label="Port" value={port} onChange={setPort} keyboardType="number-pad" />
      <Field label="Name (optional)" value={name} onChange={setName} placeholder={host || "server"} />
      <View style={styles.actions}>
        <Pressable style={styles.secondary} onPress={onCancel}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.primary, styles.flex, !ready && { opacity: 0.4 }]}
          disabled={!ready}
          onPress={() =>
            onAdd({
              id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
              name: name.trim() || host.trim(),
              host: host.trim(),
              user: user.trim(),
              port: Number(port),
            })
          }
        >
          <Text style={styles.primaryText}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "number-pad";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={props.keyboardType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { color: colors.text, fontSize: 17, fontWeight: "700", flex: 1 },
  muted: { color: colors.muted, fontSize: 13 },
  error: { color: colors.blocked, fontSize: 13 },
  remove: { color: colors.blocked, fontSize: 14 },
  key: { color: colors.text, fontFamily: "monospace", fontSize: 12, backgroundColor: colors.bg, padding: 10, borderRadius: 8 },
  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
  primary: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  primaryText: { color: "#0d1117", fontWeight: "700", fontSize: 15 },
  secondary: { backgroundColor: colors.surfaceHigh, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  secondaryText: { color: colors.text, fontSize: 15 },
  flex: { flex: 1 },
  field: { gap: 4, marginTop: 4 },
  label: { color: colors.muted, fontSize: 12 },
  input: { color: colors.text, backgroundColor: colors.bg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
