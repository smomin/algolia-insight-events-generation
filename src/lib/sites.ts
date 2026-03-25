import type { SiteConfig, Persona } from '@/types';
import {
  getAllSiteConfigs,
  saveSiteConfig,
  deleteSiteConfig,
  getSiteConfig,
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
// Sites — DB-first (Couchbase)
// ─────────────────────────────────────────────

export async function getAllSites(): Promise<SiteConfig[]> {
  const configs = await getAllSiteConfigs();
  return Object.values(configs).sort((a, b) => {
    if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function getSite(id: string): Promise<SiteConfig | null> {
  return getSiteConfig(id);
}

export async function createSite(
  config: Omit<SiteConfig, 'isBuiltIn' | 'createdAt' | 'updatedAt'>,
  initialPersonas?: Persona[]
): Promise<SiteConfig> {
  const now = new Date().toISOString();
  const full: SiteConfig = { ...config, isBuiltIn: false, createdAt: now, updatedAt: now };
  await saveSiteConfig(full);

  if (initialPersonas) {
    await cbUpsert('personas', config.id, {
      siteId: config.id,
      personas: initialPersonas.map((p) => ({ ...p, site: config.id })),
    });
  }

  return full;
}

export async function updateSite(
  id: string,
  updates: Partial<Omit<SiteConfig, 'id' | 'isBuiltIn' | 'createdAt'>>
): Promise<SiteConfig | null> {
  const existing = await getSiteConfig(id);
  if (!existing) return null;

  const updated: SiteConfig = {
    ...existing,
    ...updates,
    id,
    isBuiltIn: existing.isBuiltIn,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  // Clear optional override fields when sent as empty string (user reset to app default)
  if (!updated.llmProviderId) delete updated.llmProviderId;
  if (!updated.algoliaAppConfigId) delete updated.algoliaAppConfigId;

  await saveSiteConfig(updated);
  return updated;
}

export async function removeSite(id: string): Promise<boolean> {
  const cfg = await getSiteConfig(id);
  if (!cfg || cfg.isBuiltIn) return false;
  await deleteSiteConfig(id);
  return true;
}

// ─────────────────────────────────────────────
// Personas — stored in `personas` collection
// ─────────────────────────────────────────────

export async function getPersonas(site: SiteConfig): Promise<Persona[]> {
  const doc = await cbGet<{ personas: Persona[] }>('personas', site.id);
  return doc?.personas ?? [];
}

export async function savePersonas(
  siteId: string,
  personas: Persona[]
): Promise<void> {
  const withSite = personas.map((p) => ({ ...p, site: siteId }));
  await cbUpsert('personas', siteId, { siteId, personas: withSite });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export function getEventLimit(): number {
  return parseInt(process.env.DAILY_EVENT_LIMIT_PER_INDEX ?? '1000', 10);
}
