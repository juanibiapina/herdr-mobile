// herdr-core framed mode: [channel u32 LE][kind u8][len u32 LE][payload].
// See schema/README.md in herdrdev/herdr-core.
import { concat } from "./bytes";

export const DATA = 0;
export const CREDIT = 1;
export const CLOSE = 2;
export const RESIZE = 3;
export const FOCUS = 4;
export const FACTS = 5;

const HEADER = 9;

export type Frame = { channel: number; kind: number; payload: Uint8Array };

export function encodeFrame(channel: number, kind: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const out = new Uint8Array(HEADER + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, channel, true);
  out[4] = kind;
  view.setUint32(5, payload.length, true);
  out.set(payload, HEADER);
  return out;
}

export function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

export function resizePayload(cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(4);
  const view = new DataView(out.buffer);
  view.setUint16(0, cols, true);
  view.setUint16(2, rows, true);
  return out;
}

/** Collects bytes as they arrive and yields whole frames. */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array();

  push(bytes: Uint8Array): Frame[] {
    this.buf = concat(this.buf, bytes);
    const frames: Frame[] = [];
    let at = 0;
    while (this.buf.length - at >= HEADER) {
      const view = new DataView(this.buf.buffer, this.buf.byteOffset + at, HEADER);
      const len = view.getUint32(5, true);
      if (this.buf.length - at < HEADER + len) break;
      frames.push({
        channel: view.getUint32(0, true),
        kind: this.buf[at + 4],
        payload: this.buf.slice(at + HEADER, at + HEADER + len),
      });
      at += HEADER + len;
    }
    this.buf = this.buf.slice(at);
    return frames;
  }
}
