/**
 * SupervisorAgent — singleton orchestrator for all worker agents.
 *
 * Runs on a configurable interval (default 10 minutes). On each tick it:
 *  1. Checks the current event progress for every agent
 *  2. Calculates urgency by comparing % of target complete vs % of day elapsed
 *  3. Dispatches WorkerAgent.runBatch() for agents that are behind
 *  4. Emits a SupervisorDecision via SSE and persists it to Couchbase
 *
 * Urgency tiers:
 *  - ahead    → skip (ahead of pace)
 *  - normal   → dispatch 1–2 sessions
 *  - high     → dispatch 3–5 sessions
 *  - critical → dispatch up to 10 sessions (at or near end of day)
 */

import cron, { type ScheduledTask } from 'node-cron';
import type { SupervisorDecision, SupervisorUrgency } from '@/types';
import { emitToAgent } from '@/lib/sse';
import { getAllAgents, getPersonas, getEventLimit } from '@/lib/agentConfigs';
import { getTodayCounters, resetCountersIfNewDay } from '@/lib/db';
import { appendSupervisorDecision } from '@/lib/agentDb';
import { workerAgent } from './WorkerAgent';
import { createLogger } from '@/lib/logger';
import { generateId } from '@/lib/utils';

const log = createLogger('Supervisor');

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

function supervisorId(): string {
  return generateId('sup');
}

// ─────────────────────────────────────────────
// Supervisor state (persists across hot reloads)
// ─────────────────────────────────────────────

interface SupervisorState {
  task: ScheduledTask | null;
  isRunning: boolean;
  startedAt?: string;
  lastRunAt?: string;
  recentDecisions: SupervisorDecision[];
  activeAgentIds?: string[];
}

const g = globalThis as typeof globalThis & { _supervisorState?: SupervisorState };
if (!g._supervisorState) {
  g._supervisorState = { task: null, isRunning: false, recentDecisions: [] };
}
const supervisorState = g._supervisorState;

// ─────────────────────────────────────────────
// Pacing algorithm
// ─────────────────────────────────────────────

function calcUrgency(
  percentComplete: number,
  fractionOfDayElapsed: number,
  eventsRemaining: number,
  intervalMs: number
): { urgency: SupervisorUrgency; sessionsToDispatch: number; reasoning: string } {
  if (eventsRemaining <= 0) {
    return {
      urgency: 'ahead',
      sessionsToDispatch: 0,
      reasoning: 'Daily target already reached — no sessions needed',
    };
  }

  const minutesRemainingInDay = Math.max(1, (1 - fractionOfDayElapsed) * 1440);
  const cyclesRemaining = Math.max(1, Math.floor((minutesRemainingInDay * 60_000) / intervalMs));
  const eventsPerSession = 4; // conservative default
  const sessionsNeeded = Math.ceil(eventsRemaining / eventsPerSession);
  const baseSessionsPerCycle = Math.max(1, Math.ceil(sessionsNeeded / cyclesRemaining));

  const gap = fractionOfDayElapsed - percentComplete; // positive = behind

  const pct = Math.round(percentComplete * 100);
  const dayPct = Math.round(fractionOfDayElapsed * 100);

  if (fractionOfDayElapsed >= 0.97) {
    return {
      urgency: 'critical',
      sessionsToDispatch: Math.min(10, sessionsNeeded),
      reasoning: `End of day — ${eventsRemaining} events still needed, maximum dispatch`,
    };
  }

  if (gap < -0.1) {
    return {
      urgency: 'ahead',
      sessionsToDispatch: 0,
      reasoning: `${pct}% complete vs ${dayPct}% of day elapsed — ahead of schedule, skipping`,
    };
  }

  if (gap < 0.1) {
    return {
      urgency: 'normal',
      sessionsToDispatch: Math.min(baseSessionsPerCycle, 3),
      reasoning: `On pace — ${pct}% of target, ${cyclesRemaining} cycles remaining today`,
    };
  }

  if (gap < 0.25) {
    return {
      urgency: 'high',
      sessionsToDispatch: Math.min(baseSessionsPerCycle * 2, 6),
      reasoning: `Behind pace — ${pct}% vs ${dayPct}% day elapsed, need ~${sessionsNeeded} more sessions`,
    };
  }

  return {
    urgency: 'critical',
    sessionsToDispatch: Math.min(baseSessionsPerCycle * 3, 10),
    reasoning: `Critically behind — only ${pct}% complete at ${dayPct}% of day, urgent catch-up`,
  };
}

// ─────────────────────────────────────────────
// Supervisor tick
// ─────────────────────────────────────────────

