import { NextRequest, NextResponse } from 'next/server';
import { runPersonaSession } from '@/lib/scheduler';
import { getRemainingBudget } from '@/lib/db';
import { getAgent, getPersonas } from '@/lib/agentConfigs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const personaId = body.personaId as string | undefined;
    const agentId = (body.agentId as string | undefined) ?? process.env.DEFAULT_AGENT_ID ?? 'grocery';

    const agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json(
        { error: `Agent "${agentId}" not found` },
        { status: 404 }
      );
    }

    const personas = await getPersonas(agent);
    const persona = personaId
      ? personas.find((p) => p.id === personaId)
      : personas[Math.floor(Math.random() * personas.length)];

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    // Check budget across all configured indices
    const budgetChecks = await Promise.all(
      agent.indices
        .filter((idx) => idx.events.length > 0)
        .map(async (idx) => {
          const remaining = await getRemainingBudget(agentId, idx.id);
          return remaining < idx.events.length;
        })
    );

    if (budgetChecks.some(Boolean)) {
      return NextResponse.json(
        { error: 'Daily event budget exhausted for this agent.' },
        { status: 429 }
      );
    }

    const result = await runPersonaSession(persona, agent);

    return NextResponse.json({
      persona: { id: persona.id, name: persona.name },
      agentId,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
