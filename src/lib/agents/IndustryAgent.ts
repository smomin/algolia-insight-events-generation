/**
 * IndustryAgent — autonomous agent for a single industry.
 *
 * Each industry becomes an agent with a distinct identity (persona + industry
 * config as its system context). The agent:
 *  1. Plans a search query (LLM) for the current persona
 *  2. Validates the query through GuardrailsAgent (retries up to N times)
 *  3. Searches the primary Algolia index
 *  4. Selects the best result (LLM)
 *  5. Builds and sends all insight events
 *  6. Reports progress back via SSE
 *
 * Agent state (phase, current query, counts) is emitted via SSE on every
 * transition so the UI can show live per-industry agent cards.
 */

import type { Persona, IndustryV2, AgentState, AgentPhase, FlexIndex } from '@/types';
import { emitToIndustry } from '@/lib/sse';
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
import {
  resetCountersIfNewDay,
  getRemainingBudget,
  incrementIndexCounter,
  appendEventLog,
  appendSession,
  getTodayCounters,
  getPersonaQueryMemory,
  appendPersonaQuery,
} from '@/lib/db';
import { guardrailsAgent, GUARDRAIL_MAX_RETRIES } from './GuardrailsAgent';
import { createLogger } from '@/lib/logger';
import { shuffle, sleep, randomInt, generateId } from '@/lib/utils';
import { getEventLimit } from '@/lib/industries';

const log = createLogger('IndustryAgent');

// ─────────────────────────────────────────────
// In-memory per-industry agent state
// Stored on globalThis so it survives Next.js hot reloads and
// is shared across all module compilations in the same process.
// ─────────────────────────────────────────────

type AgentGlobal = typeof globalThis & {
  _agentStates?: Map<string, AgentState>;
  _industryAgent?: IndustryAgent;
};
const gAgent = globalThis as AgentGlobal;
if (!gAgent._agentStates) gAgent._agentStates = new Map<string, AgentState>();
const agentStates = gAgent._agentStates;

function getOrCreateState(industryId: string): AgentState {
  if (!agentStates.has(industryId)) {
    agentStates.set(industryId, {
      industryId,
      phase: 'idle',
      sessionsCompleted: 0,
      sessionsTarget: 0,
      eventsSentToday: 0,
      dailyTarget: 0,
      guardrailViolations: 0,
      lastActivity: new Date().toISOString(),
      errors: [],
      isActive: false,
    });
  }
  return agentStates.get(industryId)!;
}

export function getAgentStateForIndustry(industryId: string): AgentState {
  return getOrCreateState(industryId);
}

export function getAllAgentStates(): Record<string, AgentState> {
  return Object.fromEntries(agentStates.entries());
}

