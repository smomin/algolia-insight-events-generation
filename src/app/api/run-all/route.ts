import { NextRequest, NextResponse } from 'next/server';
import { distributeSessionsForDay } from '@/lib/scheduler';
import { getSite, getPersonas, getAllSites } from '@/lib/sites';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const siteId = body.siteId as string | undefined;

    if (siteId) {
      const site = await getSite(siteId);
      if (!site) {
        return NextResponse.json(
          { error: `Site "${siteId}" not found` },
          { status: 404 }
        );
      }
      const personas = await getPersonas(site);
      distributeSessionsForDay(personas, site).catch(console.error);
      return NextResponse.json({
        message: `Distribution triggered for ${site.name}.`,
        siteId,
        personaCount: personas.length,
      });
    }

    const sites = await getAllSites();
    sites.forEach(async (site) => {
      const personas = await getPersonas(site);
      distributeSessionsForDay(personas, site).catch(console.error);
    });

    return NextResponse.json({
      message: `Distribution triggered for all ${sites.length} sites simultaneously.`,
      sites: sites.map((s) => ({ id: s.id, name: s.name })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
