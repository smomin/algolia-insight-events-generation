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
  getNextRunTimeForSite,
} from '@/lib/scheduler';
import { getAllSites, getEventLimit } from '@/lib/sites';
import { getAgentStateForSite } from '@/lib/agents/SiteAgent';
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
  const siteId = searchParams.get('siteId') ?? '';
  const typesParam = searchParams.get('types') ?? 'status';
  const types = typesParam
    .split(',')
    .filter((t) => VALID_TYPES.has(t)) as SSEEventType[];

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let unsubscribeReload: (() => void) | undefined;
  let heartbeatId: ReturnType<typeof setInterval> | undefined;

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
      try {
        if (siteId === '_global') {
          const sites = await getAllSites();
          const all: Record<string, { isRunning: boolean; isDistributing: boolean }> = {};
          await Promise.all(
            sites.map(async (site) => {
              const distState = await getDistributionState(site.id);
              const inMemDist = isDistributing(site.id);
              let actualDist = inMemDist || distState.isDistributing;
              if (!inMemDist && (distState.isDistributing || distState.cancelRequested)) {
                await setDistributionActive(site.id, distState.runId ?? 'stale', false);
                actualDist = false;
              }
              all[site.id] = {
                isRunning: isSchedulerRunning(site.id),
                isDistributing: actualDist,
              };
            })
          );
          send('status', { all });
        } else if (siteId) {
          for (const type of types) {
            if (type === 'status') {
              const [lastRun, distState] = await Promise.all([
                getLastSchedulerRun(siteId),
                getDistributionState(siteId),
              ]);
              const inMemDistributing = isDistributing(siteId);

              let actuallyDistributing = inMemDistributing || distState.isDistributing;
              let cancelRequested = distState.cancelRequested;
              if (!inMemDistributing && (distState.isDistributing || distState.cancelRequested)) {
                await setDistributionActive(siteId, distState.runId ?? 'stale', false);
                actuallyDistributing = false;
                cancelRequested = false;
              }

              const current = getCurrentRun(siteId);
              send('status', {
                isRunning: isSchedulerRunning(siteId),
                isDistributing: actuallyDistributing,
                cancelRequested,
                nextRun: getNextRunTimeForSite(siteId),
                lastRun,
                currentRun: current
                  ? { sessionsCompleted: current.sessionsCompleted, errors: current.errors }
                  : null,
                eventLimit: getEventLimit(),
              });
            } else if (type === 'event-log') {
              const events = await getEventLog(siteId);
              send('event-log', { events, initial: true });
            } else if (type === 'session') {
              const sessions = await getSessions(siteId);
              send('session', { sessions, initial: true });
            } else if (type === 'counters') {
              const counters = await getTodayCounters(siteId);
              send('counters', counters);
            }
          }
        }
      } catch {
        // DB unavailable on connect — client will retry via EventSource reconnect
      }

      // ── Agent initial snapshots ──────────────────────────────────────
      if (siteId && siteId !== '_global' && siteId !== '_supervisor') {
        if (types.includes('agent-status')) {
          const agentState = getAgentStateForSite(siteId);
          send('agent-status', agentState);
        }
        if (types.includes('guardrail')) {
          const violations = await getGuardrailViolations(siteId).catch(() => []);
          send('guardrail', { violations, initial: true });
        }
      }
      if (siteId === '_supervisor') {
        const supStatus = getSupervisorStatus();
        send('supervisor', { ...supStatus, type: 'snapshot' });
      }

      // ── Subscribe to live updates ────────────────────────────────────
      const channel =
        siteId === '_global'
          ? '_global'
          : siteId === '_supervisor'
          ? '_supervisor'
          : siteId;
      const listenTypes: SSEEventType[] =
        siteId === '_global'
          ? ['status']
          : siteId === '_supervisor'
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
