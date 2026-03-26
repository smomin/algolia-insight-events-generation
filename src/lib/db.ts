import { cbGet, cbUpsert, cbDelete, cbGetIndex, cbAddToIndex, cbRemoveFromIndex } from '@/lib/couchbase';
import { emitToAgent } from '@/lib/sse';

// Module-level constant so the env var is parsed once at startup.
const DAILY_LIMIT = parseInt(process.env.DAILY_EVENT_LIMIT_PER_INDEX ?? '1000', 10);
import type {
  AgentConfig,
  AgentCounters,
  SentEvent,
  SchedulerRun,
  SessionRecord,
} from '@/types';

const MAX_EVENT_LOG = 500;
const MAX_SESSIONS = 200;
const MAX_SCHEDULER_RUNS = 50;

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

// ─────────────────────────────────────────────
// Agent config CRUD
// Note: Couchbase collection key kept as 'siteConfigs' for data compatibility.
// ─────────────────────────────────────────────

export async function getAllAgentConfigs(): Promise<Record<string, AgentConfig>> {
  const keys = await cbGetIndex('siteConfigs');
  const entries = await Promise.all(
    keys.map(async (id) => {
      const cfg = await cbGet<AgentConfig>('siteConfigs', id);
      return cfg ? ([id, cfg] as const) : null;
    })
  );
  return Object.fromEntries(
    entries.filter((e): e is [string, AgentConfig] => e !== null)
  );
}

export async function getAgentConfig(id: string): Promise<AgentConfig | null> {
  return cbGet<AgentConfig>('siteConfigs', id);
}

export async function saveAgentConfig(config: AgentConfig): Promise<void> {
  await cbUpsert('siteConfigs', config.id, {
    ...config,
    updatedAt: new Date().toISOString(),
  });
  await cbAddToIndex('siteConfigs', config.id);
}

export async function deleteAgentConfig(id: string): Promise<void> {
  await cbDelete('siteConfigs', id);
  await cbRemoveFromIndex('siteConfigs', id);
}

// ─────────────────────────────────────────────
// Counters (N-index, per agent)
// ─────────────────────────────────────────────

async function readCounters(agentId: string): Promise<AgentCounters> {
  const doc = await cbGet<AgentCounters>('counters', agentId);
  return doc ?? { date: getToday(), byIndex: {} };
}

export async function getTodayCounters(agentId: string): Promise<AgentCounters> {
  const counters = await readCounters(agentId);
  if (counters.date !== getToday()) {
    const fresh: AgentCounters = { date: getToday(), byIndex: {} };
    await cbUpsert('counters', agentId, fresh);
    return fresh;
  }
  return counters;
}

/** Ensures counters are for today. Delegates to getTodayCounters. */
export async function resetCountersIfNewDay(agentId: string): Promise<void> {
  await getTodayCounters(agentId);
}

export async function incrementIndexCounter(
  agentId: string,
  indexId: string,
  amount: number
): Promise<void> {
  const counters = await getTodayCounters(agentId);
  counters.byIndex[indexId] = (counters.byIndex[indexId] ?? 0) + amount;
  await cbUpsert('counters', agentId, counters);
  emitToAgent(agentId, 'counters', counters);
}

export async function getRemainingBudget(
  agentId: string,
  indexId: string
): Promise<number> {
  const counters = await getTodayCounters(agentId);
  return Math.max(0, DAILY_LIMIT - (counters.byIndex[indexId] ?? 0));
}

// ─────────────────────────────────────────────
// Event log
// ─────────────────────────────────────────────

export async function appendEventLog(
  agentId: string,
  events: SentEvent[]
): Promise<void> {
  const doc = await cbGet<{ events: SentEvent[] }>('eventLogs', agentId);
  const existing = doc?.events ?? [];
  const updated = [...existing, ...events].slice(-MAX_EVENT_LOG);
  await cbUpsert('eventLogs', agentId, { events: updated });
  emitToAgent(agentId, 'event-log', { events });
}

