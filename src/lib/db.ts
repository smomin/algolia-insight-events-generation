import { cbGet, cbUpsert, cbDelete, cbGetIndex, cbAddToIndex, cbRemoveFromIndex } from '@/lib/couchbase';
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

export async function resetCountersIfNewDay(industryId: string): Promise<void> {
  const counters = await readCounters(industryId);
  if (counters.date !== getToday()) {
    await cbUpsert('counters', industryId, { date: getToday(), byIndex: {} });
  }
}

export async function getTodayCounters(industryId: string): Promise<IndustryCounters> {
  await resetCountersIfNewDay(industryId);
  return readCounters(industryId);
}

export async function incrementIndexCounter(
  industryId: string,
  indexId: string,
  amount: number
): Promise<void> {
  const counters = await getTodayCounters(industryId);
  counters.byIndex[indexId] = (counters.byIndex[indexId] ?? 0) + amount;
  await cbUpsert('counters', industryId, counters);
}

export async function getRemainingBudget(
  industryId: string,
  indexId: string
): Promise<number> {
  await resetCountersIfNewDay(industryId);
  const counters = await readCounters(industryId);
  const limit = parseInt(process.env.DAILY_EVENT_LIMIT_PER_INDEX ?? '1000', 10);
  return Math.max(0, limit - (counters.byIndex[indexId] ?? 0));
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
}

export async function getEventLog(industryId: string): Promise<SentEvent[]> {
  const doc = await cbGet<{ events: SentEvent[] }>('eventLogs', industryId);
  return (doc?.events ?? []).slice().reverse();
}

export async function clearEventLog(industryId: string): Promise<void> {
  await cbUpsert('eventLogs', industryId, { events: [] });
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
}

export async function getSessions(industryId: string): Promise<SessionRecord[]> {
  const doc = await cbGet<{ sessions: SessionRecord[] }>('sessions', industryId);
  return doc?.sessions ?? [];
}

export async function clearSessions(industryId: string): Promise<void> {
  await cbUpsert('sessions', industryId, { sessions: [] });
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
    // Always clear cancelRequested when deactivating so a previous stop
    // request never bleeds into the next run or causes a stuck "Stopping…" state.
    cancelRequested: active ? false : false,
  });
}

export async function setDistributionCancelRequested(industryId: string): Promise<void> {
  const current = await getDistributionState(industryId);
  await cbUpsert('counters', `${industryId}_dist`, { ...current, cancelRequested: true });
}
