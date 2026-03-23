import Anthropic from '@anthropic-ai/sdk';
import type { Persona } from '@/types';
import type { AlgoliaHit } from '@/lib/algolia';
import { resolveCredentials } from './appConfig';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';

async function getClient(industryId?: string): Promise<Anthropic> {
  const creds = await resolveCredentials(industryId);
  return new Anthropic({
    apiKey: creds.anthropicApiKey,
    maxRetries: 4,      // retry on 529 overloaded / 529 / 503 (SDK respects x-should-retry)
    timeout: 60_000,    // 60s timeout per attempt
  });
}

// ─────────────────────────────────────────────
// Generic functions — driven by industry prompts
// ─────────────────────────────────────────────

export async function generatePrimaryQuery(
  persona: Persona,
  promptInstruction: string,
  industryId?: string
): Promise<string> {
  const client = await getClient(industryId);
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 100,
    system: promptInstruction,
    messages: [
      {
        role: 'user',
        content: `Persona:\n${JSON.stringify(persona, null, 2)}`,
      },
    ],
  });
  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');
  return content.text.trim();
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
  // Build a compact summary of each hit using only the fields that exist in
  // the record — no hardcoded field names.
  const resultList = hits.map((h, i) => ({ index: i, ...summarizeHit(h) }));

  const client = await getClient(industryId);
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: promptInstruction,
    messages: [
      {
        role: 'user',
        content: `Persona:\n${JSON.stringify(persona, null, 2)}\n\nResults:\n${JSON.stringify(resultList, null, 2)}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');

  try {
    const parsed = JSON.parse(content.text.trim()) as {
      index: number;
      reason: string;
    };
    const idx = Math.max(0, Math.min(parsed.index, hits.length - 1));
    return { index: idx, reason: parsed.reason };
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
  // Summarize the primary hit using all fields present in the record so the
  // prompt is driven entirely by the data in the DB — no hardcoded field names.
  const hitSummary = summarizeHit(primaryHit);

  // Tell Claude which secondary catalogs it is targeting so it can tailor queries.
  const indexHint =
    secondaryIndices && secondaryIndices.length > 0
      ? `\nSearching in: ${secondaryIndices.map((si) => si.label).join(', ')}`
      : '';

  const client = await getClient(industryId);
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: promptInstruction,
    messages: [
      {
        role: 'user',
        content: `Primary result:\n${JSON.stringify(hitSummary, null, 2)}\nPersona budget: ${persona.budget ?? 'medium'}\nPersona tags: ${(persona.tags ?? persona.dietaryPreferences ?? []).join(', ')}${indexHint}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');

  const raw = content.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    const parsed = JSON.parse(raw) as string[];
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
  industryId?: string
): Promise<Persona[]> {
  // Build a condensed description of each index's data
  const indexContext = indexSamples.map(({ indexId, label, role, sampleRecords }) => {
    if (sampleRecords.length === 0) return null;

    // Extract representative field names and sample values
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

  const client = await getClient(industryId);
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  const raw = content.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  const parsed = JSON.parse(raw) as Persona[];
  if (!Array.isArray(parsed)) throw new Error('Claude did not return a JSON array');

  return parsed.map((p, i) => ({
    ...p,
    id: p.id || `generated-persona-${Date.now()}-${i}`,
    userToken: p.userToken || `gen-${Math.random().toString(36).slice(2, 10)}`,
  }));
}

