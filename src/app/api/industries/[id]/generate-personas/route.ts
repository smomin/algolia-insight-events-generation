import { NextResponse } from 'next/server';
import { getIndustry, getPersonas, savePersonas } from '@/lib/industries';
import { sampleIndex } from '@/lib/algolia';
import { generatePersonasForIndustry, type IndexSample } from '@/lib/anthropic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { count?: number; append?: boolean };
    const count = Math.min(Math.max(1, body.count ?? 5), 100);
    const append = body.append !== false; // default true — append to existing

    const industry = await getIndustry(id);
    if (!industry) {
      return NextResponse.json({ error: 'Industry not found' }, { status: 404 });
    }

    // Sample records from every configured index that has an indexName
    const samplePromises = industry.indices
      .filter((idx) => idx.indexName && idx.indexName.trim() !== '')
      .map(async (idx): Promise<IndexSample> => {
        const records = await sampleIndex(idx.indexName, 25);
        return {
          indexId: idx.id,
          label: idx.label || idx.id,
          role: idx.role,
          sampleRecords: records,
        };
      });

    const indexSamples = await Promise.all(samplePromises);
    const totalSampled = indexSamples.reduce((s, i) => s + i.sampleRecords.length, 0);

    // Collect existing persona names to avoid duplicates
    const existingPersonas = await getPersonas(industry);
    const existingNames = existingPersonas.map((p) => p.name);

    // Ask Claude to generate personas
    const generated = await generatePersonasForIndustry(
      industry.name,
      indexSamples,
      count,
      existingNames
    );

    // Tag each generated persona with the industry
    const tagged = generated.map((p) => ({ ...p, industry: id }));

    // Save: append to existing or replace
    const finalPersonas = append ? [...existingPersonas, ...tagged] : tagged;
    await savePersonas(id, finalPersonas);

    return NextResponse.json({
      generated: tagged,
      total: finalPersonas.length,
      indicesSampled: indexSamples.map((s) => ({
        indexId: s.indexId,
        label: s.label,
        recordsFetched: s.sampleRecords.length,
      })),
      totalRecordsSampled: totalSampled,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
