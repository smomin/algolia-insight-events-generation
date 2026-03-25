import { NextResponse } from 'next/server';
import { getAllAgents, createAgent, getPersonas } from '@/lib/agentConfigs';
import type { AgentConfig } from '@/types';

export async function GET() {
  try {
    const agents = await getAllAgents();

    const result = await Promise.all(
      agents.map(async (agent) => {
        const personas = await getPersonas(agent);
        return {
          ...agent,
          personaCount: personas.length,
          indices: agent.indices.map((idx) => ({
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

    return NextResponse.json({ agents: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<
      Omit<AgentConfig, 'isBuiltIn' | 'createdAt' | 'updatedAt'>
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

    const agent = await createAgent({
      id: body.id,
      name: body.name,
      icon: body.icon ?? '🤖',
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

    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
