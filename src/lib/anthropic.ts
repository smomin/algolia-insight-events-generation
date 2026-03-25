import type { Persona } from '@/types';
import type { AlgoliaHit } from '@/lib/algolia';
import { callLLM } from './llm';

// ─────────────────────────────────────────────
// Generic functions — driven by industry prompts
// ─────────────────────────────────────────────

export async function generatePrimaryQuery(
  persona: Persona,
  promptInstruction: string,
  industryId?: string,
  recentQueries?: string[]
): Promise<string> {
  let userContent = `Persona:\n${JSON.stringify(persona, null, 2)}`;

  if (recentQueries && recentQueries.length > 0) {
    userContent +=
      `\n\nThis persona's recent searches (avoid repeating these or close variants — generate something distinctly different to ensure variety):\n` +
      recentQueries.map((q) => `- "${q}"`).join('\n');
  }

  return callLLM(
    [{ role: 'user', content: userContent }],
    { systemPrompt: promptInstruction, maxTokens: 100 },
    industryId
  );
}

// ─────────────────────────────────────────────
// Shared utility: extract a compact, readable summary of an Algolia hit
// using whatever fields are actually present in the record.
// ─────────────────────────────────────────────

const HIT_SKIP_FIELDS = new Set([
  'objectID',
  '_highlightResult',
  '_rankingInfo',
  '_distinctSeqID',
  '_geoloc',
  '_snippetResult',
  '__position',
]);

function summarizeHit(hit: AlgoliaHit): Record<string, unknown> {
  const summary: Record<string, unknown> = { objectID: hit.objectID };

  for (const [key, val] of Object.entries(hit)) {
    if (HIT_SKIP_FIELDS.has(key) || key.startsWith('_')) continue;
    if (val === undefined || val === null || val === '') continue;

    if (Array.isArray(val)) {
      const items = (val as unknown[])
        .slice(0, 8)
        .map(String)
        .filter((s) => s.length > 0 && s.length < 150);
      if (items.length > 0) summary[key] = items;
    } else if (typeof val === 'object') {
      // skip nested objects to keep the prompt compact
    } else {
      const str = String(val);
      summary[key] = str.length > 200 ? str.slice(0, 200) + '…' : str;
    }
  }

  return summary;
}

export async function selectBestResult(
  persona: Persona,
  hits: AlgoliaHit[],
  promptInstruction: string,
  industryId?: string
): Promise<{ index: number; reason: string }> {
  const resultList = hits.map((h, i) => ({ index: i, ...summarizeHit(h) }));

  const text = await callLLM(
    [
      {
        role: 'user',
        content: `Persona:\n${JSON.stringify(persona, null, 2)}\n\nResults:\n${JSON.stringify(resultList, null, 2)}`,
      },
    ],
    { systemPrompt: promptInstruction, maxTokens: 200 },
    industryId
  );

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    const parsed = JSON.parse(cleaned) as { index: number; reason: string };
    const rawIdx = typeof parsed === 'object' && parsed !== null ? parsed.index : undefined;
    const numIdx = Number(rawIdx);
    const idx = Number.isFinite(numIdx)
      ? Math.max(0, Math.min(Math.floor(numIdx), hits.length - 1))
      : 0;
    return { index: idx, reason: parsed?.reason ?? 'Auto-selected result' };
  } catch {
    return { index: 0, reason: 'Auto-selected first result' };
  }
}

export async function generateSecondaryQueries(
  primaryHit: AlgoliaHit,
  persona: Persona,
  promptInstruction: string,
  industryId?: string,
  secondaryIndices?: Array<{ id: string; label: string }>
): Promise<string[]> {
  const hitSummary = summarizeHit(primaryHit);

  const indexHint =
    secondaryIndices && secondaryIndices.length > 0
      ? `\nSearching in: ${secondaryIndices.map((si) => si.label).join(', ')}`
      : '';

  const raw = await callLLM(
    [
      {
        role: 'user',
        content: `Primary result:\n${JSON.stringify(hitSummary, null, 2)}\nPersona budget: ${persona.budget ?? 'medium'}\nPersona tags: ${(persona.tags ?? persona.dietaryPreferences ?? []).join(', ')}${indexHint}`,
      },
    ],
    { systemPrompt: promptInstruction, maxTokens: 300 },
    industryId
  );

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    const parsed = JSON.parse(cleaned) as string[];
    if (!Array.isArray(parsed) || parsed.length === 0)
      throw new Error('Invalid response');
    return parsed
      .slice(0, 5)
      .map((q) => String(q).trim())
      .filter(Boolean);
  } catch {
    return [primaryHit.objectID];
  }
}

