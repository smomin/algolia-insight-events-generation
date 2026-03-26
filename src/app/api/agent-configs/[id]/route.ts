import { NextResponse } from 'next/server';
import { getAgent, updateAgent, removeAgent, getPersonas } from '@/lib/agentConfigs';
import type { AgentConfig } from '@/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = await getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    const personas = await getPersonas(agent);
    return NextResponse.json({ agent, personaCount: personas.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<
      Omit<AgentConfig, 'id' | 'isBuiltIn' | 'createdAt'>
    >;

    if (body.indices !== undefined) {
      if (body.indices.length === 0) {
        return NextResponse.json(
          { error: 'At least one index is required' },
          { status: 400 }
        );
      }
      if (!body.indices.some((i) => i.role === 'primary')) {
        return NextResponse.json(
          { error: 'At least one index must have role "primary"' },
          { status: 400 }
        );
      }
    }

    const updated = await updateAgent(id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    return NextResponse.json({ agent: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = await getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    await removeAgent(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
