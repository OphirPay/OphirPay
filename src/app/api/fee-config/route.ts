import { NextRequest, NextResponse } from 'next/server';
import { requireSudo } from '@/lib/session-sudo';
import { getSession } from '@/lib/auth';
import { feeConfigService } from '@/lib/services/fee-config';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const config = await feeConfigService.get();
  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Critical administrative action: require fresh wallet re-verification.
  const sudoGuard = requireSudo(req);
  if (sudoGuard) return sudoGuard;

  const body = await req.json();

  try {
    const updated = await feeConfigService.update(body, session.walletAddress);
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update fee config';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const sudoGuard = requireSudo(req);
  if (sudoGuard) return sudoGuard;

  const body = await req.json();

  try {
    const updated = await feeConfigService.patch(body, session.walletAddress);
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to patch fee config';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
