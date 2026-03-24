import { NextResponse } from 'next/server';
import { getAgentSystemStatus } from '@/lib/agents/agentOrchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getAgentSystemStatus();
    return NextResponse.json(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
