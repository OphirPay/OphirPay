// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  computeAcceptKey,
  encodeFrame,
  FrameDecoder,
  OPCODE_TEXT,
  OPCODE_CLOSE,
  OPCODE_PING,
} from "@/lib/events/ws-protocol";

describe("computeAcceptKey", () => {
  it("matches the RFC 6455 example vector", () => {
    expect(computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe(
      "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
    );
  });
});

describe("encodeFrame", () => {
  it("encodes a short text frame", () => {
    const frame = encodeFrame(OPCODE_TEXT, "hello");
    expect(frame[0]).toBe(0x81); // FIN + text
    expect(frame[1]).toBe(5); // payload length
    expect(frame.subarray(2).toString("utf8")).toBe("hello");
  });

  it("encodes a 126-encoded payload (16-bit length)", () => {
    const payload = "a".repeat(126);
    const frame = encodeFrame(OPCODE_TEXT, payload);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(126);
    expect(frame.length).toBe(4 + 126);
  });

  it("encodes a 127-encoded payload (64-bit length)", () => {
    const payload = Buffer.alloc(70000, 0x61);
    const frame = encodeFrame(OPCODE_TEXT, payload);
    expect(frame[1]).toBe(127);
    expect(frame.readUInt32BE(2)).toBe(0); // high 32 bits
    expect(frame.readUInt32BE(6)).toBe(70000); // low 32 bits
    expect(frame.length).toBe(10 + 70000);
  });

  it("encodes ping and close opcodes", () => {
    expect(encodeFrame(OPCODE_PING, "").readUInt8(0) & 0x0f).toBe(OPCODE_PING);
    expect(encodeFrame(OPCODE_CLOSE, "").readUInt8(0) & 0x0f).toBe(OPCODE_CLOSE);
  });
});

describe("FrameDecoder", () => {
  it("decodes an unmasked server-style frame", () => {
    const decoder = new FrameDecoder();
    const frames = decoder.push(encodeFrame(OPCODE_TEXT, "ping"));
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(OPCODE_TEXT);
    expect(frames[0].payload.toString("utf8")).toBe("ping");
  });

  it("decodes a masked client frame", () => {
    // Client frames MUST be masked (RFC 6455 §5.1).
    const payload = Buffer.from("masked payload", "utf8");
    const maskKey = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload[i] ^ maskKey[i % 4];
    }
    const header = Buffer.from([0x81, 0x80 | payload.length, ...maskKey]);
    const decoder = new FrameDecoder();
    const frames = decoder.push(Buffer.concat([header, masked]));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.toString("utf8")).toBe("masked payload");
  });

  it("handles frames split across chunks", () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame(OPCODE_TEXT, "split frame");
    expect(decoder.push(frame.subarray(0, 3))).toHaveLength(0);
    expect(decoder.push(frame.subarray(3, 7))).toHaveLength(0);
    const frames = decoder.push(frame.subarray(7));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.toString("utf8")).toBe("split frame");
  });

  it("merges continuation fragments into a single message", () => {
    const decoder = new FrameDecoder();
    const part1 = encodeFrame(OPCODE_TEXT, "Par", false); // FIN unset
    const part2 = encodeFrame(0x0, "is", true); // continuation, FIN set
    expect(decoder.push(part1)).toHaveLength(0);
    const frames = decoder.push(part2);
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(OPCODE_TEXT);
    expect(frames[0].payload.toString("utf8")).toBe("Paris");
  });

  it("decodes a masked 126-length frame", () => {
    const payload = Buffer.alloc(200, 0x62);
    const maskKey = Buffer.from([0x11, 0x22, 0x33, 0x44]);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload[i] ^ maskKey[i % 4];
    }
    const header = Buffer.from([0x81, 0x80 | 126, 0x00, 200, ...maskKey]);
    const decoder = new FrameDecoder();
    const frames = decoder.push(Buffer.concat([header, masked]));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload).toEqual(payload);
  });

  it("decodes ping/pong/close opcodes", () => {
    const decoder = new FrameDecoder();
    const frames = decoder.push(encodeFrame(OPCODE_PING, "probe"));
    expect(frames[0].opcode).toBe(OPCODE_PING);
    expect(frames[0].payload.toString("utf8")).toBe("probe");
  });
});
