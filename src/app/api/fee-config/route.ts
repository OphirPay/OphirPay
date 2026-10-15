import { NextRequest, NextResponse } from 'next/server';
import { enforceSudo, markSudoVerified, verifySudoSignature } from '@/lib/session-sudo';
import { getSession } from '@/lib/session';
import { feeConfigSchema } from '@/lib/validation/fee-config';
import { updateFeeConfig, getFeeConfig } from '@/lib/services/fee-config';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const config = await getFeeConfig(session.organizationId);
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  if (session.role !== 'admin' && session.role !== 'owner') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  // Sudo re-authentication path: client submits a signature to satisfy the challenge.
  if (body?.sudoSignature && body?.sudoPublicKey) {
    const result = await verifySudoSignature(req, body.sudoSignature, body.sudoPublicKey);
    if (!result.verified) {
      return NextResponse.json(
        { error: result.reason ?? 'SUDO_REQUIRED' },
        { status: 403 },
      );
    }
    // Fall through to apply the mutation with a freshly verified session.
  } else {
    const sudoResponse = enforceSudo(req, 'fee-config:update');
    if (sudoResponse) return sudoResponse;
  }

  const parsed = feeConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_PAYLOAD', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updated = await updateFeeConfig(session.organizationId, parsed.data);
  const res = NextResponse.json({ config: updated });
  return markSudoVerified(res);
}
