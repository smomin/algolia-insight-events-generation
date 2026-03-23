import { NextRequest, NextResponse } from 'next/server';
import { distributeSessionsForDay } from '@/lib/scheduler';
import { getIndustry, getPersonas, getAllIndustries } from '@/lib/industries';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const industryId = body.industryId as string | undefined;

    if (industryId) {
      const industry = await getIndustry(industryId);
      if (!industry) {
        return NextResponse.json(
          { error: `Industry "${industryId}" not found` },
          { status: 404 }
        );
      }
      const personas = await getPersonas(industry);
      distributeSessionsForDay(personas, industry).catch(console.error);
      return NextResponse.json({
        message: `Distribution triggered for ${industry.name}.`,
        industryId,
        personaCount: personas.length,
      });
    }

    const industries = await getAllIndustries();
    industries.forEach(async (industry) => {
      const personas = await getPersonas(industry);
      distributeSessionsForDay(personas, industry).catch(console.error);
    });

    return NextResponse.json({
      message: `Distribution triggered for all ${industries.length} industries simultaneously.`,
      industries: industries.map((i) => ({ id: i.id, name: i.name })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
