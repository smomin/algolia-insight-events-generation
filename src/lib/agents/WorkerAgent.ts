/**
 * WorkerAgent — autonomous agent for a single agent configuration.
 *
 * Each agent config becomes a worker with a distinct identity (persona +
 * agent config as its system context). The worker:
 *  1. Plans a search query (LLM) for the current persona
 *  2. Validates the query through GuardrailsAgent (retries up to N times)
 *  3. Searches the primary Algolia index
 *  4. Selects the best result (LLM)
 *  5. Builds and sends all insight events
 *  6. Reports progress back via SSE
 *
 * Agent state (phase, current query, counts) is emitted via SSE on every
 * transition so the UI can show live per-agent cards.
 */

import type { Persona, AgentConfig, AgentState, AgentPhase, FlexIndex } from '@/types';
import { emitToAgent } from '@/lib/sse';
import { searchIndex } from '@/lib/algolia';
import {
  selectBestResult,
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
import { GUARDRAIL_MAX_RETRIES } from './GuardrailsAgent';
import { IndexAgent } from './IndexAgent';
import type { PrimaryIndexContext } from './IndexAgent';
import { createLogger } from '@/lib/logger';
import { shuffle, sleep, randomInt, generateId } from '@/lib/utils';
import { getEventLimit } from '@/lib/agentConfigs';

const log = createLogger('WorkerAgent');

// ─────────────────────────────────────────────
// In-memory per-agent state
// Stored on globalThis so it survives Next.js hot reloads and
// is shared across all module compilations in the same process.
// ─────────────────────────────────────────────

type AgentGlobal = typeof globalThis & {
  _agentStates?: Map<string, AgentState>;
  _workerAgent?: WorkerAgent;
};
const gAgent = globalThis as AgentGlobal;
if (!gAgent._agentStates) gAgent._agentStates = new Map<string, AgentState>();
const agentStates = gAgent._agentStates;

function getOrCreateState(agentId: string): AgentState {
  if (!agentStates.has(agentId)) {
    agentStates.set(agentId, {
      agentId,
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
  return agentStates.get(agentId)!;
}

export function getAgentState(agentId: string): AgentState {
  return getOrCreateState(agentId);
}

export function getAllAgentStates(): Record<string, AgentState> {
  return Object.fromEntries(agentStates.entries());
}

function setPhase(agentId: string, phase: AgentPhase, extra?: Partial<AgentState>): void {
  const state = getOrCreateState(agentId);
  Object.assign(state, { phase, lastActivity: new Date().toISOString(), ...extra });
  emitToAgent(agentId, 'agent-status', { ...state });
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

interface SessionQueryContext {
  primaryQuery?: string;
  secondaryQueries?: string[];
  failurePhase?: string;
}

async function recordSession(
  agentId: string,
  sessionId: string,
  persona: Persona,
  startedAt: string,
  eventsByIndex: Record<string, number>,
  success: boolean,
  error?: string,
  queryContext?: SessionQueryContext
): Promise<void> {
  await appendSession(agentId, {
    id: sessionId,
    agentId,
    personaId: persona.id,
    personaName: persona.name,
    startedAt,
    completedAt: new Date().toISOString(),
    totalEventsCount: Object.values(eventsByIndex).reduce((s, n) => s + n, 0),
    eventsByIndex,
    success,
    error,
    primaryQuery: queryContext?.primaryQuery,
    secondaryQueries: queryContext?.secondaryQueries,
    failurePhase: queryContext?.failurePhase,
  });
}

// ─────────────────────────────────────────────
// WorkerAgent class
// ─────────────────────────────────────────────

export class WorkerAgent {
  /**
   * Run a single agentic session for the given persona + agent config.
   * Includes guardrail validation with retry before each Algolia search.
   */
  async runSession(
    persona: Persona,
    agent: AgentConfig
  ): Promise<{
    eventsByIndex: Record<string, number>;
    totalEvents: number;
    sessionId: string;
    error?: string;
  }> {
    const sessionId = generateSessionId();
    const startedAt = new Date().toISOString();
    const sessionLog = log.child(`${agent.id}:${persona.name}`);

    sessionLog.info('session start', { sessionId, personaId: persona.id });

    const primaryIndex = agent.indices.find((i) => i.role === 'primary');
    const secondaryIndices = agent.indices.filter((i) => i.role === 'secondary');

    if (!primaryIndex) {
      const err = 'No primary index configured for this agent';
      sessionLog.error(err);
      setPhase(agent.id, 'error', {
        errors: [...getOrCreateState(agent.id).errors.slice(-9), err],
      });
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
    }

    // ── Create IndexAgent instances — one per configured index ────────
    const primaryIndexAgent = new IndexAgent(primaryIndex, agent);
    const secondaryIndexAgents = secondaryIndices.map((idx) => new IndexAgent(idx, agent));

    sessionLog.debug('index agents created', {
      primaryIndex: primaryIndex.indexName,
      secondaryIndices: secondaryIndices.map((s) => s.indexName),
    });

    try {
      // ── Phase 1: Planning — primary IndexAgent generates query ──────
      setPhase(agent.id, 'planning', {
        currentPersonaId: persona.id,
        currentPersonaName: persona.name,
        currentQuery: undefined,
      });
      sessionLog.debug('phase: planning');

      // Agent-level memory feeds into the primary IndexAgent so queries
      // are unique across all indices, not just the primary one.
      const agentRecentQueries = await getPersonaQueryMemory(agent.id, persona.id).catch(() => []);
      sessionLog.debug('persona query memory loaded', { recentQueryCount: agentRecentQueries.length });

      let primaryQuery = await primaryIndexAgent.generatePrimaryQuery(
        persona,
        agentRecentQueries
      );
      sessionLog.info('primary index agent: query generated', {
        index: primaryIndex.label,
        query: primaryQuery,
      });

      // ── Phase 2: Validating — primary IndexAgent runs guardrails ────
      setPhase(agent.id, 'validating', { currentQuery: primaryQuery });
      sessionLog.debug('phase: validating (primary index agent)');

      let attempts = 1;
      let validation = await primaryIndexAgent.validate(primaryQuery, persona, attempts);

      while (!validation.approved && attempts < GUARDRAIL_MAX_RETRIES) {
        attempts++;
        const retryQuery = validation.suggestedQuery ?? primaryQuery;
        sessionLog.info(`primary index agent: guardrail retry ${attempts}`, {
          index: primaryIndex.label,
          retryQuery,
          rejectedQuery: primaryQuery,
          reason: validation.reason,
        });

        const state = getOrCreateState(agent.id);
        setPhase(agent.id, 'validating', {
          currentQuery: retryQuery,
          guardrailViolations: state.guardrailViolations + 1,
        });

        primaryQuery = retryQuery;
        validation = await primaryIndexAgent.validate(primaryQuery, persona, attempts);
      }

      if (!validation.approved) {
        const state = getOrCreateState(agent.id);
        primaryQuery = validation.suggestedQuery ?? primaryQuery;
        setPhase(agent.id, 'validating', {
          guardrailViolations: state.guardrailViolations + 1,
          currentQuery: primaryQuery,
        });
        sessionLog.warn('primary index agent: guardrail retries exhausted — proceeding anyway', {
          index: primaryIndex.label,
          finalQuery: primaryQuery,
          totalAttempts: attempts,
        });
      }

      // Persist to both agent-level memory (cross-index deduplication) and
      // per-index memory (index-specific history)
      appendPersonaQuery(agent.id, persona.id, primaryQuery).catch((err) =>
        sessionLog.warn('failed to save query to agent memory', {
          error: err instanceof Error ? err.message : String(err),
        })
      );
      primaryIndexAgent.rememberQuery(persona.id, primaryQuery);

      // ── Phase 3: Searching — Algolia primary index ─────────────────
      setPhase(agent.id, 'searching', { currentQuery: primaryQuery });
      sessionLog.debug('phase: searching (primary)', {
        query: primaryQuery,
        index: primaryIndex.indexName,
      });

      const { hits: primaryHits, queryID: primaryQueryID } = await searchIndex(
        primaryIndex.indexName,
        primaryQuery,
        persona.userToken,
        10,
        agent.id
      );

      if (!primaryHits.length || !primaryQueryID) {
        const err = `No results for "${primaryQuery}" in "${primaryIndex.indexName}"`;
        sessionLog.warn(err);
        await recordSession(agent.id, sessionId, persona, startedAt, {}, false, err, {
          primaryQuery,
          failurePhase: 'search',
        });
        setPhase(agent.id, 'error', {
          errors: [...getOrCreateState(agent.id).errors.slice(-9), err],
        });
        return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
      }

      sessionLog.debug('primary search results', {
        hitCount: primaryHits.length,
        queryID: primaryQueryID,
      });

      // Site agent selects the best result — this remains a site-level decision
      const { index: selectedIdx, reason } = await selectBestResult(
        persona,
        primaryHits,
        agent.claudePrompts.selectBestResult,
        agent.id
      );
      const selectedHit = primaryHits[selectedIdx] ?? primaryHits[0];
      const position = (selectedIdx ?? 0) + 1;
      sessionLog.debug('hit selected by site agent', {
        selectedIndex: selectedIdx,
        objectID: selectedHit.objectID,
        position,
        reason,
      });

      const primaryEvts = buildFlexIndexEvents(
        persona,
        primaryIndex,
        selectedHit,
        position,
        primaryQueryID,
        []
      );

      // Build primary context — passed to every secondary IndexAgent so they
      // can reason about what the user found and extend the session coherently
      const primaryContext: PrimaryIndexContext = {
        query: primaryQuery,
        hit: selectedHit,
        indexLabel: primaryIndex.label,
        indexName: primaryIndex.indexName,
        selectionReason: reason,
      };

      // ── Secondary indices — each IndexAgent generates its own queries ─
      const secondaryEvtsByIndex: Record<
        string,
        { index: FlexIndex; events: ReturnType<typeof buildFlexIndexEvents> }
      > = {};

      // Collect the leading query used per secondary index for session logging
      const collectedSecondaryQueries: string[] = [];

      for (const secIndexAgent of secondaryIndexAgents) {
        const secIdx = secondaryIndices.find((s) => s.id === secIndexAgent.indexId)!;

        sessionLog.debug(`secondary index agent: generating queries`, {
          index: secIndexAgent.indexLabel,
          indexName: secIndexAgent.indexName,
        });

        let secQueries = await secIndexAgent.generateSecondaryQueries(
          persona,
          primaryContext,
          agentRecentQueries
        );

        sessionLog.info('secondary index agent: queries generated', {
          index: secIndexAgent.indexLabel,
          queries: secQueries,
        });

        // Guardrail validation for the leading secondary query (single attempt)
        if (secQueries.length > 0) {
          const secValidation = await secIndexAgent.validate(secQueries[0], persona, 1);
          if (!secValidation.approved) {
            sessionLog.warn('secondary index agent: guardrail rejected leading query', {
              index: secIndexAgent.indexLabel,
              originalQuery: secQueries[0],
              suggestedQuery: secValidation.suggestedQuery,
              reason: secValidation.reason,
            });
            if (secValidation.suggestedQuery) {
              secQueries = [secValidation.suggestedQuery, ...secQueries.slice(1)];
            }
          }
          collectedSecondaryQueries.push(secQueries[0]);
        }

        // Search the secondary index with all generated queries
        const secResults = await Promise.all(
          secQueries.map((q) =>
            searchIndex(secIdx.indexName, q, persona.userToken, 20, agent.id).catch(() => null)
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
            agent.id
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

          // Persist the top secondary query to per-index memory
          secIndexAgent.rememberQuery(persona.id, secQueries[0]);
        } else {
          sessionLog.debug('secondary index agent: no results found', {
            index: secIndexAgent.indexLabel,
          });
        }
      }

      const allEvents = [
        ...primaryEvts,
        ...Object.values(secondaryEvtsByIndex).flatMap((x) => x.events),
      ];

      if (allEvents.length === 0) {
        const err = 'No events built — verify index event configuration';
        await recordSession(agent.id, sessionId, persona, startedAt, {}, false, err, {
          primaryQuery,
          secondaryQueries: collectedSecondaryQueries,
          failurePhase: 'build',
        });
        setPhase(agent.id, 'error', {
          errors: [...getOrCreateState(agent.id).errors.slice(-9), err],
        });
        return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
      }

      // ── Phase 4: Sending — Algolia Insights API ────────────────────
      setPhase(agent.id, 'sending');
      sessionLog.debug('phase: sending', { totalEvents: allEvents.length });

      const httpStatus = await sendEvents(allEvents, agent.id);

      if (httpStatus === 200) {
        const eventsByIndex: Record<string, number> = {
          [primaryIndex.id]: primaryEvts.length,
        };
        await incrementIndexCounter(agent.id, primaryIndex.id, primaryEvts.length);

        for (const [indexId, { events: evts }] of Object.entries(secondaryEvtsByIndex)) {
          eventsByIndex[indexId] = evts.length;
          await incrementIndexCounter(agent.id, indexId, evts.length);
        }

        const sentMeta = {
          agentId: agent.id,
          personaId: persona.id,
          personaName: persona.name,
          sessionId,
        };
        await appendEventLog(agent.id, toSentEvents(allEvents, httpStatus, sentMeta));
        await recordSession(agent.id, sessionId, persona, startedAt, eventsByIndex, true, undefined, {
          primaryQuery,
          secondaryQueries: collectedSecondaryQueries,
        });

        const counters = await getTodayCounters(agent.id);
        const totalToday = Object.values(counters.byIndex).reduce((s, n) => s + n, 0);
        const state = getOrCreateState(agent.id);

        setPhase(agent.id, 'complete', {
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
        await recordSession(agent.id, sessionId, persona, startedAt, {}, false, err, {
          primaryQuery,
          secondaryQueries: collectedSecondaryQueries,
          failurePhase: 'send',
        });
        setPhase(agent.id, 'error', {
          errors: [...getOrCreateState(agent.id).errors.slice(-9), err],
        });
        return { eventsByIndex: {}, totalEvents: 0, sessionId, error: err };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sessionLog.error('uncaught session error', err instanceof Error ? err : { message: msg });
      try {
        await recordSession(agent.id, sessionId, persona, startedAt, {}, false, msg);
      } catch { /* swallow */ }
      setPhase(agent.id, 'error', {
        errors: [...getOrCreateState(agent.id).errors.slice(-9), msg],
      });
      return { eventsByIndex: {}, totalEvents: 0, sessionId, error: msg };
    }
  }

  /**
   * Run a batch of sessions for the day's distribution.
   * Called by the SupervisorAgent when it decides this agent needs work.
   */
  async runBatch(
    personas: Persona[],
    agent: AgentConfig,
    sessionCount: number
  ): Promise<{ sessionsCompleted: number; totalEvents: number; errors: string[] }> {
    const batchLog = log.child(agent.id);

    await resetCountersIfNewDay(agent.id);
    const counters = await getTodayCounters(agent.id);
    const totalToday = Object.values(counters.byIndex).reduce((s, n) => s + n, 0);
    const eventLimit = getEventLimit();
    const indexCount = Math.max(1, agent.indices.filter((i) => i.events.length > 0).length);

    batchLog.info('batch start', {
      sessionCount,
      personas: personas.length,
      eventsSentToday: totalToday,
      dailyTarget: eventLimit * indexCount,
    });

    setPhase(agent.id, 'planning', {
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
      for (const idx of agent.indices) {
        if (idx.events.length === 0) continue;
        const remaining = await getRemainingBudget(agent.id, idx.id);
        if (remaining < idx.events.length) {
          batchLog.info('budget exhausted', { afterSessions: results.sessionsCompleted, index: idx.indexName, remaining });
          budgetOk = false;
          break;
        }
      }
      if (!budgetOk) break;

      const result = await this.runSession(persona, agent);

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

    setPhase(agent.id, 'idle', { isActive: false, errors: [] });
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
if (!gAgent._workerAgent) gAgent._workerAgent = new WorkerAgent();
export const workerAgent = gAgent._workerAgent;
