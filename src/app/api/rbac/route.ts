import { NextRequest, NextResponse } from 'next/server';
import { enforceSudo, markSudoVerified, verifySudoSignature } from '@/lib/session-sudo';
import { getSession } from '@/lib/session';
import { rbacUpdateSchema } from '@/lib/validation/rbac';
import { updateRoleAssignments, listRoleAssignments } from '@/lib/services/rbac';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const assignments = await listRoleAssignments(session.organizationId);
  return NextResponse.json({ assignments });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  if (session.role !== 'admin' && session.role !== 'owner') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  if (body?.sudoSignature && body?.sudoPublicKey) {
    const result = await verifySudoSignature(req, body.sudoSignature, body.sudoPublicKey);
    if (!result.verified) {
      return NextResponse.json(
        { error: result.reason ?? 'SUDO_REQUIRED' },
        { status: 403 },
      );
    }
  } else {
    const sudoResponse = enforceSudo(req, 'rbac:update');
    if (sudoResponse) return sudoResponse;
  }

  const parsed = rbacUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_PAYLOAD', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const assignments = await updateRoleAssignments(session.organizationId, parsed.data);
  const res = NextResponse.json({ assignments });
  return markSudoVerified(res);
}
