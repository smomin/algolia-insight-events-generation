import { NextRequest, NextResponse } from 'next/server';
import { distributeSessionsForDay } from '@/lib/scheduler';
import { getAgent, getPersonas, getAllAgents } from '@/lib/agentConfigs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const agentId = (body.agentId as string | undefined) ?? (body.siteId as string | undefined);

    if (agentId) {
      const agent = await getAgent(agentId);
      if (!agent) {
        return NextResponse.json(
          { error: `Agent "${agentId}" not found` },
          { status: 404 }
        );
      }
      const personas = await getPersonas(agent);
      distributeSessionsForDay(personas, agent).catch(console.error);
      return NextResponse.json({
        message: `Distribution triggered for ${agent.name}.`,
        agentId,
        personaCount: personas.length,
      });
    }

    const agents = await getAllAgents();
    agents.forEach(async (agent) => {
      const personas = await getPersonas(agent);
      distributeSessionsForDay(personas, agent).catch(console.error);
    });

    return NextResponse.json({
      message: `Distribution triggered for all ${agents.length} agents simultaneously.`,
      agents: agents.map((a) => ({ id: a.id, name: a.name })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
