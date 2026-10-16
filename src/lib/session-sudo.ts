import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const SUDO_COOKIE_NAME = 'ophir_sudo';
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
  action: string;
}

export interface SudoRequiredResponse {
  error: 'SUDO_REQUIRED';
  code: 'SUDO_REQUIRED';
  message: string;
  challenge: SudoChallenge;
}

const challengeStore = new Map<string, SudoChallenge>();

function getSecret(): string {
  const secret = process.env.SUDO_SESSION_SECRET;
  if (!secret) {
    throw new Error('SUDO_SESSION_SECRET environment variable is not configured');
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

export function encodeSudoSession(session: SudoSession): string {
  const payload = JSON.stringify(session);
  const encoded = Buffer.from(payload).toString('base64url');
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

export function decodeSudoSession(token: string | undefined | null): SudoSession | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = signPayload(encoded);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SudoSession;
    if (
      typeof session.walletAddress !== 'string' ||
      typeof session.verifiedAt !== 'number' ||
      typeof session.signature !== 'string'
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function isSudoValid(session: SudoSession | null, now: number = Date.now()): boolean {
  if (!session) return false;
  return now - session.verifiedAt < SUDO_MAX_AGE_MS;
}

export function getSudoSessionFromCookies(): SudoSession | null {
  const store = cookies();
  const token = store.get(SUDO_COOKIE_NAME)?.value;
  return decodeSudoSession(token);
}

export function getSudoSessionFromRequest(req: NextRequest): SudoSession | null {
  const token = req.cookies.get(SUDO_COOKIE_NAME)?.value;
  return decodeSudoSession(token);
}

export function createSudoChallenge(walletAddress: string, action: string): SudoChallenge {
  const now = Date.now();
  const nonce = crypto.randomBytes(24).toString('hex');
  const challenge: SudoChallenge = {
    challenge: `OphirPay sudo re-auth\nwallet:${walletAddress}\naction:${action}\nnonce:${nonce}\nissued:${now}`,
    issuedAt: now,
    expiresAt: now + SUDO_CHALLENGE_TTL_MS,
    walletAddress,
    action,
  };
  challengeStore.set(nonce, challenge);
  return challenge;
}

export function consumeSudoChallenge(challenge: string): SudoChallenge | null {
  for (const [nonce, stored] of challengeStore.entries()) {
    if (stored.challenge === challenge) {
      challengeStore.delete(nonce);
      if (Date.now() > stored.expiresAt) return null;
      return stored;
    }
  }
  return null;
}

export function buildSudoRequiredResponse(
  walletAddress: string,
  action: string,
): NextResponse<SudoRequiredResponse> {
  const challenge = createSudoChallenge(walletAddress, action);
  return NextResponse.json<SudoRequiredResponse>(
    {
      error: 'SUDO_REQUIRED',
      code: 'SUDO_REQUIRED',
      message: 'Fresh wallet signature required for this administrative action.',
      challenge,
    },
    { status: 403 },
  );
}

export interface SudoGuardResult {
  ok: boolean;
  response?: NextResponse;
  session?: SudoSession;
}

/**
 * Guard critical administrative actions. Requires a valid sudo session whose
 * cryptographic verification is younger than SUDO_MAX_AGE_MS. When missing or
 * stale, returns a 403 SUDO_REQUIRED response with a fresh challenge payload.
 */
export function requireSudo(
  req: NextRequest,
  walletAddress: string | null | undefined,
  action: string,
): SudoGuardResult {
  if (!walletAddress) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Wallet address required.' },
        { status: 401 },
      ),
    };
  }

  const session = getSudoSessionFromRequest(req);
  if (session && session.walletAddress === walletAddress && isSudoValid(session)) {
    return { ok: true, session };
  }

  return {
    ok: false,
    response: buildSudoRequiredResponse(walletAddress, action),
  };
}

export function setSudoCookie(response: NextResponse, session: SudoSession): NextResponse {
  response.cookies.set({
    name: SUDO_COOKIE_NAME,
    value: encodeSudoSession(session),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(SUDO_MAX_AGE_MS / 1000),
  });
  return response;
}
