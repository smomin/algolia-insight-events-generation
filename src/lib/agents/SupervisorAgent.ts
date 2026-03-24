/**
 * SupervisorAgent — singleton orchestrator for all industry agents.
 *
 * Runs on a configurable interval (default 10 minutes). On each tick it:
 *  1. Checks the current event progress for every industry
 *  2. Calculates urgency by comparing % of target complete vs % of day elapsed
 *  3. Dispatches IndustryAgent.runBatch() for industries that are behind
 *  4. Emits a SupervisorDecision via SSE and persists it to Couchbase
 *
 * Urgency tiers:
 *  - ahead    → skip (ahead of pace)
 *  - normal   → dispatch 1–2 sessions
 *  - high     → dispatch 3–5 sessions
 *  - critical → dispatch up to 10 sessions (at or near end of day)
 */

import cron from 'node-cron';
import type { SupervisorDecision, SupervisorUrgency } from '@/types';
import { emitToIndustry } from '@/lib/sse';
import { getAllIndustries, getPersonas, getEventLimit } from '@/lib/industries';
import { getTodayCounters, resetCountersIfNewDay } from '@/lib/db';
import { appendSupervisorDecision } from '@/lib/agentDb';
import { industryAgent } from './IndustryAgent';

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

function generateId(): string {
  return `sup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─────────────────────────────────────────────
// Supervisor state (persists across hot reloads)
// ─────────────────────────────────────────────

interface SupervisorState {
  task: cron.ScheduledTask | null;
  isRunning: boolean;
  startedAt?: string;
  lastRunAt?: string;
  recentDecisions: SupervisorDecision[];
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
  console.log('[Supervisor] Tick — assessing industry progress...');

  // Reload personas fresh on every tick so new personas are picked up automatically
  const industries = await getAllIndustries();
  const eventLimit = getEventLimit();
  const intervalMs = parseInt(
    process.env.AGENT_SUPERVISOR_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS),
    10
  );

  const now = new Date();
  const minutesOfDay = now.getHours() * 60 + now.getMinutes();
  const fractionOfDayElapsed = minutesOfDay / 1440;

  for (const industry of industries) {
    // Load personas fresh each tick — picks up new personas without restart
    const personas = await getPersonas(industry);

    await resetCountersIfNewDay(industry.id);
    const counters = await getTodayCounters(industry.id);
    const eventsSent = Object.values(counters.byIndex).reduce((s, n) => s + n, 0);

    const activeIndices = industry.indices.filter((i) => i.events.length > 0);
    const dailyTarget = eventLimit * Math.max(1, activeIndices.length);
    const eventsRemaining = Math.max(0, dailyTarget - eventsSent);
    const percentComplete = dailyTarget > 0 ? eventsSent / dailyTarget : 0;

    // If no personas configured, emit a visible "blocked" decision
    if (personas.length === 0) {
      const decision: SupervisorDecision = {
        id: generateId(),
        timestamp: new Date().toISOString(),
        industryId: industry.id,
        industryName: industry.name,
        urgency: 'normal',
        sessionsDispatched: 0,
        reasoning: '⚠ No personas configured — add personas in the Industries tab to enable autonomous generation.',
        progressSnapshot: {
          sent: eventsSent,
          target: dailyTarget,
          percentComplete: Math.round(percentComplete * 100),
        },
      };
      supervisorState.recentDecisions = [decision, ...supervisorState.recentDecisions].slice(0, 50);
      emitToIndustry('_supervisor', 'supervisor', decision);
      appendSupervisorDecision(decision).catch(console.error);
      console.log(`[Supervisor:${industry.id}] No personas configured — skipping`);
      continue;
    }

    const { urgency, sessionsToDispatch, reasoning } = calcUrgency(
      percentComplete,
      fractionOfDayElapsed,
      eventsRemaining,
      intervalMs
    );

    const decision: SupervisorDecision = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      industryId: industry.id,
      industryName: industry.name,
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

    emitToIndustry('_supervisor', 'supervisor', decision);
    appendSupervisorDecision(decision).catch(console.error);

    console.log(
      `[Supervisor:${industry.id}] ${urgency.toUpperCase()} — ` +
      `${eventsSent}/${dailyTarget} events (${Math.round(percentComplete * 100)}%) ` +
      `→ dispatching ${sessionsToDispatch} sessions (${personas.length} personas)`
    );

    if (sessionsToDispatch > 0) {
      // Fire and forget — agent runs are async; supervisor moves on to next industry
      industryAgent
        .runBatch(personas, industry, sessionsToDispatch)
        .catch((err: unknown) => {
          console.error(`[Supervisor] Batch error for ${industry.id}:`, err);
        });
    }
  }
}

// ─────────────────────────────────────────────
// Public lifecycle API
// ─────────────────────────────────────────────

export function startSupervisor(): void {
  if (supervisorState.isRunning) return;

  const intervalMs = parseInt(
    process.env.AGENT_SUPERVISOR_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS),
    10
  );
  const intervalMinutes = Math.max(1, Math.round(intervalMs / 60_000));
  const cronExpr = `*/${intervalMinutes} * * * *`;

  supervisorState.task = cron.schedule(cronExpr, () => {
    supervisorTick().catch(console.error);
  });

  supervisorState.isRunning = true;
  supervisorState.startedAt = new Date().toISOString();

  console.log(`[Supervisor] Started — interval: ${intervalMinutes}min (cron: "${cronExpr}")`);
  emitToIndustry('_supervisor', 'supervisor', {
    type: 'started',
    timestamp: supervisorState.startedAt,
  });

  // Run first assessment immediately without waiting for the first cron tick
  supervisorTick().catch(console.error);
}

/** Force an immediate supervisor assessment (for manual trigger / debugging). */
export function runSupervisorTickNow(): void {
  supervisorTick().catch(console.error);
}

export function stopSupervisor(): void {
  if (supervisorState.task) {
    supervisorState.task.stop();
    supervisorState.task = null;
  }
  supervisorState.isRunning = false;
  console.log('[Supervisor] Stopped.');
  emitToIndustry('_supervisor', 'supervisor', {
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
