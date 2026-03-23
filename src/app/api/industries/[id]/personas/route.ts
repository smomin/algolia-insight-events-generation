import { NextResponse } from 'next/server';
import { getIndustry, getPersonas, savePersonas } from '@/lib/industries';
import type { Persona } from '@/types';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const industry = await getIndustry(id);
    if (!industry) {
      return NextResponse.json({ error: 'Industry not found' }, { status: 404 });
    }
    const personas = await getPersonas(industry);
    return NextResponse.json({ personas, industryId: id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** PUT /api/industries/[id]/personas — upsert a single persona by id */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const industry = await getIndustry(id);
    if (!industry) {
      return NextResponse.json({ error: 'Industry not found' }, { status: 404 });
    }

    const incoming = (await req.json()) as Persona;
    if (!incoming.id) {
      return NextResponse.json({ error: 'Persona id is required' }, { status: 400 });
    }

    const existing = await getPersonas(industry);
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

/** DELETE /api/industries/[id]/personas?personaId=xxx — remove a single persona */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const personaId = searchParams.get('personaId');
    if (!personaId) {
      return NextResponse.json({ error: 'personaId query param required' }, { status: 400 });
    }

    const industry = await getIndustry(id);
    if (!industry) {
      return NextResponse.json({ error: 'Industry not found' }, { status: 404 });
    }

    const existing = await getPersonas(industry);
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
