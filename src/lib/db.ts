import { cbGet, cbUpsert, cbDelete, cbGetIndex, cbAddToIndex, cbRemoveFromIndex } from '@/lib/couchbase';
import { emitToSite } from '@/lib/sse';

// Module-level constant so the env var is parsed once at startup.
const DAILY_LIMIT = parseInt(process.env.DAILY_EVENT_LIMIT_PER_INDEX ?? '1000', 10);
import type {
  SiteConfig,
  SiteCounters,
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
// Site config CRUD
// ─────────────────────────────────────────────

export async function getAllSiteConfigs(): Promise<Record<string, SiteConfig>> {
  const keys = await cbGetIndex('siteConfigs');
  const entries = await Promise.all(
    keys.map(async (id) => {
      const cfg = await cbGet<SiteConfig>('siteConfigs', id);
      return cfg ? ([id, cfg] as const) : null;
    })
  );
  return Object.fromEntries(
    entries.filter((e): e is [string, SiteConfig] => e !== null)
  );
}

export async function getSiteConfig(id: string): Promise<SiteConfig | null> {
  return cbGet<SiteConfig>('siteConfigs', id);
}

export async function saveSiteConfig(config: SiteConfig): Promise<void> {
  await cbUpsert('siteConfigs', config.id, {
    ...config,
    updatedAt: new Date().toISOString(),
  });
  await cbAddToIndex('siteConfigs', config.id);
}

export async function deleteSiteConfig(id: string): Promise<void> {
  await cbDelete('siteConfigs', id);
  await cbRemoveFromIndex('siteConfigs', id);
}

// ─────────────────────────────────────────────
// Counters (N-index, per site)
// ─────────────────────────────────────────────

async function readCounters(siteId: string): Promise<SiteCounters> {
  const doc = await cbGet<SiteCounters>('counters', siteId);
  return doc ?? { date: getToday(), byIndex: {} };
}

export async function getTodayCounters(siteId: string): Promise<SiteCounters> {
  const counters = await readCounters(siteId);
  if (counters.date !== getToday()) {
    const fresh: SiteCounters = { date: getToday(), byIndex: {} };
    await cbUpsert('counters', siteId, fresh);
    return fresh;
  }
  return counters;
}

/** Ensures counters are for today. Delegates to getTodayCounters. */
export async function resetCountersIfNewDay(siteId: string): Promise<void> {
  await getTodayCounters(siteId);
}

export async function incrementIndexCounter(
  siteId: string,
  indexId: string,
  amount: number
): Promise<void> {
  const counters = await getTodayCounters(siteId);
  counters.byIndex[indexId] = (counters.byIndex[indexId] ?? 0) + amount;
  await cbUpsert('counters', siteId, counters);
  emitToSite(siteId, 'counters', counters);
}

export async function getRemainingBudget(
  siteId: string,
  indexId: string
): Promise<number> {
  const counters = await getTodayCounters(siteId);
  return Math.max(0, DAILY_LIMIT - (counters.byIndex[indexId] ?? 0));
}

// ─────────────────────────────────────────────
// Event log
// ─────────────────────────────────────────────

export async function appendEventLog(
  siteId: string,
  events: SentEvent[]
): Promise<void> {
  const doc = await cbGet<{ events: SentEvent[] }>('eventLogs', siteId);
  const existing = doc?.events ?? [];
  const updated = [...existing, ...events].slice(-MAX_EVENT_LOG);
  await cbUpsert('eventLogs', siteId, { events: updated });
  emitToSite(siteId, 'event-log', { events });
}

export async function getEventLog(siteId: string): Promise<SentEvent[]> {
  const doc = await cbGet<{ events: SentEvent[] }>('eventLogs', siteId);
  return (doc?.events ?? []).slice().reverse();
}

export async function clearEventLog(siteId: string): Promise<void> {
  await cbUpsert('eventLogs', siteId, { events: [] });
  emitToSite(siteId, 'event-log', { events: [], cleared: true });
}

// ─────────────────────────────────────────────
// Scheduler runs
// ─────────────────────────────────────────────

export async function appendSchedulerRun(
  siteId: string,
  run: SchedulerRun
): Promise<void> {
  const doc = await cbGet<{ runs: SchedulerRun[] }>('schedulerRuns', siteId);
  const runs = [run, ...(doc?.runs ?? [])].slice(0, MAX_SCHEDULER_RUNS);
  await cbUpsert('schedulerRuns', siteId, { runs });
}

export async function getLastSchedulerRun(
  siteId: string
): Promise<SchedulerRun | null> {
  const doc = await cbGet<{ runs: SchedulerRun[] }>('schedulerRuns', siteId);
  return doc?.runs[0] ?? null;
}

export async function getSchedulerRuns(siteId: string): Promise<SchedulerRun[]> {
  const doc = await cbGet<{ runs: SchedulerRun[] }>('schedulerRuns', siteId);
  return doc?.runs ?? [];
}

// ─────────────────────────────────────────────
// Session history
// ─────────────────────────────────────────────

export async function appendSession(
  siteId: string,
  session: SessionRecord
): Promise<void> {
  const doc = await cbGet<{ sessions: SessionRecord[] }>('sessions', siteId);
  const sessions = [session, ...(doc?.sessions ?? [])].slice(0, MAX_SESSIONS);
  await cbUpsert('sessions', siteId, { sessions });
  emitToSite(siteId, 'session', { session });
}

export async function getSessions(siteId: string): Promise<SessionRecord[]> {
  const doc = await cbGet<{ sessions: SessionRecord[] }>('sessions', siteId);
  return doc?.sessions ?? [];
}

export async function clearSessions(siteId: string): Promise<void> {
  await cbUpsert('sessions', siteId, { sessions: [] });
  emitToSite(siteId, 'session', { sessions: [], cleared: true });
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

export async function getDistributionState(siteId: string): Promise<DistributionState> {
  const doc = await cbGet<DistributionState>('counters', `${siteId}_dist`);
  return doc ?? { isDistributing: false, cancelRequested: false };
}

export async function setDistributionActive(
  siteId: string,
  runId: string,
  active: boolean
): Promise<void> {
  const current = await getDistributionState(siteId);
  await cbUpsert('counters', `${siteId}_dist`, {
    isDistributing: active,
    runId: active ? runId : current.runId,
    startedAt: active ? new Date().toISOString() : current.startedAt,
    // When deactivating: always clear cancelRequested (run is done).
    // When activating: preserve an existing true flag so a Stop All that
    // arrived during setup is not silently discarded.
    cancelRequested: active ? current.cancelRequested : false,
  });
}

export async function setDistributionCancelRequested(siteId: string): Promise<void> {
  const current = await getDistributionState(siteId);
  await cbUpsert('counters', `${siteId}_dist`, { ...current, cancelRequested: true });
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

function memoryKey(siteId: string, personaId: string): string {
  return `persona_mem_${siteId}_${personaId}`;
}

/**
 * Returns the last N approved queries for a persona, newest-first.
 * Prunes entries older than MEMORY_MAX_AGE_DAYS automatically.
 */
export async function getPersonaQueryMemory(
  siteId: string,
  personaId: string
): Promise<string[]> {
  const doc = await cbGet<PersonaMemoryDoc>('agentData', memoryKey(siteId, personaId));
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
  siteId: string,
  personaId: string,
  query: string
): Promise<void> {
  const doc = await cbGet<PersonaMemoryDoc>('agentData', memoryKey(siteId, personaId));
  const existing = doc?.entries ?? [];

  const deduped = existing.filter(
    (e) => e.query.toLowerCase() !== query.toLowerCase()
  );

  const updated: PersonaMemoryEntry[] = [
    { query, timestamp: new Date().toISOString() },
    ...deduped,
  ].slice(0, MAX_PERSONA_MEMORY);

  await cbUpsert('agentData', memoryKey(siteId, personaId), { entries: updated });
}
