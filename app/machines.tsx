import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { fleet, setMachines, useFleet, useMachines } from "../src/fleet-store";
import type { MachineConfig } from "../src/hc/fleet";
import { phonePublicKey } from "../src/ssh/ssh-transport";
import { hostKeys } from "../src/storage";
import { Button } from "../src/ui/Button";
import { Dot } from "../src/ui/Dot";
import { Cell, Row, Section } from "../src/ui/Group";
import { useKeyboardHeight } from "../src/ui/keyboard";
import { explainError, linkColor } from "../src/ui/machine-display";
import { TextField } from "../src/ui/TextField";
import { colors, fonts, radius, space } from "../src/ui/theme";

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
      {links.length > 0 && (
        <Section>
          {links.map((l) => {
            const m = l.config;
            const address = `${m.user}@${m.host}${m.port !== 22 ? `:${m.port}` : ""}`;
            const seen = l.machines.length > 0 ? ` · sees ${l.machines.map((x) => `${x.name} (${x.state})`).join(", ")}` : "";
            return (
              <View key={m.id}>
                <Row
                  label={m.name}
                  left={<Dot color={linkColor(l.state)} size={10} />}
                  hint={l.state === "connected" ? `${address}\nherdr-core ${l.version} · core “${l.core?.name}”${seen}` : address}
                >
                  <Pressable onPress={() => remove(m)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${m.name}`}>
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                </Row>
                {l.state !== "connected" && l.error && (
                  <View style={styles.problem}>
                    <Text style={styles.error}>{explainError(l.error, m)}</Text>
                    {l.error.includes("HOST_KEY_CHANGED") && <Button variant="secondary" title="Trust its new host key" onPress={() => void trustNewKey(m)} />}
                  </View>
                )}
              </View>
            );
          })}
        </Section>
      )}

      {adding ? (
        <AddMachine
          onCancel={() => setAdding(false)}
          onAdd={async (m) => {
            await setMachines([...machines, m]);
            setAdding(false);
          }}
        />
      ) : (
        <Button title="Add a machine" onPress={() => setAdding(true)} />
      )}

      <Section title="This phone's SSH key">
        <Cell>
          <Text style={styles.muted}>Add it to ~/.ssh/authorized_keys on each machine. The phone runs herdr-core there over SSH.</Text>
          <Text selectable style={styles.key}>
            {publicKey ?? "…"}
          </Text>
          {publicKey?.startsWith("ssh-") && (
            <View style={styles.actions}>
              <Button variant="secondary" title="Copy" onPress={() => void Clipboard.setStringAsync(publicKey)} style={styles.flex} />
              <Button variant="secondary" title="Share" onPress={() => void Share.share({ message: publicKey })} style={styles.flex} />
            </View>
          )}
        </Cell>
      </Section>
    </ScrollView>
  );
}

function AddMachine({ onAdd, onCancel }: { onAdd: (m: MachineConfig) => void; onCancel: () => void }) {
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [name, setName] = useState("");
  const ready = !!host.trim() && !!user.trim() && Number(port) > 0;

  return (
    <Section title="Add a machine">
      <Cell>
        <Field label="Host" value={host} onChange={setHost} placeholder="server or 100.64.0.1" />
        <Field label="User" value={user} onChange={setUser} placeholder="your user" />
        <Field label="Port" value={port} onChange={setPort} keyboardType="number-pad" />
        <Field label="Name (optional)" value={name} onChange={setName} placeholder={host || "server"} />
        <View style={styles.actions}>
          <Button variant="secondary" title="Cancel" onPress={onCancel} />
          <Button
            title="Add"
            disabled={!ready}
            style={styles.flex}
            onPress={() =>
              onAdd({
                id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                name: name.trim() || host.trim(),
                host: host.trim(),
                user: user.trim(),
                port: Number(port),
              })
            }
          />
        </View>
      </Cell>
    </Section>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; keyboardType?: "number-pad" }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextField inset value={props.value} onChangeText={props.onChange} placeholder={props.placeholder} keyboardType={props.keyboardType} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.xl },
  muted: { color: colors.muted, fontSize: 13 },
  error: { color: colors.blocked, fontSize: 13 },
  problem: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm },
  remove: { color: colors.blocked, fontSize: 14 },
  key: { color: colors.text, fontFamily: fonts.mono, fontSize: 12, backgroundColor: colors.bg, padding: space.md - 2, borderRadius: radius.sm + 2 },
  actions: { flexDirection: "row", gap: space.md - 2, marginTop: space.xs },
  flex: { flex: 1 },
  field: { gap: space.xs },
  label: { color: colors.muted, fontSize: 12 },
});
