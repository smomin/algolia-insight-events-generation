import type { AgentConfig, Persona } from '@/types';
import {
  getAllAgentConfigs,
  saveAgentConfig,
  deleteAgentConfig,
  getAgentConfig,
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
// Agent configs — DB-first (Couchbase)
// ─────────────────────────────────────────────

export async function getAllAgents(): Promise<AgentConfig[]> {
  const configs = await getAllAgentConfigs();
  return Object.values(configs).sort((a, b) => {
    if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** @deprecated Use getAllAgents */
export const getAllSites = getAllAgents;

export async function getAgent(id: string): Promise<AgentConfig | null> {
  return getAgentConfig(id);
}

/** @deprecated Use getAgent */
export const getSite = getAgent;

export async function createAgent(
  config: Omit<AgentConfig, 'isBuiltIn' | 'createdAt' | 'updatedAt'>,
  initialPersonas?: Persona[]
): Promise<AgentConfig> {
  const now = new Date().toISOString();
  const full: AgentConfig = { ...config, isBuiltIn: false, createdAt: now, updatedAt: now };
  await saveAgentConfig(full);

  if (initialPersonas) {
    await cbUpsert('personas', config.id, {
      agentId: config.id,
      personas: initialPersonas.map((p) => ({ ...p, agentId: config.id })),
    });
  }

  return full;
}

/** @deprecated Use createAgent */
export const createSite = createAgent;

export async function updateAgent(
  id: string,
  updates: Partial<Omit<AgentConfig, 'id' | 'isBuiltIn' | 'createdAt'>>
): Promise<AgentConfig | null> {
  const existing = await getAgentConfig(id);
  if (!existing) return null;

  const updated: AgentConfig = {
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

  await saveAgentConfig(updated);
  return updated;
}

/** @deprecated Use updateAgent */
export const updateSite = updateAgent;

export async function removeAgent(id: string): Promise<boolean> {
  const cfg = await getAgentConfig(id);
  if (!cfg) return false;
  await deleteAgentConfig(id);
  return true;
}

/** @deprecated Use removeAgent */
export const removeSite = removeAgent;

// ─────────────────────────────────────────────
// Personas — stored in `personas` collection
// ─────────────────────────────────────────────

export async function getPersonas(agent: AgentConfig): Promise<Persona[]> {
  const doc = await cbGet<{ personas: Persona[] }>('personas', agent.id);
  return doc?.personas ?? [];
}

export async function savePersonas(
  agentId: string,
  personas: Persona[]
): Promise<void> {
  const withAgent = personas.map((p) => ({ ...p, agentId }));
  await cbUpsert('personas', agentId, { agentId, personas: withAgent });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export function getEventLimit(): number {
  return parseInt(process.env.DAILY_EVENT_LIMIT_PER_INDEX ?? '1000', 10);
}
