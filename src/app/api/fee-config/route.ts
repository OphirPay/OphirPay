import { NextRequest, NextResponse } from 'next/server';
import { requireSudo, grantSudo, consumeChallenge } from '@/lib/session-sudo';
import { verifyWalletSignature } from '@/lib/wallet-verify';
import { getSessionWallet } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface FeeConfigPayload {
  baseFeeBps?: number;
  minFee?: string;
  maxFee?: string;
  [key: string]: unknown;
}

export async function GET(req: NextRequest) {
  // Non-critical read: no sudo required.
  const wallet = await getSessionWallet(req);
  if (!wallet) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const config = await loadFeeConfig();
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const wallet = await getSessionWallet(req);
  if (!wallet) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as FeeConfigPayload & {
    sudoChallenge?: string;
    sudoSignature?: string;
  };

  // If the client is completing a sudo challenge, verify it first.
  if (body.sudoChallenge && body.sudoSignature) {
    const stored = consumeChallenge(body.sudoChallenge);
    if (!stored || stored.walletAddress !== wallet) {
      return NextResponse.json({ error: 'INVALID_CHALLENGE' }, { status: 403 });
    }
    const valid = await verifyWalletSignature({
      walletAddress: wallet,
      message: stored.challenge,
      signature: body.sudoSignature,
    });
    if (!valid) {
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 403 });
    }
    const response = NextResponse.json({ ok: true, config: await persistFeeConfig(body) });
    return grantSudo(response, wallet, body.sudoSignature);
  }

  // Otherwise require an existing fresh sudo session.
  const sudo = requireSudo(req, wallet, 'fee-config:update');
  if (!sudo.ok) {
    return sudo.response!;
  }

  const config = await persistFeeConfig(body);
  return NextResponse.json({ ok: true, config });
}

async function loadFeeConfig(): Promise<FeeConfigPayload> {
  // Placeholder for existing persistence layer.
  return {};
}

async function persistFeeConfig(payload: FeeConfigPayload): Promise<FeeConfigPayload> {
  // Placeholder for existing persistence layer.
  return payload;
}
