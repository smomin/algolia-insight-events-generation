import { NextResponse } from 'next/server';
import { getAgentConfigs, upsertAgentConfigs } from '@/lib/agentDb';
import type { AgentConfigs } from '@/types';

export async function GET() {
  try {
    const configs = await getAgentConfigs();
    return NextResponse.json(configs);
  } catch (err) {
    console.error('[API /agents/config GET]', err);
    return NextResponse.json({ error: 'Failed to load agent configs' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Partial<AgentConfigs>;
    const updated = await upsertAgentConfigs(body);
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[API /agents/config PUT]', err);
    return NextResponse.json({ error: 'Failed to save agent configs' }, { status: 500 });
  }
}
