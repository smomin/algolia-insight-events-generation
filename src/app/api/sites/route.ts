import { NextResponse } from 'next/server';
import { getAllSites, createSite, getPersonas } from '@/lib/sites';
import type { SiteConfig } from '@/types';

export async function GET() {
  try {
    const sites = await getAllSites();

    const result = await Promise.all(
      sites.map(async (site) => {
        const personas = await getPersonas(site);
        return {
          ...site,
          personaCount: personas.length,
          indices: site.indices.map((idx) => ({
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

    return NextResponse.json({ sites: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<
      Omit<SiteConfig, 'isBuiltIn' | 'createdAt' | 'updatedAt'>
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

    const site = await createSite({
      id: body.id,
      name: body.name,
      icon: body.icon ?? '🏭',
      color: body.color ?? 'blue',
      ...(body.siteUrl ? { siteUrl: body.siteUrl } : {}),
      indices: body.indices,
      claudePrompts: body.claudePrompts ?? {
        generatePrimaryQuery:
          'Generate a natural language search query for this persona. Output only the search query string, nothing else.',
        selectBestResult:
          'Return JSON only: {"index": <number>, "reason": "<string>"}. Select the best result (0-based) for this persona.',
        generateSecondaryQueries:
          'Return a JSON array only. Output 3-5 short search query strings relevant to the primary result for this persona.',
      },
      ...(body.credentials ? { credentials: body.credentials } : {}),
      ...(body.llmProviderId ? { llmProviderId: body.llmProviderId } : {}),
      ...(body.algoliaAppConfigId ? { algoliaAppConfigId: body.algoliaAppConfigId } : {}),
    });

    return NextResponse.json({ site }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
