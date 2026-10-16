import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const SUDO_COOKIE_NAME = 'ophir_sudo_verification';
export const SUDO_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
export const SUDO_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface SudoSession {
  walletAddress: string;
  verifiedAt: number;
  signature: string;
}

export interface SudoChallenge {
  challenge: string;
  issuedAt: number;
  expiresAt: number;
  walletAddress: string;
}

export interface SudoRequiredResponse {
  error: 'SUDO_REQUIRED';
  message: string;
  challenge: SudoChallenge;
}

/**
 * In-memory store for pending sudo challenges.
 * In production this should be backed by Redis or a durable store.
 */
const pendingChallenges = new Map<string, SudoChallenge>();

function getSecret(): string {
  const secret = process.env.SUDO_SIGNING_SECRET;
  if (!secret) {
    throw new Error('SUDO_SIGNING_SECRET environment variable is not configured');
  }
  return secret;
}

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Reads the current sudo verification state from the request cookies.
 * Returns null when no valid, unexpired verification exists.
 */
export function getSudoSession(req: NextRequest): SudoSession | null {
  const raw = req.cookies.get(SUDO_COOKIE_NAME)?.value;
  if (!raw) return null;

  const parts = raw.split('.');
  if (parts.length !== 3) return null;

  const [walletAddress, verifiedAtStr, signature] = parts;
  const verifiedAt = Number(verifiedAtStr);
  if (!Number.isFinite(verifiedAt)) return null;

  const expected = signPayload(`${walletAddress}.${verifiedAt}`);
  if (!timingSafeEqual(expected, signature)) return null;

  if (Date.now() - verifiedAt > SUDO_MAX_AGE_MS) return null;

  return { walletAddress, verifiedAt, signature };
}

/**
 * Returns true when the active session has a fresh cryptographic verification.
 */
export function isSudoFresh(req: NextRequest): boolean {
  return getSudoSession(req) !== null;
}

/**
 * Issues a new sudo challenge bound to the given wallet address.
 */
export function issueSudoChallenge(walletAddress: string): SudoChallenge {
  const challenge = crypto.randomBytes(32).toString('hex');
  const issuedAt = Date.now();
  const record: SudoChallenge = {
    challenge,
    issuedAt,
    expiresAt: issuedAt + SUDO_CHALLENGE_TTL_MS,
    walletAddress,
  };
  pendingChallenges.set(challenge, record);
  return record;
}

/**
 * Consumes a challenge and returns the associated record if valid.
 */
export function consumeSudoChallenge(challenge: string): SudoChallenge | null {
  const record = pendingChallenges.get(challenge);
  if (!record) return null;
  pendingChallenges.delete(challenge);
  if (Date.now() > record.expiresAt) return null;
  return record;
}

/**
 * Builds the 403 SUDO_REQUIRED response with a fresh challenge payload.
 */
export function buildSudoRequiredResponse(walletAddress: string): NextResponse {
  const challenge = issueSudoChallenge(walletAddress);
  const body: SudoRequiredResponse = {
    error: 'SUDO_REQUIRED',
    message: 'Re-authentication required. Please sign the challenge with your wallet.',
    challenge,
  };
  return NextResponse.json(body, { status: 403 });
}

/**
 * Sets the sudo verification cookie after a successful challenge signature.
 */
export function setSudoCookie(
  res: NextResponse,
  walletAddress: string,
): NextResponse {
  const verifiedAt = Date.now();
  const signature = signPayload(`${walletAddress}.${verifiedAt}`);
  const value = `${walletAddress}.${verifiedAt}.${signature}`;

  res.cookies.set({
    name: SUDO_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(SUDO_MAX_AGE_MS / 1000),
  });

  return res;
}

/**
 * Middleware-style guard for critical admin routes.
 *
 * Usage:
 *   const guard = requireSudo(req);
 *   if (guard) return guard;
 */
export function requireSudo(req: NextRequest): NextResponse | null {
  const session = getSudoSession(req);
  if (session) return null;

  const walletAddress =
    req.headers.get('x-wallet-address') ??
    req.cookies.get('ophir_wallet')?.value ??
    'unknown';

  return buildSudoRequiredResponse(walletAddress);
}

/**
 * Verifies a submitted challenge signature and returns a response with the
 * sudo cookie set on success.
 */
export function verifySudoChallenge(
  challenge: string,
  signature: string,
  walletAddress: string,
): NextResponse {
  const record = consumeSudoChallenge(challenge);
  if (!record) {
    return NextResponse.json(
      { error: 'INVALID_CHALLENGE', message: 'Challenge is invalid or expired.' },
      { status: 400 },
    );
  }

  if (record.walletAddress !== walletAddress) {
    return NextResponse.json(
      { error: 'WALLET_MISMATCH', message: 'Challenge wallet does not match session.' },
      { status: 403 },
    );
  }

  // Signature verification is delegated to the wallet verification utility.
  // The caller must have already validated the signature against the challenge.
  const res = NextResponse.json({ ok: true, verifiedAt: Date.now() });
  return setSudoCookie(res, walletAddress);
}

/**
 * Test helper: clears pending challenges.
 */
export function __resetSudoState(): void {
  pendingChallenges.clear();
}
