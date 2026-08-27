// SPDX-License-Identifier: MIT

/**
 * Minimal RFC 6455 WebSocket protocol utilities (server side).
 *
 * Implements exactly the subset a server needs: the upgrade handshake
 * accept-key computation, frame encoding for server→client messages
 * (text/ping/close), and a stateful decoder for client→server frames
 * (masking + fragmentation + partial-buffer handling). Kept dependency-free
 * and fully unit-tested.
 */

import { createHash } from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const OPCODE_CONTINUATION = 0x0;
export const OPCODE_TEXT = 0x1;
export const OPCODE_CLOSE = 0x8;
export const OPCODE_PING = 0x9;
export const OPCODE_PONG = 0xa;

/**
 * Compute the `Sec-WebSocket-Accept` header value for the client's
 * `Sec-WebSocket-Key` (RFC 6455 §4.2.2).
 */
export function computeAcceptKey(secWebSocketKey: string): string {
  return createHash("sha1")
    .update(secWebSocketKey + WS_GUID)
    .digest("base64");
}

export interface WsFrame {
  /** Frame opcode (text/close/ping/pong — continuations are merged). */
  opcode: number;
  /** Unmasked payload. */
  payload: Buffer;
}

/**
 * Encode a server→client frame (never masked — masking is client-only).
 */
export function encodeFrame(
  opcode: number,
  payload: Buffer | string,
  fin = true
): Buffer {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const len = data.length;

  // Worst case header: 2 bytes + 8 length bytes.
  const header = Buffer.alloc(10);
  let offset = 0;
  header[offset++] = (fin ? 0x80 : 0x00) | opcode;

  if (len < 126) {
    header[offset++] = len;
  } else if (len < 65536) {
    header[offset++] = 126;
    header.writeUInt16BE(len, offset);
    offset += 2;
  } else {
    header[offset++] = 127;
    // Write the 64-bit length as two 32-bit halves (safe for our sizes).
    header.writeUInt32BE(Math.floor(len / 0x100000000), offset);
    header.writeUInt32BE(len >>> 0, offset + 4);
    offset += 8;
  }

  return Buffer.concat([header.subarray(0, offset), data]);
}

/**
 * Stateful decoder for client→server frames. Handles partial chunks (a frame
 * may arrive split across `data` events), masked payloads (mandatory from
 * clients), and continuation fragments (merged into one frame on `fin`).
 */
export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  private fragmentOpcode: number | null = null;
  private fragmentParts: Buffer[] = [];

  push(chunk: Buffer): WsFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: WsFrame[] = [];

    for (;;) {
      if (this.buffer.length < 2) break;

      const b0 = this.buffer[0];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (this.buffer[1] & 0x80) !== 0;
      let payloadLen = this.buffer[1] & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) break;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) break;
        const high = this.buffer.readUInt32BE(2);
        const low = this.buffer.readUInt32BE(6);
        payloadLen = high * 0x100000000 + low;
        offset = 10;
      }

      let maskKey: Buffer | null = null;
      if (masked) {
        if (this.buffer.length < offset + 4) break;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLen) break;

      const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLen));
      if (maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }
      this.buffer = Buffer.from(this.buffer.subarray(offset + payloadLen));

      // Continuation handling: buffer fragments until fin, then emit one
      // frame with the original data opcode.
      if (opcode === OPCODE_CONTINUATION) {
        if (this.fragmentOpcode === null) continue; // orphan — drop
        this.fragmentParts.push(payload);
        if (fin) {
          const merged = Buffer.concat(this.fragmentParts);
          frames.push({ opcode: this.fragmentOpcode, payload: merged });
          this.fragmentOpcode = null;
          this.fragmentParts = [];
        }
      } else if (fin) {
        frames.push({ opcode, payload });
      } else {
        // Start of a fragmented message.
        this.fragmentOpcode = opcode;
        this.fragmentParts = [payload];
      }
    }

    return frames;
  }
}
