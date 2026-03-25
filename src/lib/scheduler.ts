import cron from 'node-cron';
import type { Persona, SchedulerRun, SiteConfig, FlexIndex } from '@/types';
import { emitToSite } from '@/lib/sse';
import { createLogger } from '@/lib/logger';
import { shuffle, sleep, randomInt, generateId as _generateId } from '@/lib/utils';

const log = createLogger('Scheduler');
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
// Per-site scheduler state (in-memory)
// ─────────────────────────────────────────────

interface SiteSchedulerState {
  task: cron.ScheduledTask | null;
  currentRun: SchedulerRun | null;
  isDistributing: boolean;
  cancelRequested: boolean;
}

const states = new Map<string, SiteSchedulerState>();

function getState(siteId: string): SiteSchedulerState {
  if (!states.has(siteId)) {
    states.set(siteId, { task: null, currentRun: null, isDistributing: false, cancelRequested: false });
  }
  return states.get(siteId)!;
}

// ─────────────────────────────────────────────
// SSE status helper
// ─────────────────────────────────────────────

/**
 * Emit the current scheduler status for a site to all connected SSE clients.
 * Pass `lastRun` only when a run has just completed so clients can display it.
 */
function emitStatus(siteId: string, overrides: Record<string, unknown> = {}): void {
  const state = getState(siteId);
  emitToSite(siteId, 'status', {
    isRunning: state.task !== null,
    isDistributing: state.isDistributing,
    cancelRequested: state.cancelRequested,
    currentRun: state.currentRun
      ? { sessionsCompleted: state.currentRun.sessionsCompleted, errors: state.currentRun.errors }
      : null,
    ...overrides,
  });
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function generateRunId(): string { return _generateId('run'); }
function generateSessionId(): string { return _generateId('sess'); }

// ─────────────────────────────────────────────
// Core: run a single persona session (N-index)
// ─────────────────────────────────────────────

export async function runPersonaSession(
  persona: Persona,
  site: SiteConfig
): Promise<{
  eventsByIndex: Record<string, number>;
  totalEvents: number;
  sessionId: string;
  error?: string;
}> {
  const sessionId = generateSessionId();
  const startedAt = new Date().toISOString();

  const primaryIndex = site.indices.find((i) => i.role === 'primary');
  const secondaryIndices = site.indices.filter((i) => i.role === 'secondary');

  if (!primaryIndex) {
    const err = 'No primary index configured for this site';
    await _recordSession(site.id, sessionId, persona, startedAt, {}, false, err);
    return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
  }

  const sessionLog = log.child(`${site.id}:${persona.name}`);
  sessionLog.info('session start', { sessionId });

  try {
    // ── 1. Generate primary search query via LLM ──
    sessionLog.debug('step 1/5 — generating primary query via LLM');
    const primaryQuery = await generatePrimaryQuery(
      persona,
      site.claudePrompts.generatePrimaryQuery,
      site.id
    );
    sessionLog.info('primary query generated', { query: primaryQuery });

    // ── 2. Search primary index ──
    sessionLog.debug('step 2/5 — searching primary index', { index: primaryIndex.indexName });
    const { hits: primaryHits, queryID: primaryQueryID } = await searchIndex(
      primaryIndex.indexName,
      primaryQuery,
      persona.userToken,
      10,
      site.id
    );

    if (!primaryHits.length || !primaryQueryID) {
      const err = `No primary results for "${primaryQuery}" in index "${primaryIndex.indexName}"`;
      sessionLog.warn(err);
      await _recordSession(site.id, sessionId, persona, startedAt, {}, false, err);
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
    }
    sessionLog.debug('step 2/5 done', { hitCount: primaryHits.length, queryID: primaryQueryID });

    // ── 3. LLM selects best result ──
    sessionLog.debug('step 3/5 — LLM selecting best result');
    const { index: selectedIdx, reason } = await selectBestResult(
      persona,
      primaryHits,
      site.claudePrompts.selectBestResult,
      site.id
    );
    const selectedHit = primaryHits[selectedIdx];
    const position = selectedIdx + 1;

    sessionLog.debug('step 3/5 done', { selectedIndex: selectedIdx, reason });

    if (!selectedHit) {
      const err = `LLM returned an out-of-range hit index (${selectedIdx}) for ${primaryHits.length} results`;
      sessionLog.warn(err);
      await _recordSession(site.id, sessionId, persona, startedAt, {}, false, err);
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
    }

    // ── 4. Build primary events ──
    const primaryEvts = buildFlexIndexEvents(
      persona,
      primaryIndex,
      selectedHit,
      position,
      primaryQueryID,
      []
    );

    sessionLog.debug('step 4/5 — primary events built', { count: primaryEvts.length });

    // ── 5. For each secondary index: search + build events ──
    const secondaryEvtsByIndex: Record<
      string,
      { index: FlexIndex; events: ReturnType<typeof buildFlexIndexEvents> }
    > = {};

    if (secondaryIndices.length > 0) {
      sessionLog.debug(`step 5/5 — searching ${secondaryIndices.length} secondary index(es)`);
      const secQueries = await generateSecondaryQueries(
        selectedHit,
        persona,
        site.claudePrompts.generateSecondaryQueries,
        site.id,
        secondaryIndices.map((si) => ({ id: si.id, label: si.label }))
      );

      for (const secIdx of secondaryIndices) {
        const secResults = await Promise.all(
          secQueries.map((q) =>
            searchIndex(secIdx.indexName, q, persona.userToken, 20, site.id).catch(() => null)
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
            site.id
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
    const secondaryEventCounts = Object.fromEntries(Object.entries(secondaryEvtsByIndex).map(([k, v]) => [k, v.events.length]));
    sessionLog.debug('step 5/5 done', { secondaryEventsByIndex: secondaryEventCounts });

    const allEvents = [
      ...primaryEvts,
      ...Object.values(secondaryEvtsByIndex).flatMap((x) => x.events),
    ];

    if (allEvents.length === 0) {
      const err = 'No events built — check that indices have events configured';
      sessionLog.warn(err);
      await _recordSession(site.id, sessionId, persona, startedAt, {}, false, err);
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
    }

    // ── 7. Send all events in one batch ──
    sessionLog.debug('sending events to Insights API', { totalEvents: allEvents.length });
    const status = await sendEvents(allEvents, site.id);

    if (status === 200) {
      const eventsByIndex: Record<string, number> = {
        [primaryIndex.id]: primaryEvts.length,
      };

      await incrementIndexCounter(site.id, primaryIndex.id, primaryEvts.length);

      for (const [indexId, { events: evts }] of Object.entries(secondaryEvtsByIndex)) {
        eventsByIndex[indexId] = evts.length;
        await incrementIndexCounter(site.id, indexId, evts.length);
      }

      const sentMeta = {
        siteId: site.id,
        personaId: persona.id,
        personaName: persona.name,
        sessionId,
      };
      await appendEventLog(site.id, toSentEvents(allEvents, status, sentMeta));

      await _recordSession(
        site.id,
        sessionId,
        persona,
        startedAt,
        eventsByIndex,
        true
      );

      sessionLog.info('session complete', {
        sessionId,
        totalEvents: allEvents.length,
        eventsByIndex,
        indices: Object.keys(eventsByIndex).length,
        durationMs: Date.now() - new Date(startedAt).getTime(),
        reason,
      });

      return { eventsByIndex, totalEvents: allEvents.length, sessionId };
    } else {
      const err = `Insights API returned HTTP ${status}`;
      sessionLog.error(err, { sessionId, status });
      await _recordSession(site.id, sessionId, persona, startedAt, {}, false, err);
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sessionLog.error('uncaught session error', err instanceof Error ? err : { message: msg });
    try { await _recordSession(site.id, sessionId, persona, startedAt, {}, false, msg); } catch { /* swallow so caller always gets a result */ }
    return { eventsByIndex: {}, totalEvents: 0, sessionId, error: msg };
  }
}

async function _recordSession(
  siteId: string,
  sessionId: string,
  persona: Persona,
  startedAt: string,
  eventsByIndex: Record<string, number>,
  success: boolean,
  error?: string
): Promise<void> {
  await appendSession(siteId, {
    id: sessionId,
    siteId,
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
  site: SiteConfig
): Promise<SchedulerRun> {
  const state = getState(site.id);

  const distLog = log.child(site.id);

  // Guard against concurrent runs — check both in-memory and persisted state
  const persistedState = await getDistributionState(site.id);
  if (state.isDistributing || persistedState.isDistributing) {
    distLog.warn('distribution already in progress — skipping duplicate request');
    return (
      state.currentRun ?? {
        id: generateRunId(),
        siteId: site.id,
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
  // Only clear in-memory cancel if the DB has no pending cancel (to preserve a
  // Stop All that was requested while this function was being scheduled).
  const preStartState = await getDistributionState(site.id);
  if (!preStartState.cancelRequested) {
    state.cancelRequested = false;
  }
  await resetCountersIfNewDay(site.id);
  emitStatus(site.id, { lastRun: null });

  // Calculate max sessions constrained by the index with least budget
  let maxSessions = Infinity;
  for (const idx of site.indices) {
    if (idx.events.length === 0) continue;
    const remaining = await getRemainingBudget(site.id, idx.id);
    maxSessions = Math.min(maxSessions, Math.floor(remaining / idx.events.length));
  }
  const finalMax = isFinite(maxSessions) && maxSessions > 0 ? maxSessions : 0;

  const run: SchedulerRun = {
    id: generateRunId(),
    siteId: site.id,
    startedAt: new Date().toISOString(),
    sessionsPlanned: finalMax,
    sessionsCompleted: 0,
    totalEventsSent: 0,
    eventsByIndex: {},
    errors: [],
  };
  state.currentRun = run;
  // Persist active state to Couchbase so status survives hot reloads
  await setDistributionActive(site.id, run.id, true);

  // Early-exit: Stop All may have been called during setup.
  // setDistributionActive now preserves a pending DB cancel, so re-check here.
  if (state.cancelRequested || (await getDistributionState(site.id)).cancelRequested) {
    distLog.info('distribution cancelled before loop start');
    run.completedAt = new Date().toISOString();
    run.errors.push('Cancelled before start');
    state.currentRun = null;
    state.isDistributing = false;
    state.cancelRequested = false;
    await setDistributionActive(site.id, run.id, false);
    emitStatus(site.id, { lastRun: run });
    return run;
  }

  distLog.info('distribution start', {
    runId: run.id,
    personas: personas.length,
    maxSessions: finalMax,
  });

  if (finalMax === 0) {
    distLog.warn('budget fully exhausted — no sessions to run');
    run.completedAt = new Date().toISOString();
    await appendSchedulerRun(site.id, run);
    state.currentRun = null;
    state.isDistributing = false;
    await setDistributionActive(site.id, run.id, false);
    emitStatus(site.id, { lastRun: run });
    return run;
  }

  const shuffled = shuffle(personas);
  const sessionPersonas: Persona[] = [];
  for (let i = 0; i < finalMax; i++) {
    sessionPersonas.push(shuffled[i % shuffled.length]);
  }

  try {
    let sessionIndex = 0;
    for (const persona of sessionPersonas) {
      sessionIndex++;

      if (state.cancelRequested) {
        distLog.info('distribution cancelled (in-memory)', { sessionsCompleted: run.sessionsCompleted });
        break;
      }
      // Check DB on every session — handles hot-reload module isolation in dev
      // where the stop route may write to a different in-memory states Map.
      const dist = await getDistributionState(site.id);
      if (dist.cancelRequested) {
        distLog.info('distribution cancelled (persisted)', { sessionsCompleted: run.sessionsCompleted });
        state.cancelRequested = true;
        break;
      }

      // Check budget for all indices before each session
      let canRun = true;
      for (const idx of site.indices) {
        if (idx.events.length === 0) continue;
        const remaining = await getRemainingBudget(site.id, idx.id);
        if (remaining < idx.events.length) { canRun = false; break; }
      }
      if (!canRun) {
        distLog.info('budget check failed — stopping distribution', { sessionsCompleted: run.sessionsCompleted });
        break;
      }

      const result = await runPersonaSession(persona, site);

      if (result.error) {
        distLog.warn('session error', { persona: persona.name, error: result.error, sessionId: result.sessionId });
        run.errors.push(`${persona.name}: ${result.error}`);
      } else {
        run.sessionsCompleted++;
        run.totalEventsSent += result.totalEvents;
        distLog.debug(`session ${run.sessionsCompleted}/${finalMax} complete`, {
          persona: persona.name,
          events: result.totalEvents,
        });
        for (const [indexId, count] of Object.entries(result.eventsByIndex)) {
          run.eventsByIndex[indexId] = (run.eventsByIndex[indexId] ?? 0) + count;
        }
      }

      // Push progress update so SchedulerControls shows live session count
      emitStatus(site.id);

      await sleep(randomInt(500, 2000));
    }

    run.completedAt = new Date().toISOString();
    try { await appendSchedulerRun(site.id, run); } catch (e) { distLog.error('failed to persist run', e); }
  } finally {
    state.currentRun = null;
    state.isDistributing = false;
    state.cancelRequested = false;
    try { await setDistributionActive(site.id, run.id, false); } catch (e) { distLog.error('failed to clear distribution state', e); }
    emitStatus(site.id, { lastRun: run });
  }

  distLog.info('distribution complete', {
    sessionsCompleted: run.sessionsCompleted,
    sessionsPlanned: run.sessionsPlanned,
    totalEventsSent: run.totalEventsSent,
    errorCount: run.errors.length,
    durationMs: run.completedAt ? Date.now() - new Date(run.startedAt).getTime() : undefined,
  });

  if (run.errors.length > 0) {
    distLog.warn('distribution had session errors', { errors: run.errors });
  }

  return run;
}

// ─────────────────────────────────────────────
// Scheduler lifecycle — per site
// ─────────────────────────────────────────────

export function startScheduler(personas: Persona[], site: SiteConfig): void {
  const state = getState(site.id);
  if (state.task) {
    log.child(site.id).warn('startScheduler called but scheduler is already running');
    return;
  }

  const cronExpr = process.env.SCHEDULER_CRON ?? '0 6 * * *';
  const tz = process.env.SCHEDULER_TIMEZONE ?? 'America/Los_Angeles';

  state.task = cron.schedule(
    cronExpr,
    () => { distributeSessionsForDay(personas, site).catch((err) => log.child(site.id).error('distribution failed', err)); },
    { timezone: tz }
  );

  log.child(site.id).info('started', { cronExpr, timezone: tz, personaCount: personas.length });
  emitStatus(site.id);
}

export function stopScheduler(siteId: string): void {
  const state = getState(siteId);
  if (state.task) {
    state.task.stop();
    state.task = null;
    log.child(siteId).info('stopped');
    emitStatus(siteId);
  }
}

/** Cancel any in-progress distribution run for the given site. */
export async function cancelDistribution(siteId: string): Promise<void> {
  const state = getState(siteId);
  state.cancelRequested = true;
  await setDistributionCancelRequested(siteId);
  log.child(siteId).info('cancel requested (in-memory + persisted)');
  emitStatus(siteId);
}

export function isSchedulerRunning(siteId: string): boolean {
  return getState(siteId).task !== null;
}

export function isDistributing(siteId: string): boolean {
  return getState(siteId).isDistributing;
}

export function getCurrentRun(siteId: string): SchedulerRun | null {
  return getState(siteId).currentRun;
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

export function getNextRunTimeForSite(siteId: string): string | null {
  if (!isSchedulerRunning(siteId)) return null;
  return getNextRunTime();
}
