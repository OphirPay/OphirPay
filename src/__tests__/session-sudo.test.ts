// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  SUDO_COOKIE_NAME,
  SUDO_TTL_MS,
  buildSudoChallenge,
  buildSudoClearCookie,
  buildSudoCookie,
  createSudoGrant,
  enforceSudo,
  hasFreshSudo,
  parseSudoGrant,
  readSudoGrant,
  sudoRequiredResponse,
  verifySudoProof,
} from "@/lib/session-sudo";
import { challengeMessage, createChallengeToken } from "@/lib/challenge";

const PUBKEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_PUBKEY =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function requestWithCookie(cookie: string): Request {
  return new Request("https://ophirpay.test/api/rbac", {
    method: "POST",
    headers: { cookie },
  });
}

describe("sudo grant lifecycle", () => {
  it("mints and parses a grant bound to the public key", () => {
    const now = 1_000_000;
    const token = createSudoGrant(PUBKEY, now);
    const payload = parseSudoGrant(token, now);
    expect(payload?.pk).toBe(PUBKEY);
    expect(payload?.iat).toBe(now);
    expect(payload?.exp).toBe(now + SUDO_TTL_MS);
  });

  it("rejects an expired grant", () => {
    const now = 1_000_000;
    const token = createSudoGrant(PUBKEY, now);
    expect(parseSudoGrant(token, now + SUDO_TTL_MS + 1)).toBeNull();
  });

  it("rejects a tampered grant", () => {
    const token = createSudoGrant(PUBKEY, 1_000_000);
    const [body, sig] = token.split(".");
    // Flip the signature and, separately, the body.
    const flippedSig = `${sig![0] === "A" ? "B" : "A"}${sig!.slice(1)}`;
    expect(parseSudoGrant(`${body}.${flippedSig}`, 1_000_000)).toBeNull();
    // A different body with the original signature fails the HMAC check.
    const forgedBody = Buffer.from(
      JSON.stringify({ pk: PUBKEY, iat: 0, exp: 9_999_999_999_999 })
    ).toString("base64url");
    expect(parseSudoGrant(`${forgedBody}.${sig}`, 1_000_000)).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    for (const token of ["", "no-dot", "a.b.c", ".", "body."]) {
      expect(parseSudoGrant(token, 1_000_000)).toBeNull();
    }
  });

  it("reads the grant from the request cookie", () => {
    const token = createSudoGrant(PUBKEY, 1_000_000);
    const req = requestWithCookie(`other=1; ${SUDO_COOKIE_NAME}=${token}`);
    expect(readSudoGrant(req, 1_000_000)?.pk).toBe(PUBKEY);
  });

  it("only treats a grant for the same key as fresh", () => {
    const token = createSudoGrant(PUBKEY, 1_000_000);
    const req = requestWithCookie(`${SUDO_COOKIE_NAME}=${token}`);
    expect(hasFreshSudo(req, PUBKEY, 1_000_000)).toBe(true);
    // A grant minted for wallet A must not authorize an action as wallet B.
    expect(hasFreshSudo(req, OTHER_PUBKEY, 1_000_000)).toBe(false);
  });

  it("builds an HttpOnly cookie and a clearing cookie", () => {
    const cookie = buildSudoCookie(PUBKEY, 1_000_000);
    expect(cookie).toContain(`${SUDO_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain(`Max-Age=${Math.floor(SUDO_TTL_MS / 1000)}`);
    expect(buildSudoClearCookie()).toContain("Max-Age=0");
  });
});

describe("enforceSudo", () => {
  it("returns a 403 SUDO_REQUIRED with a challenge when no grant is present", async () => {
    const req = requestWithCookie("");
    const res = enforceSudo(req, { userId: "u1", publicKey: PUBKEY }, { nowMs: 1_000_000 });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as {
      error: { code: string; details: { challenge: string; message: string; expiresInSeconds: number } };
    };
    expect(body.error.code).toBe("SUDO_REQUIRED");
    expect(typeof body.error.details.challenge).toBe("string");
    expect(body.error.details.message).toContain(PUBKEY);
    expect(body.error.details.expiresInSeconds).toBe(900);
  });

  it("allows the request when a fresh grant for the key is present", () => {
    const token = createSudoGrant(PUBKEY, 1_000_000);
    const req = requestWithCookie(`${SUDO_COOKIE_NAME}=${token}`);
    expect(
      enforceSudo(req, { userId: "u1", publicKey: PUBKEY }, { nowMs: 1_000_000 })
    ).toBeNull();
  });

  it("allows the request when the proof was verified on this request", () => {
    const req = requestWithCookie("");
    expect(
      enforceSudo(
        req,
        { userId: "u1", publicKey: PUBKEY },
        { verifiedNow: true, nowMs: 1_000_000 }
      )
    ).toBeNull();
  });

  it("rejects an expired grant", () => {
    const now = 1_000_000;
    const token = createSudoGrant(PUBKEY, now);
    const req = requestWithCookie(`${SUDO_COOKIE_NAME}=${token}`);
    const res = enforceSudo(
      req,
      { userId: "u1", publicKey: PUBKEY },
      { nowMs: now + SUDO_TTL_MS + 1 }
    );
    expect(res?.status).toBe(403);
  });

  it("refuses API-key callers (no wallet to re-verify)", async () => {
    const req = requestWithCookie("");
    const res = enforceSudo(req, { userId: "u1", keyId: "k1" });
    expect(res?.status).toBe(403);
    const body = (await res!.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("sudoRequiredResponse", () => {
  it("omits the challenge payload when there is no public key", async () => {
    const res = sudoRequiredResponse(null);
    const body = (await res.json()) as { error: { code: string; details?: unknown } };
    expect(body.error.code).toBe("SUDO_REQUIRED");
    expect(body.error.details).toBeUndefined();
  });

  it("buildSudoChallenge embeds the public key in the signed message", () => {
    const challenge = buildSudoChallenge(PUBKEY);
    expect(challenge.message).toContain(PUBKEY);
    expect(challenge.challenge.split(".")).toHaveLength(2);
  });
});

describe("verifySudoProof", () => {
  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  function sign(message: string): string {
    return keypair.sign(Buffer.from(message, "utf8")).toString("base64");
  }

  it("accepts a signature over a challenge minted for the key", () => {
    const challenge = createChallengeToken(publicKey);
    const message = challengeMessage(publicKey, challenge);
    expect(verifySudoProof(publicKey, challenge, sign(message))).toBe(true);
  });

  it("rejects a signature from a different key", () => {
    const challenge = createChallengeToken(publicKey);
    const message = challengeMessage(publicKey, challenge);
    const otherKeypair = Keypair.random();
    const badSignature = otherKeypair
      .sign(Buffer.from(message, "utf8"))
      .toString("base64");
    expect(verifySudoProof(publicKey, challenge, badSignature)).toBe(false);
  });

  it("rejects a challenge minted for a different key", () => {
    const otherChallenge = createChallengeToken(OTHER_PUBKEY);
    const message = challengeMessage(OTHER_PUBKEY, otherChallenge);
    expect(verifySudoProof(publicKey, otherChallenge, sign(message))).toBe(false);
  });
});
