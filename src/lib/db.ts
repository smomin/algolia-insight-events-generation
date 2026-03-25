import { cbGet, cbUpsert, cbDelete, cbGetIndex, cbAddToIndex, cbRemoveFromIndex } from '@/lib/couchbase';
import { emitToIndustry } from '@/lib/sse';

// Module-level constant so the env var is parsed once at startup.
const DAILY_LIMIT = parseInt(process.env.DAILY_EVENT_LIMIT_PER_INDEX ?? '1000', 10);
import type {
  IndustryV2,
  IndustryCounters,
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
// Industry config CRUD
// ─────────────────────────────────────────────

export async function getAllIndustryConfigs(): Promise<Record<string, IndustryV2>> {
  const keys = await cbGetIndex('industryConfigs');
  const entries = await Promise.all(
    keys.map(async (id) => {
      const cfg = await cbGet<IndustryV2>('industryConfigs', id);
      return cfg ? ([id, cfg] as const) : null;
    })
  );
  return Object.fromEntries(
    entries.filter((e): e is [string, IndustryV2] => e !== null)
  );
}

export async function getIndustryConfig(id: string): Promise<IndustryV2 | null> {
  return cbGet<IndustryV2>('industryConfigs', id);
}

export async function saveIndustryConfig(config: IndustryV2): Promise<void> {
  await cbUpsert('industryConfigs', config.id, {
    ...config,
    updatedAt: new Date().toISOString(),
  });
  await cbAddToIndex('industryConfigs', config.id);
}

export async function deleteIndustryConfig(id: string): Promise<void> {
  await cbDelete('industryConfigs', id);
  await cbRemoveFromIndex('industryConfigs', id);
}

// ─────────────────────────────────────────────
// Counters (N-index, per industry)
// ─────────────────────────────────────────────

async function readCounters(industryId: string): Promise<IndustryCounters> {
  const doc = await cbGet<IndustryCounters>('counters', industryId);
  return doc ?? { date: getToday(), byIndex: {} };
}

export async function getTodayCounters(industryId: string): Promise<IndustryCounters> {
  const counters = await readCounters(industryId);
  if (counters.date !== getToday()) {
    const fresh: IndustryCounters = { date: getToday(), byIndex: {} };
    await cbUpsert('counters', industryId, fresh);
    return fresh;
  }
  return counters;
}

/** Ensures counters are for today. Delegates to getTodayCounters. */
export async function resetCountersIfNewDay(industryId: string): Promise<void> {
  await getTodayCounters(industryId);
}

export async function incrementIndexCounter(
  industryId: string,
  indexId: string,
  amount: number
): Promise<void> {
  const counters = await getTodayCounters(industryId);
  counters.byIndex[indexId] = (counters.byIndex[indexId] ?? 0) + amount;
  await cbUpsert('counters', industryId, counters);
  emitToIndustry(industryId, 'counters', counters);
}

export async function getRemainingBudget(
  industryId: string,
  indexId: string
): Promise<number> {
  const counters = await getTodayCounters(industryId);
  return Math.max(0, DAILY_LIMIT - (counters.byIndex[indexId] ?? 0));
}

// ─────────────────────────────────────────────
// Event log
// ─────────────────────────────────────────────

export async function appendEventLog(
  industryId: string,
  events: SentEvent[]
): Promise<void> {
  const doc = await cbGet<{ events: SentEvent[] }>('eventLogs', industryId);
  const existing = doc?.events ?? [];
  const updated = [...existing, ...events].slice(-MAX_EVENT_LOG);
  await cbUpsert('eventLogs', industryId, { events: updated });
  // Push only the newly-added batch; clients prepend these to their local list
  emitToIndustry(industryId, 'event-log', { events });
}

export async function getEventLog(industryId: string): Promise<SentEvent[]> {
  const doc = await cbGet<{ events: SentEvent[] }>('eventLogs', industryId);
  return (doc?.events ?? []).slice().reverse();
}

export async function clearEventLog(industryId: string): Promise<void> {
  await cbUpsert('eventLogs', industryId, { events: [] });
  emitToIndustry(industryId, 'event-log', { events: [], cleared: true });
}

// ─────────────────────────────────────────────
// Scheduler runs
// ─────────────────────────────────────────────

export async function appendSchedulerRun(
  industryId: string,
  run: SchedulerRun
): Promise<void> {
  const doc = await cbGet<{ runs: SchedulerRun[] }>('schedulerRuns', industryId);
  const runs = [run, ...(doc?.runs ?? [])].slice(0, MAX_SCHEDULER_RUNS);
  await cbUpsert('schedulerRuns', industryId, { runs });
}

export async function getLastSchedulerRun(
  industryId: string
): Promise<SchedulerRun | null> {
  const doc = await cbGet<{ runs: SchedulerRun[] }>('schedulerRuns', industryId);
  return doc?.runs[0] ?? null;
}

export async function getSchedulerRuns(industryId: string): Promise<SchedulerRun[]> {
  const doc = await cbGet<{ runs: SchedulerRun[] }>('schedulerRuns', industryId);
  return doc?.runs ?? [];
}

// ─────────────────────────────────────────────
// Session history
// ─────────────────────────────────────────────

export async function appendSession(
  industryId: string,
  session: SessionRecord
): Promise<void> {
  const doc = await cbGet<{ sessions: SessionRecord[] }>('sessions', industryId);
  const sessions = [session, ...(doc?.sessions ?? [])].slice(0, MAX_SESSIONS);
  await cbUpsert('sessions', industryId, { sessions });
  // Push only the single new record; clients prepend it to their local list
  emitToIndustry(industryId, 'session', { session });
}

export async function getSessions(industryId: string): Promise<SessionRecord[]> {
  const doc = await cbGet<{ sessions: SessionRecord[] }>('sessions', industryId);
  return doc?.sessions ?? [];
}

export async function clearSessions(industryId: string): Promise<void> {
  await cbUpsert('sessions', industryId, { sessions: [] });
  emitToIndustry(industryId, 'session', { sessions: [], cleared: true });
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

export async function getDistributionState(industryId: string): Promise<DistributionState> {
  const doc = await cbGet<DistributionState>('counters', `${industryId}_dist`);
  return doc ?? { isDistributing: false, cancelRequested: false };
}

export async function setDistributionActive(
  industryId: string,
  runId: string,
  active: boolean
): Promise<void> {
  const current = await getDistributionState(industryId);
  await cbUpsert('counters', `${industryId}_dist`, {
    isDistributing: active,
    runId: active ? runId : current.runId,
    startedAt: active ? new Date().toISOString() : current.startedAt,
    // Always clear cancelRequested (on both activate and deactivate) so a
    // previous stop request never bleeds into the next run.
    cancelRequested: false,
  });
}

export async function setDistributionCancelRequested(industryId: string): Promise<void> {
  const current = await getDistributionState(industryId);
  await cbUpsert('counters', `${industryId}_dist`, { ...current, cancelRequested: true });
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

function memoryKey(industryId: string, personaId: string): string {
  return `persona_mem_${industryId}_${personaId}`;
}

/**
 * Returns the last N approved queries for a persona, newest-first.
 * Prunes entries older than MEMORY_MAX_AGE_DAYS automatically.
 */
export async function getPersonaQueryMemory(
  industryId: string,
  personaId: string
): Promise<string[]> {
  const doc = await cbGet<PersonaMemoryDoc>('agentData', memoryKey(industryId, personaId));
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
  industryId: string,
  personaId: string,
  query: string
): Promise<void> {
  const doc = await cbGet<PersonaMemoryDoc>('agentData', memoryKey(industryId, personaId));
  const existing = doc?.entries ?? [];

  // Deduplicate: drop any existing entry for the exact same query string (case-insensitive)
  const deduped = existing.filter(
    (e) => e.query.toLowerCase() !== query.toLowerCase()
  );

  const updated: PersonaMemoryEntry[] = [
    { query, timestamp: new Date().toISOString() },
    ...deduped,
  ].slice(0, MAX_PERSONA_MEMORY);

  await cbUpsert('agentData', memoryKey(industryId, personaId), { entries: updated });
}
