import { NextRequest, NextResponse } from 'next/server';
import { getGuardrailViolations } from '@/lib/agentDb';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId') ?? searchParams.get('siteId');
  if (!agentId) {
    return NextResponse.json({ error: 'agentId required' }, { status: 400 });
  }
  try {
    const violations = await getGuardrailViolations(agentId);
    return NextResponse.json({ violations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
