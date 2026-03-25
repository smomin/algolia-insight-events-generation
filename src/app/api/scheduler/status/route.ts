import { NextRequest, NextResponse } from 'next/server';
import {
  isSchedulerRunning,
  isDistributing,
  getCurrentRun,
  getNextRunTimeForSite,
} from '@/lib/scheduler';
import { getTodayCounters, getLastSchedulerRun, getDistributionState, setDistributionActive } from '@/lib/db';
import { getAllSites, getEventLimit } from '@/lib/sites';

// If the persisted state claims a run is active but in-memory says otherwise
// and the run started more than this many ms ago, treat it as stale and auto-clear.
const STALE_DISTRIBUTION_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');

    const limit = getEventLimit();
    const sites = await getAllSites();

    const allStatus: Record<string, unknown> = {};
    await Promise.all(
      sites.map(async (site) => {
        const [counters, lastRun, distState] = await Promise.all([
          getTodayCounters(site.id),
          getLastSchedulerRun(site.id),
          getDistributionState(site.id),
        ]);
        // Auto-clear stale persisted distribution state.
        let effectiveDistState = distState;
        if (
          distState.isDistributing &&
          !isDistributing(site.id) &&
          distState.startedAt &&
          Date.now() - new Date(distState.startedAt).getTime() > STALE_DISTRIBUTION_MS
        ) {
          await setDistributionActive(site.id, distState.runId ?? '', false);
          effectiveDistState = { isDistributing: false, cancelRequested: false };
        }

        const distributing = isDistributing(site.id) || effectiveDistState.isDistributing;
        allStatus[site.id] = {
          siteId: site.id,
          name: site.name,
          icon: site.icon,
          color: site.color,
          isRunning: isSchedulerRunning(site.id),
          isDistributing: distributing,
          cancelRequested: effectiveDistState.cancelRequested,
          nextRun: getNextRunTimeForSite(site.id),
          counters,
          eventLimit: limit,
          lastRun,
          currentRun: getCurrentRun(site.id),
        };
      })
    );

    if (siteId && allStatus[siteId]) {
      return NextResponse.json({ ...allStatus[siteId], all: allStatus });
    }

    return NextResponse.json({ all: allStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
