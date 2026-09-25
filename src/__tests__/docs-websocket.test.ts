// SPDX-License-Identifier: MIT
//
// Content and integrity tests for the WebSocket live-event server documentation (issue #768).
// Asserts that docs/WEBSOCKET.md accurately covers the protocol, message schemas,
// reconnection/fallback contract, port configuration, and serverless vs container deployment
// constraints, and verifies cross-references from README.md, ROADMAP.md, and docs/SSE.md.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const wsDocPath = path.join(root, "docs", "WEBSOCKET.md");
const sseDocPath = path.join(root, "docs", "SSE.md");
const readmePath = path.join(root, "README.md");
const roadmapPath = path.join(root, "ROADMAP.md");

describe("docs/WEBSOCKET.md (WebSocket Live-Event Server Documentation)", () => {
  it("exists and is non-empty", () => {
    expect(existsSync(wsDocPath)).toBe(true);
    const content = readFileSync(wsDocPath, "utf8");
    expect(content.length).toBeGreaterThan(1000);
  });

  const doc = existsSync(wsDocPath) ? readFileSync(wsDocPath, "utf8") : "";

  it("documents RFC 6455 protocol utilities and handshake details", () => {
    expect(doc).toMatch(/RFC 6455/);
    expect(doc).toMatch(/258EAFA5-E914-47DA-95CA-C5AB0DC85B11/);
    expect(doc).toMatch(/Sec-WebSocket-Key/);
    expect(doc).toMatch(/Sec-WebSocket-Accept/);
    expect(doc).toMatch(/101 Switching Protocols/);
    expect(doc).toMatch(/HTTP 426/);
    expect(doc).toMatch(/UPGRADE_REQUIRED/);
  });

  it("documents all RFC 6455 opcodes and frame decoding", () => {
    expect(doc).toMatch(/0x0/); // CONTINUATION
    expect(doc).toMatch(/0x1/); // TEXT
    expect(doc).toMatch(/0x8/); // CLOSE
    expect(doc).toMatch(/0x9/); // PING
    expect(doc).toMatch(/0xa/); // PONG
    expect(doc).toMatch(/FrameDecoder/);
    expect(doc).toMatch(/encodeFrame/);
  });

  it("documents message schemas for connection and payment events", () => {
    expect(doc).toMatch(/"event":\s*"connected"/);
    expect(doc).toMatch(/WebSocket stream connected to emitter contract/);
    expect(doc).toMatch(/"event":\s*"payment:created"/);
    expect(doc).toMatch(/`paymentId`/);
    expect(doc).toMatch(/`status`/);
    expect(doc).toMatch(/`payer`/);
    expect(doc).toMatch(/`payee`/);
    expect(doc).toMatch(/`amount`/);
    expect(doc).toMatch(/`txHash`/);
    expect(doc).toMatch(/deduplication key/i);
  });

  it("documents ping/pong keepalive and heartbeat intervals", () => {
    expect(doc).toMatch(/heartbeat/i);
    expect(doc).toMatch(/30\s*seconds|30000/);
    expect(doc).toMatch(/PING/);
    expect(doc).toMatch(/PONG/);
  });

  it("documents reconnection and fallback contract relative to SSE", () => {
    expect(doc).toMatch(/connectLiveEvents/);
    expect(doc).toMatch(/exponential backoff/i);
    expect(doc).toMatch(/maxReconnectAttempts/);
    expect(doc).toMatch(/maxBackoffMs/);
    expect(doc).toMatch(/dedupWindow/);
    expect(doc).toMatch(/EventSource/);
    expect(doc).toMatch(/\/api\/events/);
  });

  it("documents connection status lifecycle states", () => {
    expect(doc).toMatch(/`connecting`/);
    expect(doc).toMatch(/`live`/);
    expect(doc).toMatch(/`reconnecting`/);
    expect(doc).toMatch(/`fallback`/);
    expect(doc).toMatch(/`offline`/);
  });

  it("documents port and environment variables", () => {
    expect(doc).toMatch(/EVENTS_WS_PORT/);
    expect(doc).toMatch(/NEXT_PUBLIC_EVENTS_WS_PORT/);
    expect(doc).toMatch(/8787/);
    expect(doc).toMatch(/0\.0\.0\.0/);
  });

  it("documents deployment implications: serverless constraints vs container deployments", () => {
    expect(doc).toMatch(/serverless/i);
    expect(doc).toMatch(/AWS Lambda|Vercel/i);
    expect(doc).toMatch(/container/i);
    expect(doc).toMatch(/Docker|Kubernetes|ECS/i);
    expect(doc).toMatch(/Nginx/);
    expect(doc).toMatch(/Upgrade \$http_upgrade/);
  });
});

describe("Cross-references and Roadmap alignment (issue #768)", () => {
  it("is linked from README.md", () => {
    expect(existsSync(readmePath)).toBe(true);
    const readme = readFileSync(readmePath, "utf8");
    expect(readme).toMatch(/docs\/WEBSOCKET\.md/);
  });

  it("ROADMAP.md acknowledges the server-side implementation and clarifies remaining work", () => {
    expect(existsSync(roadmapPath)).toBe(true);
    const roadmap = readFileSync(roadmapPath, "utf8");
    expect(roadmap).toMatch(/docs\/WEBSOCKET\.md/);
    // Should not list it as unstarted without qualification
    expect(roadmap).not.toMatch(/- \[ \] Real-time WebSocket API \(replace SSE polling\)/);
  });

  it("is linked from docs/SSE.md", () => {
    expect(existsSync(sseDocPath)).toBe(true);
    const sseDoc = readFileSync(sseDocPath, "utf8");
    expect(sseDoc).toMatch(/WEBSOCKET\.md/);
  });
});
