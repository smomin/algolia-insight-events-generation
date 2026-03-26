import { NextRequest, NextResponse } from 'next/server';
import { startAgentSystem, isAgentSystemActive } from '@/lib/agents/agentOrchestrator';

export async function POST(req: NextRequest) {
  if (isAgentSystemActive()) {
    return NextResponse.json({ message: 'Agent system is already running' }, { status: 409 });
  }
  try {
    const body = await req.json().catch(() => ({})) as { agentIds?: string[] };
    const agentIds = Array.isArray(body.agentIds) && body.agentIds.length > 0
      ? body.agentIds
      : undefined;
    await startAgentSystem(agentIds);
    return NextResponse.json({ message: 'Agent system started' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