export async function getEventLog(agentId: string): Promise<SentEvent[]> {
  console.debug(`[DB:getEventLog] querying collection=eventLogs key="${agentId}"`);
  const doc = await cbGet<{ events: SentEvent[] }>('eventLogs', agentId);
  if (!doc) {
    console.debug(`[DB:getEventLog] document not found for key="${agentId}" — returning []`);
    return [];
  }
  const count = doc.events?.length ?? 0;
  console.debug(`[DB:getEventLog] found ${count} events for key="${agentId}"`);
  return (doc.events ?? []).slice().reverse();
}

export async function clearEventLog(agentId: string): Promise<void> {
  await cbUpsert('eventLogs', agentId, { events: [] });
  emitToAgent(agentId, 'event-log', { events: [], cleared: true });
}

// ─────────────────────────────────────────────
// Scheduler runs
// ─────────────────────────────────────────────

export async function appendSchedulerRun(
  agentId: string,
  run: SchedulerRun
): Promise<void> {
  const doc = await cbGet<{ runs: SchedulerRun[] }>('schedulerRuns', agentId);
  const runs = [run, ...(doc?.runs ?? [])].slice(0, MAX_SCHEDULER_RUNS);
  await cbUpsert('schedulerRuns', agentId, { runs });
}

export async function getLastSchedulerRun(
  agentId: string
): Promise<SchedulerRun | null> {
  const doc = await cbGet<{ runs: SchedulerRun[] }>('schedulerRuns', agentId);
  return doc?.runs[0] ?? null;
}

export async function getSchedulerRuns(agentId: string): Promise<SchedulerRun[]> {
  const doc = await cbGet<{ runs: SchedulerRun[] }>('schedulerRuns', agentId);
  return doc?.runs ?? [];
}

// ─────────────────────────────────────────────
// Session history
// ─────────────────────────────────────────────

export async function appendSession(
  agentId: string,
  session: SessionRecord
): Promise<void> {
  const doc = await cbGet<{ sessions: SessionRecord[] }>('sessions', agentId);
  const sessions = [session, ...(doc?.sessions ?? [])].slice(0, MAX_SESSIONS);
  await cbUpsert('sessions', agentId, { sessions });
  emitToAgent(agentId, 'session', { session });
}

export async function getSessions(agentId: string): Promise<SessionRecord[]> {
  console.debug(`[DB:getSessions] querying collection=sessions key="${agentId}"`);
  const doc = await cbGet<{ sessions: SessionRecord[] }>('sessions', agentId);
  if (!doc) {
    console.debug(`[DB:getSessions] document not found for key="${agentId}" — returning []`);
    return [];
  }
  const count = doc.sessions?.length ?? 0;
  console.debug(`[DB:getSessions] found ${count} sessions for key="${agentId}"`);
  return doc.sessions ?? [];
}

export async function clearSessions(agentId: string): Promise<void> {
  await cbUpsert('sessions', agentId, { sessions: [] });
  emitToAgent(agentId, 'session', { sessions: [], cleared: true });
}

// ─────────────────────────────────────────────
// Distribution state (persisted — survives hot reload)
// ─────────────────────────────────────────────

export interface DistributionState {
  isDistributing: boolean;
  runId?: string;
  startedAt?: string;
  cancelRequested: boolean;
}

export async function getDistributionState(agentId: string): Promise<DistributionState> {
  const doc = await cbGet<DistributionState>('counters', `${agentId}_dist`);
  return doc ?? { isDistributing: false, cancelRequested: false };
}

export async function setDistributionActive(
  agentId: string,
  runId: string,
  active: boolean
): Promise<void> {
  const current = await getDistributionState(agentId);
  await cbUpsert('counters', `${agentId}_dist`, {
    isDistributing: active,
    runId: active ? runId : current.runId,
    startedAt: active ? new Date().toISOString() : current.startedAt,
    cancelRequested: active ? current.cancelRequested : false,
  });
}