function setPhase(industryId: string, phase: AgentPhase, extra?: Partial<AgentState>): void {
  const state = getOrCreateState(industryId);
  Object.assign(state, { phase, lastActivity: new Date().toISOString(), ...extra });
  emitToIndustry(industryId, 'agent-status', { ...state });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function generateSessionId(): string {
  return generateId('agent_sess');
}

// ─────────────────────────────────────────────
// Session recording
// ─────────────────────────────────────────────

async function recordSession(
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
// IndustryAgent class
// ─────────────────────────────────────────────

export class IndustryAgent {
  /**
   * Run a single agentic session for the given persona + industry.
   * Includes guardrail validation with retry before each Algolia search.
   */
  async runSession(
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
    const sessionLog = log.child(`${industry.id}:${persona.name}`);

    sessionLog.info('session start', { sessionId, personaId: persona.id });

    const primaryIndex = industry.indices.find((i) => i.role === 'primary');
    const secondaryIndices = industry.indices.filter((i) => i.role === 'secondary');

    if (!primaryIndex) {
      const err = 'No primary index configured for this industry';
      sessionLog.error(err);
      setPhase(industry.id, 'error', {
        errors: [...getOrCreateState(industry.id).errors.slice(-9), err],
      });
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
    }

    sessionLog.debug('index config', {
      primaryIndex: primaryIndex.indexName,
      secondaryIndices: secondaryIndices.map((s) => s.indexName),
    });

    try {
      // ── Phase 1: Planning — generate search query ──────────────────
      setPhase(industry.id, 'planning', {
        currentPersonaId: persona.id,
        currentPersonaName: persona.name,
        currentQuery: undefined,
      });
      sessionLog.debug('phase: planning');

      const recentQueries = await getPersonaQueryMemory(industry.id, persona.id).catch(() => []);
      sessionLog.debug('persona query memory loaded', { recentQueryCount: recentQueries.length });

      let primaryQuery = await generatePrimaryQuery(
        persona,
        industry.claudePrompts.generatePrimaryQuery,
        industry.id,
        recentQueries
      );
      sessionLog.info('primary query generated', { query: primaryQuery });

      // ── Phase 2: Validating — guardrails check ─────────────────────
      setPhase(industry.id, 'validating', { currentQuery: primaryQuery });
      sessionLog.debug('phase: validating');

      let attempts = 1;
      let validation = await guardrailsAgent.validate(primaryQuery, persona, industry, attempts);

      while (!validation.approved && attempts < GUARDRAIL_MAX_RETRIES) {
        attempts++;
        const retryQuery = validation.suggestedQuery ?? primaryQuery;
        sessionLog.info(`guardrail retry ${attempts}`, { retryQuery, rejectedQuery: primaryQuery, reason: validation.reason });

        const state = getOrCreateState(industry.id);
        setPhase(industry.id, 'validating', {
          currentQuery: retryQuery,
          guardrailViolations: state.guardrailViolations + 1,
        });

        primaryQuery = retryQuery;
        validation = await guardrailsAgent.validate(primaryQuery, persona, industry, attempts);
      }

      if (!validation.approved) {
        const state = getOrCreateState(industry.id);
        primaryQuery = validation.suggestedQuery ?? primaryQuery;
        setPhase(industry.id, 'validating', {
          guardrailViolations: state.guardrailViolations + 1,
          currentQuery: primaryQuery,
        });
        sessionLog.warn('guardrail retries exhausted — proceeding anyway', {
          finalQuery: primaryQuery,
          totalAttempts: attempts,
        });
      }

      appendPersonaQuery(industry.id, persona.id, primaryQuery).catch((err) =>
        sessionLog.warn('failed to save query to persona memory', { error: err instanceof Error ? err.message : String(err) })
      );

      // ── Phase 3: Searching — Algolia primary index ─────────────────
      setPhase(industry.id, 'searching', { currentQuery: primaryQuery });
      sessionLog.debug('phase: searching', { query: primaryQuery, index: primaryIndex.indexName });

      const { hits: primaryHits, queryID: primaryQueryID } = await searchIndex(
        primaryIndex.indexName,
        primaryQuery,
        persona.userToken,
        10,
        industry.id
      );

      if (!primaryHits.length || !primaryQueryID) {
        const err = `No results for "${primaryQuery}" in "${primaryIndex.indexName}"`;
        sessionLog.warn(err);
        await recordSession(industry.id, sessionId, persona, startedAt, {}, false, err);
        setPhase(industry.id, 'error', {
          errors: [...getOrCreateState(industry.id).errors.slice(-9), err],
        });
        return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
      }

      sessionLog.debug('primary search results', { hitCount: primaryHits.length, queryID: primaryQueryID });

      const { index: selectedIdx, reason } = await selectBestResult(
        persona,
        primaryHits,
        industry.claudePrompts.selectBestResult,
        industry.id
      );
      const selectedHit = primaryHits[selectedIdx] ?? primaryHits[0];
      const position = (selectedIdx ?? 0) + 1;
      sessionLog.debug('hit selected', { selectedIndex: selectedIdx, objectID: selectedHit.objectID, position, reason });

      const primaryEvts = buildFlexIndexEvents(
        persona,
        primaryIndex,
        selectedHit,
        position,
        primaryQueryID,
        []
      );

      // ── Secondary indices ──────────────────────────────────────────
      const secondaryEvtsByIndex: Record<
        string,
        { index: FlexIndex; events: ReturnType<typeof buildFlexIndexEvents> }
      > = {};

      if (secondaryIndices.length > 0) {
        const secQueries = await generateSecondaryQueries(
          selectedHit,
          persona,
          industry.claudePrompts.generateSecondaryQueries,
          industry.id,
          secondaryIndices.map((si) => ({ id: si.id, label: si.label }))
        );

        for (const secIdx of secondaryIndices) {
          const secResults = await Promise.all(
            secQueries.map((q) =>
              searchIndex(secIdx.indexName, q, persona.userToken, 20, industry.id).catch(() => null)
            )
          );

          let cartProducts = secResults
            .map((result, i) => {
              if (!result?.hits.length || !result.queryID) return null;
              return buildCartProduct(result.hits[0], result.queryID, i + 1);
            })
            .filter((p): p is NonNullable<typeof p> => p !== null);

          if (cartProducts.length === 0) {
            const fallback = await searchIndex(
              secIdx.indexName,
              (selectedHit.name as string) ?? (selectedHit.title as string) ?? selectedHit.objectID,
              persona.userToken,
              20,
              industry.id
            ).catch(() => null);
            if (fallback?.hits.length && fallback.queryID) {
              cartProducts = [buildCartProduct(fallback.hits[0], fallback.queryID, 1)];
            }
          }

          if (cartProducts.length > 0) {
            const evts = buildFlexIndexEvents(
              persona,
              secIdx,
              cartProducts[0],
              1,
              cartProducts[0].queryID,
              cartProducts
            );
            secondaryEvtsByIndex[secIdx.id] = { index: secIdx, events: evts };
          }
        }
      }

      const allEvents = [
        ...primaryEvts,
        ...Object.values(secondaryEvtsByIndex).flatMap((x) => x.events),
      ];

      if (allEvents.length === 0) {
        const err = 'No events built — verify index event configuration';
        await recordSession(industry.id, sessionId, persona, startedAt, {}, false, err);
        setPhase(industry.id, 'error', {
          errors: [...getOrCreateState(industry.id).errors.slice(-9), err],
        });
        return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
      }

      // ── Phase 4: Sending — Algolia Insights API ────────────────────
      setPhase(industry.id, 'sending');
      sessionLog.debug('phase: sending', { totalEvents: allEvents.length });

      const httpStatus = await sendEvents(allEvents, industry.id);

      if (httpStatus === 200) {
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
        await appendEventLog(industry.id, toSentEvents(allEvents, httpStatus, sentMeta));
        await recordSession(industry.id, sessionId, persona, startedAt, eventsByIndex, true);

        const counters = await getTodayCounters(industry.id);
        const totalToday = Object.values(counters.byIndex).reduce((s, n) => s + n, 0);
        const state = getOrCreateState(industry.id);

        setPhase(industry.id, 'complete', {
          sessionsCompleted: state.sessionsCompleted + 1,
          eventsSentToday: totalToday,
        });

        sessionLog.info('session complete', {
          sessionId,
          totalEvents: allEvents.length,
          eventsByIndex,
          eventsSentToday: totalToday,
          durationMs: Date.now() - new Date(startedAt).getTime(),
        });
        return { eventsByIndex, totalEvents: allEvents.length, sessionId };
      } else {
        const err = `Insights API returned HTTP ${httpStatus}`;
        sessionLog.error(err, { sessionId, httpStatus });
        await recordSession(industry.id, sessionId, persona, startedAt, {}, false, err);
        setPhase(industry.id, 'error', {
          errors: [...getOrCreateState(industry.id).errors.slice(-9), err],
        });
        return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sessionLog.error('uncaught session error', err instanceof Error ? err : { message: msg });
      try {
        await recordSession(industry.id, sessionId, persona, startedAt, {}, false, msg);
      } catch { /* swallow */ }
      setPhase(industry.id, 'error', {
        errors: [...getOrCreateState(industry.id).errors.slice(-9), msg],
      });
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: msg };
    }
  }

  /**
   * Run a batch of sessions for the day's distribution.
   * Called by the SupervisorAgent when it decides this industry needs work.
   */
  async runBatch(
    personas: Persona[],
    industry: IndustryV2,
    sessionCount: number
  ): Promise<{ sessionsCompleted: number; totalEvents: number; errors: string[] }> {
    const batchLog = log.child(industry.id);

    await resetCountersIfNewDay(industry.id);
    const counters = await getTodayCounters(industry.id);
    const totalToday = Object.values(counters.byIndex).reduce((s, n) => s + n, 0);
    const eventLimit = getEventLimit();
    const indexCount = Math.max(1, industry.indices.filter((i) => i.events.length > 0).length);

    batchLog.info('batch start', {
      sessionCount,
      personas: personas.length,
      eventsSentToday: totalToday,
      dailyTarget: eventLimit * indexCount,
    });

    setPhase(industry.id, 'planning', {
      isActive: true,
      sessionsTarget: sessionCount,
      sessionsCompleted: 0,
      eventsSentToday: totalToday,
      dailyTarget: eventLimit * indexCount,
      guardrailViolations: 0,
      errors: [],
    });

    const results = { sessionsCompleted: 0, totalEvents: 0, errors: [] as string[] };
    const shuffled = shuffle(personas);

    for (let i = 0; i < sessionCount; i++) {
      const persona = shuffled[i % shuffled.length];

      let budgetOk = true;
      for (const idx of industry.indices) {
        if (idx.events.length === 0) continue;
        const remaining = await getRemainingBudget(industry.id, idx.id);
        if (remaining < idx.events.length) {
          batchLog.info('budget exhausted', { afterSessions: results.sessionsCompleted, index: idx.indexName, remaining });
          budgetOk = false;
          break;
        }
      }
      if (!budgetOk) break;

      const result = await this.runSession(persona, industry);

      if (result.error) {
        batchLog.warn('session error', { persona: persona.name, error: result.error, sessionId: result.sessionId });
        results.errors.push(`${persona.name}: ${result.error}`);
      } else {
        results.sessionsCompleted++;
        results.totalEvents += result.totalEvents;
        batchLog.debug(`session ${results.sessionsCompleted}/${sessionCount} done`, {
          persona: persona.name,
          events: result.totalEvents,
          sessionId: result.sessionId,
        });
      }

      await sleep(randomInt(400, 1200));
    }

    setPhase(industry.id, 'idle', { isActive: false });
    batchLog.info('batch complete', {
      sessionsCompleted: results.sessionsCompleted,
      sessionsRequested: sessionCount,
      totalEvents: results.totalEvents,
      errors: results.errors.length,
    });

    if (results.errors.length > 0) {
      batchLog.warn('batch had errors', { errors: results.errors });
    }

    return results;
  }
}

// Singleton — shared, stateless per call; state is in the agentStates Map above
if (!gAgent._industryAgent) gAgent._industryAgent = new IndustryAgent();
export const industryAgent = gAgent._industryAgent;
