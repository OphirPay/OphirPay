import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireSudo } from '@/lib/session-sudo';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const feeConfigSchema = z.object({
  platformFeeBps: z.number().int().min(0).max(10000),
  networkFeeBps: z.number().int().min(0).max(10000),
  minFeeAmount: z.string().optional(),
  maxFeeAmount: z.string().optional(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const config = await prisma.feeConfig.findFirst({
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const walletAddress = (session.user as { walletAddress?: string }).walletAddress ?? null;

  const sudo = requireSudo(req, walletAddress, 'fee-config:update');
  if (!sudo.ok) {
    return sudo.response!;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = feeConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const config = await prisma.feeConfig.create({
    data: {
      ...parsed.data,
      updatedBy: walletAddress,
    },
  });

  return NextResponse.json({ config });
}
