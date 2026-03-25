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
  getNextRunTimeForIndustry,
} from '@/lib/scheduler';
import { getAllIndustries, getEventLimit } from '@/lib/industries';
import { getAgentStateForIndustry } from '@/lib/agents/IndustryAgent';
import { getSupervisorStatus } from '@/lib/agents/SupervisorAgent';
import { getGuardrailViolations } from '@/lib/agentDb';

export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set<string>([
  'status', 'session', 'event-log', 'counters',
  'agent-status', 'guardrail', 'supervisor',
]);

// ── Dev-mode hot-reload detection ─────────────────────────────────────────
// Each time this module is evaluated (i.e. after a Next.js hot reload), the
// version counter on globalThis increments. When it exceeds 1 the server has
// been hot-reloaded and we broadcast a `reload` event so all SSE clients can
// close and reopen their EventSource — forcing a fresh initial state snapshot.
if (process.env.NODE_ENV === 'development') {
  const dg = globalThis as typeof globalThis & { _streamModuleVersion?: number };
  dg._streamModuleVersion = (dg._streamModuleVersion ?? 0) + 1;
  if (dg._streamModuleVersion > 1) {
    // Small delay so the new module code is fully wired before clients reconnect
    setTimeout(() => emitDevReload(), 150);
  }
}

// Heartbeat interval — more frequent in dev so dropped connections are
// detected quickly and the client reconnects with a fresh state snapshot.
const HEARTBEAT_MS = process.env.NODE_ENV === 'development' ? 3_000 : 25_000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const industryId = searchParams.get('industryId') ?? '';
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
        if (industryId === '_global') {
          // Send the running state for ALL industries so page.tsx can populate
          // the header status dots immediately on connect.
          const industries = await getAllIndustries();
          const all: Record<string, { isRunning: boolean; isDistributing: boolean }> = {};
          await Promise.all(
            industries.map(async (ind) => {
              const distState = await getDistributionState(ind.id);
              const inMemDist = isDistributing(ind.id);
              // Auto-heal stale persisted state (same logic as per-industry snapshot)
              let actualDist = inMemDist || distState.isDistributing;
              if (!inMemDist && (distState.isDistributing || distState.cancelRequested)) {
                await setDistributionActive(ind.id, distState.runId ?? 'stale', false);
                actualDist = false;
              }
              all[ind.id] = {
                isRunning: isSchedulerRunning(ind.id),
                isDistributing: actualDist,
              };
            })
          );
          send('status', { all });
        } else if (industryId) {
          // Send one snapshot per requested event type
          for (const type of types) {
            if (type === 'status') {
              const [lastRun, distState] = await Promise.all([
                getLastSchedulerRun(industryId),
                getDistributionState(industryId),
              ]);
              const inMemDistributing = isDistributing(industryId);

              // Auto-heal stale persisted state: if in-memory says the distribution
              // is NOT running but Couchbase still claims it is (or has a dangling
              // cancelRequested flag), the run ended uncleanly (hot-reload / crash).
              // Clear the stale record so clients never get stuck in "Stopping…".
              let actuallyDistributing = inMemDistributing || distState.isDistributing;
              let cancelRequested = distState.cancelRequested;
              if (!inMemDistributing && (distState.isDistributing || distState.cancelRequested)) {
                await setDistributionActive(industryId, distState.runId ?? 'stale', false);
                actuallyDistributing = false;
                cancelRequested = false;
              }

              const current = getCurrentRun(industryId);
              send('status', {
                isRunning: isSchedulerRunning(industryId),
                isDistributing: actuallyDistributing,
                cancelRequested,
                nextRun: getNextRunTimeForIndustry(industryId),
                lastRun,
                currentRun: current
                  ? { sessionsCompleted: current.sessionsCompleted, errors: current.errors }
                  : null,
                eventLimit: getEventLimit(),
              });
            } else if (type === 'event-log') {
              const events = await getEventLog(industryId);
              // Mark as initial so the client replaces (not prepends) its local list
              send('event-log', { events, initial: true });
            } else if (type === 'session') {
              const sessions = await getSessions(industryId);
              send('session', { sessions, initial: true });
            } else if (type === 'counters') {
              const counters = await getTodayCounters(industryId);
              send('counters', counters);
            }
          }
        }
      } catch {
        // DB unavailable on connect — client will retry via EventSource reconnect
      }

      // ── Agent initial snapshots ──────────────────────────────────────
      if (industryId && industryId !== '_global' && industryId !== '_supervisor') {
        if (types.includes('agent-status')) {
          const agentState = getAgentStateForIndustry(industryId);
          send('agent-status', agentState);
        }
        if (types.includes('guardrail')) {
          const violations = await getGuardrailViolations(industryId).catch(() => []);
          send('guardrail', { violations, initial: true });
        }
      }
      if (industryId === '_supervisor') {
        const supStatus = getSupervisorStatus();
        send('supervisor', { ...supStatus, type: 'snapshot' });
      }

      // ── Subscribe to live updates ────────────────────────────────────
      const channel =
        industryId === '_global'
          ? '_global'
          : industryId === '_supervisor'
          ? '_supervisor'
          : industryId;
      const listenTypes: SSEEventType[] =
        industryId === '_global'
          ? ['status']
          : industryId === '_supervisor'
          ? ['supervisor']
          : types;

      unsubscribe = subscribeToStream(channel, listenTypes, (type, data) => {
        send(type, data);
      });

      // ── Dev live-reload — tell clients to reconnect after hot reloads ─
      if (process.env.NODE_ENV === 'development') {
        unsubscribeReload = subscribeToDevReload(({ timestamp }) => {
          send('reload', { timestamp });
        });
      }

      // ── Heartbeat — keeps the connection alive through proxies ────────
      // In dev mode the interval is much shorter so dropped connections are
      // detected quickly and clients reconnect with a fresh state snapshot.
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
