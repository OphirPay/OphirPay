import { NextResponse } from 'next/server';
import { getRefundReasonAnalytics } from '@/lib/contract-data';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  if (type === 'refund-reasons' && start && end) {
    try {
      const analytics = await getRefundReasonAnalytics(start, end);
      return NextResponse.json(analytics);
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to fetch refund reason analytics' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { error: 'Invalid request' },
    { status: 400 }
  );
}