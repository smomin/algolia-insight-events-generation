import { NextResponse } from 'next/server';
import { startAgentSystem, isAgentSystemActive } from '@/lib/agents/agentOrchestrator';

export async function POST() {
  if (isAgentSystemActive()) {
    return NextResponse.json({ message: 'Agent system is already running' }, { status: 409 });
  }
  try {
    await startAgentSystem();
    return NextResponse.json({ message: 'Agent system started' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