async function supervisorTick(): Promise<void> {
  supervisorState.lastRunAt = new Date().toISOString();

  const allAgents = await getAllAgents();
  const agents = supervisorState.activeAgentIds
    ? allAgents.filter((a) => supervisorState.activeAgentIds!.includes(a.id))
    : allAgents;
  const eventLimit = getEventLimit();
  const intervalMs = parseInt(
    process.env.AGENT_SUPERVISOR_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS),
    10
  );

  const now = new Date();
  const minutesOfDay = now.getHours() * 60 + now.getMinutes();
  const fractionOfDayElapsed = minutesOfDay / 1440;

  log.info('tick start', {
    agentCount: agents.length,
    dayElapsedPct: Math.round(fractionOfDayElapsed * 100),
    intervalMs,
  });

  for (const agent of agents) {
    const alog = log.child(agent.id);

    const personas = await getPersonas(agent);

    await resetCountersIfNewDay(agent.id);
    const counters = await getTodayCounters(agent.id);
    const eventsSent = Object.values(counters.byIndex).reduce((s, n) => s + n, 0);

    const activeIndices = agent.indices.filter((i) => i.events.length > 0);
    const dailyTarget = eventLimit * Math.max(1, activeIndices.length);
    const eventsRemaining = Math.max(0, dailyTarget - eventsSent);
    const percentComplete = dailyTarget > 0 ? eventsSent / dailyTarget : 0;

    alog.debug('progress snapshot', {
      personas: personas.length,
      eventsSent,
      dailyTarget,
      eventsRemaining,
      percentComplete: Math.round(percentComplete * 100),
      activeIndices: activeIndices.length,
    });

    if (personas.length === 0) {
      alog.warn('no personas configured — skipping');
      const decision: SupervisorDecision = {
        id: supervisorId(),
        timestamp: new Date().toISOString(),
        agentId: agent.id,
        agentName: agent.name,
        urgency: 'normal',
        sessionsDispatched: 0,
        reasoning: '⚠ No personas configured — add personas in the Agents tab to enable autonomous generation.',
        progressSnapshot: {
          sent: eventsSent,
          target: dailyTarget,
          percentComplete: Math.round(percentComplete * 100),
        },
      };
      supervisorState.recentDecisions = [decision, ...supervisorState.recentDecisions].slice(0, 50);
      emitToAgent('_supervisor', 'supervisor', decision);
      appendSupervisorDecision(decision).catch((err: unknown) => alog.error('failed to persist no-persona decision', err));
      continue;
    }

    const { urgency, sessionsToDispatch, reasoning } = calcUrgency(
      percentComplete,
      fractionOfDayElapsed,
      eventsRemaining,
      intervalMs
    );

    alog.info('decision', {
      urgency,
      sessionsToDispatch,
      eventsSent,
      dailyTarget,
      percentComplete: Math.round(percentComplete * 100),
      reasoning,
    });

    const decision: SupervisorDecision = {
      id: supervisorId(),
      timestamp: new Date().toISOString(),
      agentId: agent.id,
      agentName: agent.name,
      urgency,
      sessionsDispatched: sessionsToDispatch,
      reasoning: `${personas.length} persona${personas.length !== 1 ? 's' : ''} · ${reasoning}`,
      progressSnapshot: {
        sent: eventsSent,
        target: dailyTarget,
        percentComplete: Math.round(percentComplete * 100),
      },
    };

    supervisorState.recentDecisions = [
      decision,
      ...supervisorState.recentDecisions,
    ].slice(0, 50);

    emitToAgent('_supervisor', 'supervisor', decision);
    appendSupervisorDecision(decision).catch((err: unknown) => alog.error('failed to persist decision', err));

    if (sessionsToDispatch > 0) {
      alog.info(`dispatching ${sessionsToDispatch} session(s) for ${personas.length} persona(s)`);
      workerAgent
        .runBatch(personas, agent, sessionsToDispatch)
        .catch((err: unknown) => {
          alog.error('batch run failed', err);
        });
    }
  }

  log.info('tick complete');
}

// ─────────────────────────────────────────────
// Public lifecycle API
// ─────────────────────────────────────────────

export function startSupervisor(agentIds?: string[]): void {
  if (supervisorState.isRunning) {
    log.warn('startSupervisor called but supervisor is already running');
    return;
  }

  supervisorState.activeAgentIds = agentIds;

  const intervalMs = parseInt(
    process.env.AGENT_SUPERVISOR_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS),
    10
  );
  const intervalMinutes = Math.max(1, Math.round(intervalMs / 60_000));
  const cronExpr = `*/${intervalMinutes} * * * *`;

  supervisorState.task = cron.schedule(cronExpr, () => {
    supervisorTick().catch((err) => log.error('tick failed', err));
  });

  supervisorState.isRunning = true;
  supervisorState.startedAt = new Date().toISOString();

  log.info('started', {
    intervalMinutes,
    cronExpr,
    startedAt: supervisorState.startedAt,
    activeAgentIds: agentIds ?? 'all',
  });
  emitToAgent('_supervisor', 'supervisor', {
    type: 'started',
    timestamp: supervisorState.startedAt,
  });

  supervisorTick().catch((err) => log.error('initial tick failed', err));
}

/** Force an immediate supervisor assessment (for manual trigger / debugging). */
export function runSupervisorTickNow(): void {
  log.info('manual tick triggered');
  supervisorTick().catch((err) => log.error('manual tick failed', err));
}

export function stopSupervisor(): void {
  if (supervisorState.task) {
    supervisorState.task.stop();
    supervisorState.task = null;
  }
  supervisorState.isRunning = false;
  supervisorState.activeAgentIds = undefined;
  log.info('stopped');
  emitToAgent('_supervisor', 'supervisor', {
    type: 'stopped',
    timestamp: new Date().toISOString(),
  });
}

export function isSupervisorRunning(): boolean {
  return supervisorState.isRunning;
}

export function getSupervisorStatus() {
  return {
    isRunning: supervisorState.isRunning,
    startedAt: supervisorState.startedAt,
    lastRunAt: supervisorState.lastRunAt,
    recentDecisions: supervisorState.recentDecisions.slice(0, 20),
  };
}
