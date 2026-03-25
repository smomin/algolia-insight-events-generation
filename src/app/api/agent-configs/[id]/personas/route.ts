import { NextResponse } from 'next/server';
import { getAgent, getPersonas, savePersonas } from '@/lib/agentConfigs';
import type { Persona } from '@/types';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    console.log(`[DEBUG:API/personas] GET agentId="${id}" — calling getAgent`);
    const agent = await getAgent(id);
    if (!agent) {
      console.warn(`[DEBUG:API/personas] agent "${id}" not found`);
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    console.log(`[DEBUG:API/personas] agent found, calling getPersonas for "${id}"`);
    const personas = await getPersonas(agent);
    console.log(`[DEBUG:API/personas] returning ${personas.length} personas for "${id}"`);
    return NextResponse.json({ personas, agentId: id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[DEBUG:API/personas] ERROR for "${(await params).id}":`, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** PUT /api/agent-configs/[id]/personas — upsert a single persona by id */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const agent = await getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const incoming = (await req.json()) as Persona;
    if (!incoming.id) {
      return NextResponse.json({ error: 'Persona id is required' }, { status: 400 });
    }

    const existing = await getPersonas(agent);
    const idx = existing.findIndex((p) => p.id === incoming.id);
    const updated =
      idx >= 0
        ? existing.map((p, i) => (i === idx ? { ...p, ...incoming } : p))
        : [...existing, incoming];

    await savePersonas(id, updated);
    return NextResponse.json({ ok: true, persona: incoming });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/agent-configs/[id]/personas?personaId=xxx — remove a single persona */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const personaId = searchParams.get('personaId');
    if (!personaId) {
      return NextResponse.json({ error: 'personaId query param required' }, { status: 400 });
    }

    const agent = await getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const existing = await getPersonas(agent);
    const filtered = existing.filter((p) => p.id !== personaId);
    if (filtered.length === existing.length) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    await savePersonas(id, filtered);
    return NextResponse.json({ ok: true, deleted: personaId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
