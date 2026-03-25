import { NextRequest } from 'next/server';
import { subscribeToStream, subscribeToDevReload, emitDevReload, type SSEEventType } from '@/lib/sse';
import {
  getTodayCounters,
  getEventLog,
  getSessions,
  getDistributionState,
  getLastSchedulerRun,
  setDistributionActive,
} from '@/lib/db';
import {
  isSchedulerRunning,
  isDistributing,
  getCurrentRun,
  getNextRunTimeForAgent,
} from '@/lib/scheduler';
import { getAllAgents, getEventLimit } from '@/lib/agentConfigs';
import { getAgentState } from '@/lib/agents/WorkerAgent';
import { getSupervisorStatus } from '@/lib/agents/SupervisorAgent';
import { getGuardrailViolations } from '@/lib/agentDb';

export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set<string>([
  'status', 'session', 'event-log', 'counters',
  'agent-status', 'guardrail', 'supervisor',
]);

// ── Dev-mode hot-reload detection ─────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  const dg = globalThis as typeof globalThis & { _streamModuleVersion?: number };
  dg._streamModuleVersion = (dg._streamModuleVersion ?? 0) + 1;
  if (dg._streamModuleVersion > 1) {
    setTimeout(() => emitDevReload(), 150);
  }
}

const HEARTBEAT_MS = process.env.NODE_ENV === 'development' ? 3_000 : 25_000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('siteId') ?? searchParams.get('agentId') ?? '';
  const typesParam = searchParams.get('types') ?? 'status';
  const types = typesParam
    .split(',')
    .filter((t) => VALID_TYPES.has(t)) as SSEEventType[];

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let unsubscribeReload: (() => void) | undefined;
  let heartbeatId: ReturnType<typeof setInterval> | undefined;

  console.log(`[DEBUG:SSE] new connection — agentId="${agentId}" types=[${typesParam}] parsed=[${types.join(',')}]`);
  if (!agentId) {
    console.warn(`[DEBUG:SSE] agentId is empty — no initial snapshot will be sent and no live events will be received. Check that the client passes ?siteId= or ?agentId= in the SSE URL.`);
  }
  if (types.length === 0) {
    console.warn(`[DEBUG:SSE] no valid types parsed from "${typesParam}" — valid types are: ${[...VALID_TYPES].join(', ')}`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        try {
          const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(msg));
        } catch {
          // Connection closed — cancel() will handle cleanup
        }
      };

      // ── Initial snapshot ──────────────────────────────────────────────
      // Each DB call is individually guarded so a slow/unavailable collection
      // cannot block the rest of the snapshot or the SSE connection itself.
      if (agentId === '_global') {
        try {
          const agents = await getAllAgents();
          const all: Record<string, { isRunning: boolean; isDistributing: boolean }> = {};
          await Promise.all(
            agents.map(async (agent) => {
              try {
                const distState = await getDistributionState(agent.id);
                const inMemDist = isDistributing(agent.id);
                let actualDist = inMemDist || distState.isDistributing;
                if (!inMemDist && (distState.isDistributing || distState.cancelRequested)) {
                  await setDistributionActive(agent.id, distState.runId ?? 'stale', false);
                  actualDist = false;
                }
                all[agent.id] = { isRunning: isSchedulerRunning(agent.id), isDistributing: actualDist };
              } catch {
                all[agent.id] = { isRunning: isSchedulerRunning(agent.id), isDistributing: false };
              }
            })
          );
          send('status', { all });
        } catch { /* agents unavailable */ }
      } else if (agentId) {
        for (const type of types) {
          if (type === 'status') {
            try {
              const [lastRun, distState] = await Promise.all([
                getLastSchedulerRun(agentId),
                getDistributionState(agentId),
              ]);
              const inMemDistributing = isDistributing(agentId);
              let actuallyDistributing = inMemDistributing || distState.isDistributing;
              let cancelRequested = distState.cancelRequested;
              if (!inMemDistributing && (distState.isDistributing || distState.cancelRequested)) {
                await setDistributionActive(agentId, distState.runId ?? 'stale', false);
                actuallyDistributing = false;
                cancelRequested = false;
              }
              const current = getCurrentRun(agentId);
              send('status', {
                isRunning: isSchedulerRunning(agentId),
                isDistributing: actuallyDistributing,
                cancelRequested,
                nextRun: getNextRunTimeForAgent(agentId),
                lastRun,
                currentRun: current
                  ? { sessionsCompleted: current.sessionsCompleted, errors: current.errors }
                  : null,
                eventLimit: getEventLimit(),
              });
            } catch { /* status unavailable */ }
          } else if (type === 'event-log') {
            try {
              console.log(`[DEBUG:SSE] fetching initial event-log for agentId="${agentId}"`);
              const events = await getEventLog(agentId);
              console.log(`[DEBUG:SSE] sending initial event-log: ${events.length} events for "${agentId}"`);
              send('event-log', { events, initial: true });
            } catch (err) {
              console.error(`[DEBUG:SSE] event-log initial snapshot failed for "${agentId}":`, err);
              send('event-log', { events: [], initial: true });
            }
          } else if (type === 'session') {
            try {
              console.log(`[DEBUG:SSE] fetching initial sessions for agentId="${agentId}"`);
              const sessions = await getSessions(agentId);
              console.log(`[DEBUG:SSE] sending initial sessions: ${sessions.length} records for "${agentId}"`);
              send('session', { sessions, initial: true });
            } catch (err) {
              console.error(`[DEBUG:SSE] sessions initial snapshot failed for "${agentId}":`, err);
              send('session', { sessions: [], initial: true });
            }
          } else if (type === 'counters') {
            try {
              const counters = await getTodayCounters(agentId);
              send('counters', counters);
            } catch { /* counters unavailable */ }
          }
        }
      }

      // ── Agent initial snapshots ──────────────────────────────────────
      if (agentId && agentId !== '_global' && agentId !== '_supervisor') {
        if (types.includes('agent-status')) {
          const agentState = getAgentState(agentId);
          send('agent-status', agentState);
        }
        if (types.includes('guardrail')) {
          const violations = await getGuardrailViolations(agentId).catch(() => []);
          send('guardrail', { violations, initial: true });
        }
      }
      if (agentId === '_supervisor') {
        const supStatus = getSupervisorStatus();
        send('supervisor', { ...supStatus, type: 'snapshot' });
      }

      // ── Subscribe to live updates ────────────────────────────────────
      const channel =
        agentId === '_global'
          ? '_global'
          : agentId === '_supervisor'
          ? '_supervisor'
          : agentId;
      const listenTypes: SSEEventType[] =
        agentId === '_global'
          ? ['status']
          : agentId === '_supervisor'
          ? ['supervisor']
          : types;

      unsubscribe = subscribeToStream(channel, listenTypes, (type, data) => {
        send(type, data);
      });

      // ── Dev live-reload ─────────────────────────────────────────────
      if (process.env.NODE_ENV === 'development') {
        unsubscribeReload = subscribeToDevReload(({ timestamp }) => {
          send('reload', { timestamp });
        });
      }

      // ── Heartbeat ────────────────────────────────────────────────────
      heartbeatId = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          /* already closed */
        }
      }, HEARTBEAT_MS);
    },

    cancel() {
      clearInterval(heartbeatId);
      unsubscribe?.();
      unsubscribeReload?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
