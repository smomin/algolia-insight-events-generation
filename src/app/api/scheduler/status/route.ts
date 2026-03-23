import { NextRequest, NextResponse } from 'next/server';
import {
  isSchedulerRunning,
  isDistributing,
  getCurrentRun,
  getNextRunTimeForIndustry,
} from '@/lib/scheduler';
import { getTodayCounters, getLastSchedulerRun, getDistributionState, setDistributionActive } from '@/lib/db';
import { getAllIndustries, getEventLimit } from '@/lib/industries';

// If the persisted state claims a run is active but in-memory says otherwise
// and the run started more than this many ms ago, treat it as stale and auto-clear.
const STALE_DISTRIBUTION_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const industryId = searchParams.get('industryId');

    const limit = getEventLimit();
    const industries = await getAllIndustries();

    const allStatus: Record<string, unknown> = {};
    await Promise.all(
      industries.map(async (industry) => {
        const [counters, lastRun, distState] = await Promise.all([
          getTodayCounters(industry.id),
          getLastSchedulerRun(industry.id),
          getDistributionState(industry.id),
        ]);
        // Auto-clear stale persisted distribution state.
        // If DB says "distributing" but in-memory says no and it started >10 min ago,
        // the process was killed or hot-reloaded mid-run without cleanup.
        let effectiveDistState = distState;
        if (
          distState.isDistributing &&
          !isDistributing(industry.id) &&
          distState.startedAt &&
          Date.now() - new Date(distState.startedAt).getTime() > STALE_DISTRIBUTION_MS
        ) {
          await setDistributionActive(industry.id, distState.runId ?? '', false);
          effectiveDistState = { isDistributing: false, cancelRequested: false };
        }

        // Merge in-memory and persisted state: if either says distributing, show as active.
        // This keeps status correct after hot reloads.
        const distributing = isDistributing(industry.id) || effectiveDistState.isDistributing;
        allStatus[industry.id] = {
          industryId: industry.id,
          name: industry.name,
          icon: industry.icon,
          color: industry.color,
          isRunning: isSchedulerRunning(industry.id),
          isDistributing: distributing,
          cancelRequested: effectiveDistState.cancelRequested,
          nextRun: getNextRunTimeForIndustry(industry.id),
          counters,
          eventLimit: limit,
          lastRun,
          currentRun: getCurrentRun(industry.id),
        };
      })
    );

    if (industryId && allStatus[industryId]) {
      return NextResponse.json({ ...allStatus[industryId], all: allStatus });
    }

    return NextResponse.json({ all: allStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
