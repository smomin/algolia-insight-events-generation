import { NextRequest, NextResponse } from 'next/server';
import {
  isSchedulerRunning,
  isDistributing,
  getCurrentRun,
  getNextRunTimeForAgent,
} from '@/lib/scheduler';
import { getTodayCounters, getLastSchedulerRun, getDistributionState, setDistributionActive } from '@/lib/db';
import { getAllAgents, getEventLimit } from '@/lib/agentConfigs';

// If the persisted state claims a run is active but in-memory says otherwise
// and the run started more than this many ms ago, treat it as stale and auto-clear.
const STALE_DISTRIBUTION_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agentId') ?? searchParams.get('siteId');

    const limit = getEventLimit();
    const agents = await getAllAgents();

    const allStatus: Record<string, unknown> = {};
    await Promise.all(
      agents.map(async (agent) => {
        const [counters, lastRun, distState] = await Promise.all([
          getTodayCounters(agent.id),
          getLastSchedulerRun(agent.id),
          getDistributionState(agent.id),
        ]);
        // Auto-clear stale persisted distribution state.
        let effectiveDistState = distState;
        if (
          distState.isDistributing &&
          !isDistributing(agent.id) &&
          distState.startedAt &&
          Date.now() - new Date(distState.startedAt).getTime() > STALE_DISTRIBUTION_MS
        ) {
          await setDistributionActive(agent.id, distState.runId ?? '', false);
          effectiveDistState = { isDistributing: false, cancelRequested: false };
        }

        const distributing = isDistributing(agent.id) || effectiveDistState.isDistributing;
        allStatus[agent.id] = {
          agentId: agent.id,
          name: agent.name,
          icon: agent.icon,
          color: agent.color,
          isRunning: isSchedulerRunning(agent.id),
          isDistributing: distributing,
          cancelRequested: effectiveDistState.cancelRequested,
          nextRun: getNextRunTimeForAgent(agent.id),
          counters,
          eventLimit: limit,
          lastRun,
          currentRun: getCurrentRun(agent.id),
        };
      })
    );

    if (agentId && allStatus[agentId]) {
      return NextResponse.json({ ...allStatus[agentId], all: allStatus });
    }

    return NextResponse.json({ all: allStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
