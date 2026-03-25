import { NextRequest, NextResponse } from 'next/server';
import { runPersonaSession } from '@/lib/scheduler';
import { getRemainingBudget } from '@/lib/db';
import { getSite, getPersonas } from '@/lib/sites';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const personaId = body.personaId as string | undefined;
    const siteId = (body.siteId as string | undefined) ?? process.env.DEFAULT_SITE_ID ?? 'grocery';

    const site = await getSite(siteId);
    if (!site) {
      return NextResponse.json(
        { error: `Site "${siteId}" not found` },
        { status: 404 }
      );
    }

    const personas = await getPersonas(site);
    const persona = personaId
      ? personas.find((p) => p.id === personaId)
      : personas[Math.floor(Math.random() * personas.length)];

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    // Check budget across all configured indices
    const budgetChecks = await Promise.all(
      site.indices
        .filter((idx) => idx.events.length > 0)
        .map(async (idx) => {
          const remaining = await getRemainingBudget(siteId, idx.id);
          return remaining < idx.events.length;
        })
    );

    if (budgetChecks.some(Boolean)) {
      return NextResponse.json(
        { error: 'Daily event budget exhausted for this site.' },
        { status: 429 }
      );
    }

    const result = await runPersonaSession(persona, site);

    return NextResponse.json({
      persona: { id: persona.id, name: persona.name },
      siteId,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
