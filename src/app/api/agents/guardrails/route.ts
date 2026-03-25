import { NextRequest, NextResponse } from 'next/server';
import { getGuardrailViolations } from '@/lib/agentDb';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get('siteId');
  if (!siteId) {
    return NextResponse.json({ error: 'siteId required' }, { status: 400 });
  }
  try {
    const violations = await getGuardrailViolations(siteId);
    return NextResponse.json({ violations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
