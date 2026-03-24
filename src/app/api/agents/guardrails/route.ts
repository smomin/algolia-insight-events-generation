import { NextRequest, NextResponse } from 'next/server';
import { getGuardrailViolations } from '@/lib/agentDb';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const industryId = searchParams.get('industryId');
  if (!industryId) {
    return NextResponse.json({ error: 'industryId required' }, { status: 400 });
  }
  try {
    const violations = await getGuardrailViolations(industryId);
    return NextResponse.json({ violations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
