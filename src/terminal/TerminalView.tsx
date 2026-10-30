// xterm.js in a WebView, fed by a herdr-core attach stream. Acknowledges bytes
// only after xterm has drawn them, so a slow phone gets a repaint instead of
// an endless backlog.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { toBase64 } from "../hc/bytes";
import type { AttachStream, HcConnection } from "../hc/connection";
import { colors } from "../ui/theme";
import { TERMINAL_HTML } from "./terminal-html.generated";

export type TerminalMode = "fit" | "full";

type Props = {
  conn: HcConnection | null;
  address: string;
  cols: number;
  rows: number;
  /** Changes when a kept terminal restarts with a new program. */
  pid: number | null | undefined;
  mode: TerminalMode;
  fontSize: number;
};

export type TerminalHandle = {
  /** Type raw bytes into the terminal. False when watching only (full size) or not attached. */
  write: (bytes: Uint8Array) => boolean;
};

export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView({ conn, address, cols, rows, pid, mode, fontSize }, ref) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [fitSize, setFitSize] = useState<{ cols: number; rows: number } | null>(null);
  const fitRef = useRef(fitSize);
  fitRef.current = fitSize;
  const stream = useRef<AttachStream | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const pending = useRef<Uint8Array[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    write: (bytes) => {
      if (mode !== "fit" || !stream.current) return false;
      stream.current.write(bytes);
      return true;
    },
  }));

  const post = (msg: object) =>
    web.current?.injectJavaScript(`window.hc && window.hc.receive(${JSON.stringify(msg)}); true;`);

  const flush = () => {
    timer.current = null;
    const chunks = pending.current;
    pending.current = [];
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    if (total) post({ type: "write", data: toBase64(all) });
  };

  const queue = (bytes: Uint8Array) => {
    pending.current.push(bytes);
    if (!timer.current) timer.current = setTimeout(flush, 16);
  };

  useEffect(() => {
    if (!ready) return;
    post({ type: "mode", mode: mode === "fit" ? "fit" : "view", cols, rows });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode]);

  useEffect(() => {
    if (ready) post({ type: "font", size: fontSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fontSize]);

  useEffect(() => {
    if (ready && mode === "full") post({ type: "size", cols, rows });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows]);

  const haveFit = fitSize !== null;
  useEffect(() => {
    if (!ready || !conn) return;
    if (mode === "fit" && !fitRef.current) return;
    let cancelled = false;
    let mine: AttachStream | null = null;
    pending.current = [];
    post({ type: "reset" });
    setEnded(null);
    const size = mode === "fit" ? fitRef.current! : { cols, rows };
    conn
      .attach(
        { terminal: address, cols: size.cols, rows: size.rows, observe: mode === "full", history: 2000 },
        {
          onData: (bytes, s) => {
            if (cancelled) return;
            stream.current = s;
            queue(bytes);
          },
          onClose: (r) => {
            if (cancelled) return;
            stream.current = null;
            setEnded(r?.reason ? describe(r) : "closed");
          },
        },
      )
      .then(
        (s) => {
          mine = s;
          if (cancelled) s.close();
          else stream.current = s;
        },
        (e) => !cancelled && setEnded(e.message),
      );
    return () => {
      cancelled = true;
      mine?.close();
      stream.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, conn, address, mode, haveFit, pid]);

  const onMessage = (raw: string) => {
    const msg = JSON.parse(raw);
    if (msg.type === "ready") setReady(true);
    else if (msg.type === "written") stream.current?.ack(msg.bytes);
    else if (msg.type === "size") {
      setFitSize({ cols: msg.cols, rows: msg.rows });
      if (mode === "fit") stream.current?.resize(msg.cols, msg.rows);
    }
  };

  return (
    <View style={styles.wrap}>
      <WebView
        ref={web}
        source={{ html: TERMINAL_HTML }}
        originWhitelist={["*"]}
        onMessage={(e) => onMessage(e.nativeEvent.data)}
        style={styles.web}
        setBuiltInZoomControls={mode === "full"}
        setDisplayZoomControls={false}
        overScrollMode="never"
        textZoom={100}
        keyboardDisplayRequiresUserAction
        hideKeyboardAccessoryView
        onContentProcessDidTerminate={() => setReady(false)}
      />
      {(!conn || ended) && (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText}>{!conn ? "Reconnecting…" : ended}</Text>
        </View>
      )}
    </View>
  );
});

function describe(r: { reason?: string; exit_code?: number | null }): string {
  if (r.reason === "exited") return `Exited${r.exit_code != null ? ` with code ${r.exit_code}` : ""}`;
  return r.reason ?? "closed";
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  web: { flex: 1, backgroundColor: colors.bg },
  notice: { position: "absolute", top: 8, alignSelf: "center", backgroundColor: colors.surfaceHigh, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  noticeText: { color: colors.text, fontSize: 13 },
});