// ─────────────────────────────────────────────
// Persona generation from index samples
// ─────────────────────────────────────────────

export interface IndexSample {
  indexId: string;
  label: string;
  role: 'primary' | 'secondary';
  sampleRecords: AlgoliaHit[];
}

export async function generatePersonasForIndustry(
  industryName: string,
  indexSamples: IndexSample[],
  count: number,
  existingPersonaNames: string[],
  industryId?: string,
  llmProviderIdOverride?: string
): Promise<Persona[]> {
  const indexContext = indexSamples.map(({ label, role, sampleRecords }) => {
    if (sampleRecords.length === 0) return null;

    const fieldFrequency: Record<string, number> = {};
    const fieldSamples: Record<string, unknown[]> = {};
    const skipFields = new Set(['objectID', '_highlightResult', '_rankingInfo', '_distinctSeqID']);

    for (const hit of sampleRecords) {
      for (const [key, val] of Object.entries(hit)) {
        if (skipFields.has(key) || typeof val === 'object') continue;
        fieldFrequency[key] = (fieldFrequency[key] ?? 0) + 1;
        if (!fieldSamples[key]) fieldSamples[key] = [];
        if (fieldSamples[key].length < 3) fieldSamples[key].push(val);
      }
    }

    const topFields = Object.entries(fieldFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([key]) => {
        const samples = fieldSamples[key]?.slice(0, 2).map(String).join(', ') ?? '';
        return `  - ${key}: ${samples}`;
      });

    const sampleNames = sampleRecords
      .slice(0, 5)
      .map((h) => (h.name as string) ?? (h.title as string) ?? h.objectID)
      .filter(Boolean);

    return [
      `Index: "${label}" (${role}) — ${sampleRecords.length} sample records`,
      `Top fields:\n${topFields.join('\n')}`,
      `Sample items: ${sampleNames.join(', ')}`,
    ].join('\n');
  }).filter(Boolean).join('\n\n');

  const avoidNames = existingPersonaNames.length > 0
    ? `\nDo NOT reuse these existing persona names: ${existingPersonaNames.join(', ')}.`
    : '';

  const systemPrompt = `You are a UX research expert generating realistic synthetic user personas for an e-commerce and search analytics simulation system.

You will be given information about an industry and sample records from its Algolia search indices. Generate ${count} diverse, realistic personas who would realistically search and interact with this content.

Return ONLY a valid JSON array. No markdown, no code fences, no explanation. Each persona object must have exactly these fields:
- "id": unique kebab-case slug (e.g. "budget-conscious-traveler-1")
- "name": realistic full name
- "userToken": "gen-" followed by a unique 8-char alphanumeric string
- "description": 1-2 sentence personality and usage description (specific to the content)
- "skill": one of "beginner", "intermediate", "advanced"
- "budget": one of "low", "medium", "high"
- "tags": array of 3-5 relevant strings (interests, preferences, behaviors)
- any 2-4 additional domain-specific fields relevant to this industry (e.g. travelStyle, investmentGoal, fitnessLevel — choose field names that make sense)

Personas must be diverse across skill level, budget, age groups, and use cases. Make them feel like real, distinct people.${avoidNames}`;

  const userMessage = `Industry: ${industryName}

Sample data from configured indices:
${indexContext || 'No sample records available — generate plausible personas based on the industry name alone.'}`;

  const raw = await callLLM(
    [{ role: 'user', content: userMessage }],
    { systemPrompt, maxTokens: 4000, providerIdOverride: llmProviderIdOverride },
    industryId
  );

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  const parsed = JSON.parse(cleaned) as Persona[];
  if (!Array.isArray(parsed)) throw new Error('LLM did not return a JSON array');

  return parsed.map((p, i) => ({
    ...p,
    id: p.id || `generated-persona-${Date.now()}-${i}`,
    userToken: p.userToken || `gen-${Math.random().toString(36).slice(2, 10)}`,
  }));
}