export async function setDistributionCancelRequested(agentId: string): Promise<void> {
  const current = await getDistributionState(agentId);
  await cbUpsert('counters', `${agentId}_dist`, { ...current, cancelRequested: true });
}

// ─────────────────────────────────────────────
// Persona query memory — per-persona search history
// Persisted so agents never repeat the same queries across sessions.
// ─────────────────────────────────────────────

const MAX_PERSONA_MEMORY = 30;
// Queries older than this many days are pruned to keep memory fresh.
const MEMORY_MAX_AGE_DAYS = 14;

interface PersonaMemoryEntry {
  query: string;
  timestamp: string; // ISO-8601
}

interface PersonaMemoryDoc {
  entries: PersonaMemoryEntry[];
}

function memoryKey(agentId: string, personaId: string): string {
  return `persona_mem_${agentId}_${personaId}`;
}

/**
 * Returns the last N approved queries for a persona, newest-first.
 * Prunes entries older than MEMORY_MAX_AGE_DAYS automatically.
 */
export async function getPersonaQueryMemory(
  agentId: string,
  personaId: string
): Promise<string[]> {
  const doc = await cbGet<PersonaMemoryDoc>('agentData', memoryKey(agentId, personaId));
  if (!doc?.entries?.length) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MEMORY_MAX_AGE_DAYS);

  return doc.entries
    .filter((e) => new Date(e.timestamp) >= cutoff)
    .map((e) => e.query);
}

/**
 * Appends a successfully-approved query to the persona's memory, deduplicating
 * and capping at MAX_PERSONA_MEMORY entries.
 */
export async function appendPersonaQuery(
  agentId: string,
  personaId: string,
  query: string
): Promise<void> {
  const doc = await cbGet<PersonaMemoryDoc>('agentData', memoryKey(agentId, personaId));
  const existing = doc?.entries ?? [];

  const deduped = existing.filter(
    (e) => e.query.toLowerCase() !== query.toLowerCase()
  );

  const updated: PersonaMemoryEntry[] = [
    { query, timestamp: new Date().toISOString() },
    ...deduped,
  ].slice(0, MAX_PERSONA_MEMORY);

  await cbUpsert('agentData', memoryKey(agentId, personaId), { entries: updated });
}

// ─────────────────────────────────────────────
// Per-index persona query memory
// Scoped to agentId + personaId + indexId so each IndexAgent maintains its
// own search history independently of other indices on the same agent.
// ─────────────────────────────────────────────

function indexMemoryKey(agentId: string, personaId: string, indexId: string): string {
  return `persona_mem_${agentId}_${personaId}_idx_${indexId}`;
}

/**
 * Returns the last N approved queries for a persona on a specific index,
 * newest-first. Prunes entries older than MEMORY_MAX_AGE_DAYS automatically.
 */
export async function getIndexQueryMemory(
  agentId: string,
  personaId: string,
  indexId: string
): Promise<string[]> {
  const doc = await cbGet<PersonaMemoryDoc>('agentData', indexMemoryKey(agentId, personaId, indexId));
  if (!doc?.entries?.length) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MEMORY_MAX_AGE_DAYS);

  return doc.entries
    .filter((e) => new Date(e.timestamp) >= cutoff)
    .map((e) => e.query);
}

/**
 * Appends a successfully-approved query to the per-index persona memory,
 * deduplicating and capping at MAX_PERSONA_MEMORY entries.
 */
export async function appendIndexQuery(
  agentId: string,
  personaId: string,
  indexId: string,
  query: string
): Promise<void> {
  const doc = await cbGet<PersonaMemoryDoc>('agentData', indexMemoryKey(agentId, personaId, indexId));
  const existing = doc?.entries ?? [];

  const deduped = existing.filter(
    (e) => e.query.toLowerCase() !== query.toLowerCase()
  );

  const updated: PersonaMemoryEntry[] = [
    { query, timestamp: new Date().toISOString() },
    ...deduped,
  ].slice(0, MAX_PERSONA_MEMORY);

  await cbUpsert('agentData', indexMemoryKey(agentId, personaId, indexId), { entries: updated });
}
