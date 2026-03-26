import { NextResponse } from 'next/server';
import { stopAgentSystem } from '@/lib/agents/agentOrchestrator';

export async function POST() {
  stopAgentSystem();
  return NextResponse.json({ message: 'Agent system stopped' });
}
