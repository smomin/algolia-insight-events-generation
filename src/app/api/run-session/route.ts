import { NextRequest, NextResponse } from 'next/server';
import { runPersonaSession } from '@/lib/scheduler';
import { getRemainingBudget } from '@/lib/db';
import { getIndustry, getPersonas } from '@/lib/industries';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const personaId = body.personaId as string | undefined;
    const industryId = (body.industryId as string | undefined) ?? 'grocery';

    const industry = await getIndustry(industryId);
    if (!industry) {
      return NextResponse.json(
        { error: `Industry "${industryId}" not found` },
        { status: 404 }
      );
    }

    const personas = await getPersonas(industry);
    const persona = personaId
      ? personas.find((p) => p.id === personaId)
      : personas[Math.floor(Math.random() * personas.length)];

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    // Check budget across all configured indices
    const budgetChecks = await Promise.all(
      industry.indices
        .filter((idx) => idx.events.length > 0)
        .map(async (idx) => {
          const remaining = await getRemainingBudget(industryId, idx.id);
          return remaining < idx.events.length;
        })
    );

    if (budgetChecks.some(Boolean)) {
      return NextResponse.json(
        { error: 'Daily event budget exhausted for this industry.' },
        { status: 429 }
      );
    }

    const result = await runPersonaSession(persona, industry);

    return NextResponse.json({
      persona: { id: persona.id, name: persona.name },
      industryId,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
