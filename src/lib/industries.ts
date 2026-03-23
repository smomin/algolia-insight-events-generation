import type { IndustryV2, Persona } from '@/types';
import {
  getAllIndustryConfigs,
  saveIndustryConfig,
  deleteIndustryConfig,
  getIndustryConfig,
} from '@/lib/db';
import { cbGet, cbUpsert } from '@/lib/couchbase';

export const DEFAULT_PROMPTS = {
  generatePrimaryQuery:
    'Generate a natural language search query for this persona. Output only the search query string, nothing else. No quotes, no punctuation at the end.',
  selectBestResult:
    'You are a recommendation engine. Return JSON only in this exact format: {"index": <number>, "reason": "<string>"}. No markdown, no extra text. Select the best result index (0-based) for this persona.',
  generateSecondaryQueries:
    'Return a JSON array only — no markdown, no code fences, no extra text. Output 3 to 5 short search query strings that will find relevant items in the secondary catalog based on the primary result, completing the customer journey toward conversion.',
};

// ─────────────────────────────────────────────
// Industries — DB-first (Couchbase)
// ─────────────────────────────────────────────

export async function getAllIndustries(): Promise<IndustryV2[]> {
  const configs = await getAllIndustryConfigs();
  return Object.values(configs).sort((a, b) => {
    if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function getIndustry(id: string): Promise<IndustryV2 | null> {
  return getIndustryConfig(id);
}

export async function createIndustry(
  config: Omit<IndustryV2, 'isBuiltIn' | 'createdAt' | 'updatedAt'>,
  initialPersonas?: Persona[]
): Promise<IndustryV2> {
  const now = new Date().toISOString();
  const full: IndustryV2 = { ...config, isBuiltIn: false, createdAt: now, updatedAt: now };
  await saveIndustryConfig(full);

  if (initialPersonas) {
    await cbUpsert('personas', config.id, {
      industryId: config.id,
      personas: initialPersonas.map((p) => ({ ...p, industry: config.id })),
    });
  }

  return full;
}

export async function updateIndustry(
  id: string,
  updates: Partial<Omit<IndustryV2, 'id' | 'isBuiltIn' | 'createdAt'>>
): Promise<IndustryV2 | null> {
  const existing = await getIndustryConfig(id);
  if (!existing) return null;

  const updated: IndustryV2 = {
    ...existing,
    ...updates,
    id,
    isBuiltIn: existing.isBuiltIn,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await saveIndustryConfig(updated);
  return updated;
}

export async function removeIndustry(id: string): Promise<boolean> {
  const cfg = await getIndustryConfig(id);
  if (!cfg || cfg.isBuiltIn) return false;
  await deleteIndustryConfig(id);
  return true;
}

// ─────────────────────────────────────────────
// Personas — stored in `personas` collection
// ─────────────────────────────────────────────

export async function getPersonas(industry: IndustryV2): Promise<Persona[]> {
  const doc = await cbGet<{ personas: Persona[] }>('personas', industry.id);
  return doc?.personas ?? [];
}

export async function savePersonas(
  industryId: string,
  personas: Persona[]
): Promise<void> {
  const withIndustry = personas.map((p) => ({ ...p, industry: industryId }));
  await cbUpsert('personas', industryId, { industryId, personas: withIndustry });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export function getEventLimit(): number {
  return parseInt(process.env.DAILY_EVENT_LIMIT_PER_INDEX ?? '1000', 10);
}
