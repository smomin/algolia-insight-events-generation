import { NextResponse } from 'next/server';
import { getAllIndustries, createIndustry, getPersonas } from '@/lib/industries';
import type { IndustryV2 } from '@/types';

export async function GET() {
  try {
    const industries = await getAllIndustries();

    const result = await Promise.all(
      industries.map(async (ind) => {
        const personas = await getPersonas(ind);
        return {
          ...ind,
          personaCount: personas.length,
          indices: ind.indices.map((idx) => ({
            id: idx.id,
            label: idx.label,
            indexName: idx.indexName,
            role: idx.role,
            eventCount: idx.events.length,
            events: idx.events,
          })),
        };
      })
    );

    return NextResponse.json({ industries: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<
      Omit<IndustryV2, 'isBuiltIn' | 'createdAt' | 'updatedAt'>
    >;

    if (!body.id || !body.name || !body.indices || body.indices.length === 0) {
      return NextResponse.json(
        { error: 'id, name, and at least one index are required' },
        { status: 400 }
      );
    }

    if (!body.indices.some((i) => i.role === 'primary')) {
      return NextResponse.json(
        { error: 'At least one index must have role "primary"' },
        { status: 400 }
      );
    }

    const industry = await createIndustry({
      id: body.id,
      name: body.name,
      icon: body.icon ?? '🏭',
      color: body.color ?? 'blue',
      indices: body.indices,
      claudePrompts: body.claudePrompts ?? {
        generatePrimaryQuery:
          'Generate a natural language search query for this persona. Output only the search query string, nothing else.',
        selectBestResult:
          'Return JSON only: {"index": <number>, "reason": "<string>"}. Select the best result (0-based) for this persona.',
        generateSecondaryQueries:
          'Return a JSON array only. Output 3-5 short search query strings relevant to the primary result for this persona.',
      },
    });

    return NextResponse.json({ industry }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
