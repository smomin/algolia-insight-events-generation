import cron from 'node-cron';
import type { Persona, SchedulerRun, IndustryV2, FlexIndex } from '@/types';
import {
  resetCountersIfNewDay,
  getRemainingBudget,
  incrementIndexCounter,
  appendEventLog,
  appendSchedulerRun,
  appendSession,
  setDistributionActive,
  setDistributionCancelRequested,
  getDistributionState,
} from '@/lib/db';
import { searchIndex } from '@/lib/algolia';
import {
  generatePrimaryQuery,
  selectBestResult,
  generateSecondaryQueries,
} from '@/lib/anthropic';
import {
  buildFlexIndexEvents,
  buildCartProduct,
  sendEvents,
  toSentEvents,
} from '@/lib/insights';

// ─────────────────────────────────────────────
// Per-industry scheduler state (in-memory)
// ─────────────────────────────────────────────

interface IndustrySchedulerState {
  task: cron.ScheduledTask | null;
  currentRun: SchedulerRun | null;
  isDistributing: boolean;
  cancelRequested: boolean;
}

const states = new Map<string, IndustrySchedulerState>();

function getState(industryId: string): IndustrySchedulerState {
  if (!states.has(industryId)) {
    states.set(industryId, { task: null, currentRun: null, isDistributing: false, cancelRequested: false });
  }
  return states.get(industryId)!;
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function generateId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─────────────────────────────────────────────
// Core: run a single persona session (N-index)
// ─────────────────────────────────────────────

export async function runPersonaSession(
  persona: Persona,
  industry: IndustryV2
): Promise<{
  eventsByIndex: Record<string, number>;
  totalEvents: number;
  sessionId: string;
  error?: string;
}> {
  const sessionId = generateSessionId();
  const startedAt = new Date().toISOString();

  const primaryIndex = industry.indices.find((i) => i.role === 'primary');
  const secondaryIndices = industry.indices.filter((i) => i.role === 'secondary');

  if (!primaryIndex) {
    const err = 'No primary index configured for this industry';
    await _recordSession(industry.id, sessionId, persona, startedAt, {}, false, err);
    return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
  }

  const tag = `[${industry.id}:${persona.name}]`;
  console.log(`${tag} session started (${sessionId})`);

  try {
    // ── 1. Generate primary search query via Claude ──
    console.log(`${tag} step 1/5 — generating primary query via Claude`);
    const primaryQuery = await generatePrimaryQuery(
      persona,
      industry.claudePrompts.generatePrimaryQuery,
      industry.id
    );
    console.log(`${tag} step 1/5 — query: "${primaryQuery}"`);

    // ── 2. Search primary index ──
    console.log(`${tag} step 2/5 — searching "${primaryIndex.indexName}"`);
    const { hits: primaryHits, queryID: primaryQueryID } = await searchIndex(
      primaryIndex.indexName,
      primaryQuery,
      persona.userToken,
      10,
      industry.id
    );

    if (!primaryHits.length || !primaryQueryID) {
      const err = `No primary results for "${primaryQuery}" in index "${primaryIndex.indexName}"`;
      console.warn(`${tag} ${err}`);
      await _recordSession(industry.id, sessionId, persona, startedAt, {}, false, err);
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
    }
    console.log(`${tag} step 2/5 — got ${primaryHits.length} hits (queryID: ${primaryQueryID})`);

    // ── 3. Claude selects best result ──
    console.log(`${tag} step 3/5 — Claude selecting best result`);
    const { index: selectedIdx, reason } = await selectBestResult(
      persona,
      primaryHits,
      industry.claudePrompts.selectBestResult,
      industry.id
    );
    const selectedHit = primaryHits[selectedIdx];
    const position = selectedIdx + 1;

    console.log(`${tag} step 3/5 — selected hit[${selectedIdx}]: ${reason}`);

    // ── 4. Build primary events ──
    const primaryEvts = buildFlexIndexEvents(
      persona,
      primaryIndex,
      selectedHit,
      position,
      primaryQueryID,
      []
    );

    console.log(`${tag} step 4/5 — built ${primaryEvts.length} primary events`);

    // ── 5. For each secondary index: search + build events ──
    const secondaryEvtsByIndex: Record<
      string,
      { index: FlexIndex; events: ReturnType<typeof buildFlexIndexEvents> }
    > = {};

    if (secondaryIndices.length > 0) {
      console.log(`${tag} step 5/5 — searching ${secondaryIndices.length} secondary index(es)`);
      const secQueries = await generateSecondaryQueries(
        selectedHit,
        persona,
        industry.claudePrompts.generateSecondaryQueries,
        industry.id
      );

      for (const secIdx of secondaryIndices) {
        const secResults = await Promise.all(
          secQueries.map((q) =>
            searchIndex(secIdx.indexName, q, persona.userToken, 20, industry.id).catch(() => null)
          )
        );

        let cartProducts = secResults
          .map((result, i) => {
            if (!result || !result.hits.length || !result.queryID) return null;
            return buildCartProduct(result.hits[0], result.queryID, i + 1);
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);

        if (cartProducts.length === 0) {
          const fallbackQuery =
            (selectedHit.name as string) ??
            (selectedHit.title as string) ??
            selectedHit.objectID;
          const fallback = await searchIndex(
            secIdx.indexName,
            fallbackQuery,
            persona.userToken,
            20,
            industry.id
          ).catch(() => null);
          if (fallback?.hits.length && fallback.queryID) {
            cartProducts = [buildCartProduct(fallback.hits[0], fallback.queryID, 1)];
          }
        }

        if (cartProducts.length > 0) {
          const secHit: { objectID: string } = cartProducts[0];
          const evts = buildFlexIndexEvents(
            persona,
            secIdx,
            secHit,
            1,
            cartProducts[0].queryID,
            cartProducts
          );
          secondaryEvtsByIndex[secIdx.id] = { index: secIdx, events: evts };
        }
      }
    }

    // ── 6. Collect all events ──
    console.log(`${tag} step 5/5 — secondary events built: ${JSON.stringify(Object.fromEntries(Object.entries(secondaryEvtsByIndex).map(([k, v]) => [k, v.events.length])))}`);
    const allEvents = [
      ...primaryEvts,
      ...Object.values(secondaryEvtsByIndex).flatMap((x) => x.events),
    ];

    if (allEvents.length === 0) {
      const err = 'No events built — check that indices have events configured';
      console.warn(`${tag} ${err}`);
      await _recordSession(industry.id, sessionId, persona, startedAt, {}, false, err);
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
    }

    // ── 7. Send all events in one batch ──
    console.log(`${tag} sending ${allEvents.length} total events to Insights API`);
    const status = await sendEvents(allEvents, industry.id);

    if (status === 200) {
      const eventsByIndex: Record<string, number> = {
        [primaryIndex.id]: primaryEvts.length,
      };

      await incrementIndexCounter(industry.id, primaryIndex.id, primaryEvts.length);

      for (const [indexId, { events: evts }] of Object.entries(secondaryEvtsByIndex)) {
        eventsByIndex[indexId] = evts.length;
        await incrementIndexCounter(industry.id, indexId, evts.length);
      }

      const sentMeta = {
        industryId: industry.id,
        personaId: persona.id,
        personaName: persona.name,
        sessionId,
      };
      await appendEventLog(industry.id, toSentEvents(allEvents, status, sentMeta));

      await _recordSession(
        industry.id,
        sessionId,
        persona,
        startedAt,
        eventsByIndex,
        true
      );

      console.log(
        `${tag} ✓ sent ${allEvents.length} events across ${Object.keys(eventsByIndex).length} indices | reason: "${reason}"`
      );

      return { eventsByIndex, totalEvents: allEvents.length, sessionId };
    } else {
      const err = `Insights API returned HTTP ${status}`;
      console.error(`${tag} ✗ ${err}`);
      await _recordSession(industry.id, sessionId, persona, startedAt, {}, false, err);
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} ✗ uncaught error:`, err);
    await _recordSession(industry.id, sessionId, persona, startedAt, {}, false, msg);
    return { eventsByIndex: {}, totalEvents: 0, sessionId, error: msg };
  }
}

async function _recordSession(
  industryId: string,
  sessionId: string,
  persona: Persona,
  startedAt: string,
  eventsByIndex: Record<string, number>,
  success: boolean,
  error?: string
): Promise<void> {
  await appendSession(industryId, {
    id: sessionId,
    industryId,
    personaId: persona.id,
    personaName: persona.name,
    startedAt,
    completedAt: new Date().toISOString(),
    totalEventsCount: Object.values(eventsByIndex).reduce((s, n) => s + n, 0),
    eventsByIndex,
    success,
    error,
  });
}

// ─────────────────────────────────────────────
// Distribution run — cycles through personas until budget is used
// ─────────────────────────────────────────────

export async function distributeSessionsForDay(
  personas: Persona[],
  industry: IndustryV2
): Promise<SchedulerRun> {
  const state = getState(industry.id);

  // Guard against concurrent runs — check both in-memory and persisted state
  const persistedState = await getDistributionState(industry.id);
  if (state.isDistributing || persistedState.isDistributing) {
    return (
      state.currentRun ?? {
        id: generateId(),
        industryId: industry.id,
        startedAt: new Date().toISOString(),
        sessionsPlanned: 0,
        sessionsCompleted: 0,
        totalEventsSent: 0,
        eventsByIndex: {},
        errors: ['Already distributing'],
      }
    );
  }

  state.isDistributing = true;
  await resetCountersIfNewDay(industry.id);

  // Calculate max sessions constrained by the index with least budget
  let maxSessions = Infinity;
  for (const idx of industry.indices) {
    if (idx.events.length === 0) continue;
    const remaining = await getRemainingBudget(industry.id, idx.id);
    maxSessions = Math.min(maxSessions, Math.floor(remaining / idx.events.length));
  }
  const finalMax = isFinite(maxSessions) && maxSessions > 0 ? maxSessions : 0;

  const run: SchedulerRun = {
    id: generateId(),
    industryId: industry.id,
    startedAt: new Date().toISOString(),
    sessionsPlanned: finalMax,
    sessionsCompleted: 0,
    totalEventsSent: 0,
    eventsByIndex: {},
    errors: [],
  };
  state.currentRun = run;
  // Persist active state to Couchbase so status survives hot reloads
  await setDistributionActive(industry.id, run.id, true);

  if (finalMax === 0) {
    run.completedAt = new Date().toISOString();
    await appendSchedulerRun(industry.id, run);
    state.currentRun = null;
    state.isDistributing = false;
    await setDistributionActive(industry.id, run.id, false);
    return run;
  }

  const shuffled = shuffle(personas);
  const sessionPersonas: Persona[] = [];
  for (let i = 0; i < finalMax; i++) {
    sessionPersonas.push(shuffled[i % shuffled.length]);
  }

  let sessionIndex = 0;
  for (const persona of sessionPersonas) {
    sessionIndex++;

    // Check in-memory cancel flag
    if (state.cancelRequested) {
      console.log(`[${industry.id}] Distribution cancelled (in-memory) after ${run.sessionsCompleted} sessions`);
      break;
    }
    // Every 5 sessions also check the persisted cancel flag (survives hot reloads)
    if (sessionIndex % 5 === 0) {
      const dist = await getDistributionState(industry.id);
      if (dist.cancelRequested) {
        console.log(`[${industry.id}] Distribution cancelled (persisted) after ${run.sessionsCompleted} sessions`);
        state.cancelRequested = true;
        break;
      }
    }

    // Check budget for all indices before each session
    let canRun = true;
    for (const idx of industry.indices) {
      if (idx.events.length === 0) continue;
      const remaining = await getRemainingBudget(industry.id, idx.id);
      if (remaining < idx.events.length) { canRun = false; break; }
    }
    if (!canRun) break;

    const result = await runPersonaSession(persona, industry);

    if (result.error) {
      run.errors.push(`${persona.name}: ${result.error}`);
    } else {
      run.sessionsCompleted++;
      run.totalEventsSent += result.totalEvents;
      for (const [indexId, count] of Object.entries(result.eventsByIndex)) {
        run.eventsByIndex[indexId] = (run.eventsByIndex[indexId] ?? 0) + count;
      }
    }

    await sleep(randomInt(500, 2000));
  }

  run.completedAt = new Date().toISOString();
  await appendSchedulerRun(industry.id, run);
  state.currentRun = null;
  state.isDistributing = false;
  state.cancelRequested = false;
  // Clear persisted active state so status is accurate after hot reload
  await setDistributionActive(industry.id, run.id, false);

  console.log(
    `[${industry.id}] Distribution complete — ` +
    `${run.sessionsCompleted}/${run.sessionsPlanned} sessions OK, ` +
    `${run.totalEventsSent} events sent, ` +
    `${run.errors.length} errors`
  );
  if (run.errors.length > 0) {
    console.error(`[${industry.id}] Session errors:\n${run.errors.map((e) => `  • ${e}`).join('\n')}`);
  }

  return run;
}

// ─────────────────────────────────────────────
// Scheduler lifecycle — per industry
// ─────────────────────────────────────────────

export function startScheduler(personas: Persona[], industry: IndustryV2): void {
  const state = getState(industry.id);
  if (state.task) return;

  const cronExpr = process.env.SCHEDULER_CRON ?? '0 6 * * *';
  const tz = process.env.SCHEDULER_TIMEZONE ?? 'America/Los_Angeles';

  state.task = cron.schedule(
    cronExpr,
    () => { distributeSessionsForDay(personas, industry).catch(console.error); },
    { timezone: tz }
  );

  console.log(`[Scheduler:${industry.id}] Started. Cron: "${cronExpr}" (${tz})`);
}

export function stopScheduler(industryId: string): void {
  const state = getState(industryId);
  if (state.task) {
    state.task.stop();
    state.task = null;
    console.log(`[Scheduler:${industryId}] Stopped.`);
  }
}

/** Cancel any in-progress distribution run for the given industry. */
export async function cancelDistribution(industryId: string): Promise<void> {
  const state = getState(industryId);
  // Always set both flags so cancellation works even after a hot reload
  state.cancelRequested = true;
  await setDistributionCancelRequested(industryId);
  console.log(`[Scheduler:${industryId}] Cancel requested (in-memory + persisted).`);
}

export function isSchedulerRunning(industryId: string): boolean {
  return getState(industryId).task !== null;
}

export function isDistributing(industryId: string): boolean {
  return getState(industryId).isDistributing;
}

export function getCurrentRun(industryId: string): SchedulerRun | null {
  return getState(industryId).currentRun;
}

export function getNextRunTime(): string | null {
  try {
    const cronExpr = process.env.SCHEDULER_CRON ?? '0 6 * * *';
    const parts = cronExpr.split(' ');
    const minute = parts[0];
    const hour = parts[1];
    const now = new Date();
    const next = new Date();
    next.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toISOString();
  } catch {
    return null;
  }
}

export function getNextRunTimeForIndustry(industryId: string): string | null {
  if (!isSchedulerRunning(industryId)) return null;
  return getNextRunTime();
}
