import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const SUDO_COOKIE_NAME = 'ophir_sudo_verified_at';
export const SUDO_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const SUDO_CHALLENGE_COOKIE = 'ophir_sudo_challenge';

export interface SudoChallenge {
  challenge: string;
  issuedAt: number;
  expiresAt: number;
  action: string;
}

export interface SudoVerificationResult {
  verified: boolean;
  reason?: 'SUDO_REQUIRED' | 'INVALID_SIGNATURE' | 'EXPIRED_CHALLENGE' | 'MISSING_WALLET';
  challenge?: SudoChallenge;
}

/**
 * Generates a cryptographically random challenge nonce for wallet re-signing.
 */
export function generateChallenge(action: string): SudoChallenge {
  const now = Date.now();
  return {
    challenge: crypto.randomBytes(32).toString('hex'),
    issuedAt: now,
    expiresAt: now + 5 * 60 * 1000, // challenge valid for 5 minutes
    action,
  };
}

/**
 * Reads the last sudo verification timestamp from the session cookie.
 */
export function getLastSudoVerification(req?: NextRequest): number | null {
  const cookieStore = req ? req.cookies : cookies();
  const raw = cookieStore.get(SUDO_COOKIE_NAME)?.value;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Determines whether the current session requires a fresh wallet signature
 * before performing a critical administrative action.
 */
export function requiresSudo(req?: NextRequest): boolean {
  const lastVerified = getLastSudoVerification(req);
  if (lastVerified === null) return true;
  return Date.now() - lastVerified > SUDO_WINDOW_MS;
}

/**
 * Builds the 403 SUDO_REQUIRED response with a challenge payload.
 */
export function buildSudoRequiredResponse(action: string): NextResponse {
  const challenge = generateChallenge(action);
  const res = NextResponse.json(
    {
      error: 'SUDO_REQUIRED',
      message:
        'This action requires fresh wallet re-authentication. Please sign the challenge with Freighter.',
      challenge: {
        nonce: challenge.challenge,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
        action: challenge.action,
      },
    },
    { status: 403 },
  );
  res.cookies.set(SUDO_CHALLENGE_COOKIE, JSON.stringify(challenge), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 300,
  });
  return res;
}

/**
 * Verifies a wallet signature against the stored challenge and, on success,
 * refreshes the sudo verification timestamp.
 */
export async function verifySudoSignature(
  req: NextRequest,
  signature: string,
  publicKey: string,
): Promise<SudoVerificationResult> {
  const cookieStore = req.cookies;
  const rawChallenge = cookieStore.get(SUDO_CHALLENGE_COOKIE)?.value;
  if (!rawChallenge) {
    return { verified: false, reason: 'EXPIRED_CHALLENGE' };
  }

  let challenge: SudoChallenge;
  try {
    challenge = JSON.parse(rawChallenge) as SudoChallenge;
  } catch {
    return { verified: false, reason: 'EXPIRED_CHALLENGE' };
  }

  if (Date.now() > challenge.expiresAt) {
    return { verified: false, reason: 'EXPIRED_CHALLENGE' };
  }

  if (!signature || !publicKey) {
    return { verified: false, reason: 'MISSING_WALLET' };
  }

  const valid = await verifyWalletSignature({
    message: challenge.challenge,
    signature,
    publicKey,
  });

  if (!valid) {
    return { verified: false, reason: 'INVALID_SIGNATURE' };
  }

  return { verified: true };
}

/**
 * Marks the session as freshly verified. Call after a successful signature check.
 */
export function markSudoVerified(res: NextResponse): NextResponse {
  res.cookies.set(SUDO_COOKIE_NAME, String(Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SUDO_WINDOW_MS / 1000,
  });
  res.cookies.delete(SUDO_CHALLENGE_COOKIE);
  return res;
}

/**
 * Placeholder for the actual Stellar/Freighter signature verification.
 * Replace with the project's existing wallet verification utility.
 */
async function verifyWalletSignature(params: {
  message: string;
  signature: string;
  publicKey: string;
}): Promise<boolean> {
  try {
    // Integrate with the existing Stellar SDK / Freighter verification helper.
    const { verifySignature } = await import('./wallet-verify');
    return await verifySignature(params);
  } catch {
    return false;
  }
}

/**
 * Guard helper for route handlers. Returns a 403 response when sudo is required,
 * otherwise null so the caller can proceed.
 */
export function enforceSudo(req: NextRequest, action: string): NextResponse | null {
  if (requiresSudo(req)) {
    return buildSudoRequiredResponse(action);
  }
  return null;
}
