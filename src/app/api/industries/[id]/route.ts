import { NextResponse } from 'next/server';
import { getIndustry, updateIndustry, removeIndustry, getPersonas } from '@/lib/industries';
import type { IndustryV2 } from '@/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const industry = await getIndustry(id);
    if (!industry) {
      return NextResponse.json({ error: 'Industry not found' }, { status: 404 });
    }
    const personas = await getPersonas(industry);
    return NextResponse.json({ industry, personaCount: personas.length });
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
      Omit<IndustryV2, 'id' | 'isBuiltIn' | 'createdAt'>
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

    const updated = await updateIndustry(id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Industry not found' }, { status: 404 });
    }
    return NextResponse.json({ industry: updated });
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
    const industry = await getIndustry(id);
    if (!industry) {
      return NextResponse.json({ error: 'Industry not found' }, { status: 404 });
    }
    if (industry.isBuiltIn) {
      return NextResponse.json(
        { error: 'Built-in industries cannot be deleted' },
        { status: 403 }
      );
    }
    await removeIndustry(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
