import { NextResponse } from 'next/server';
import { triggerSupervisorNow, isAgentSystemActive } from '@/lib/agents/agentOrchestrator';

export async function POST() {
  if (!isAgentSystemActive()) {
    return NextResponse.json({ error: 'Agent system is not running' }, { status: 400 });
  }
  triggerSupervisorNow();
  return NextResponse.json({ message: 'Supervisor tick triggered' });
}
