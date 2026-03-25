import { NextResponse } from 'next/server';
import { getSite, updateSite, removeSite, getPersonas } from '@/lib/sites';
import type { SiteConfig } from '@/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const site = await getSite(id);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const personas = await getPersonas(site);
    return NextResponse.json({ site, personaCount: personas.length });
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
      Omit<SiteConfig, 'id' | 'isBuiltIn' | 'createdAt'>
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

    const updated = await updateSite(id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    return NextResponse.json({ site: updated });
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
    const site = await getSite(id);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    if (site.isBuiltIn) {
      return NextResponse.json(
        { error: 'Built-in sites cannot be deleted' },
        { status: 403 }
      );
    }
    await removeSite(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
