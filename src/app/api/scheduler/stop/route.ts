import { NextRequest, NextResponse } from 'next/server';
import { stopScheduler, cancelDistribution, isSchedulerRunning, isDistributing } from '@/lib/scheduler';
import { getAllSites } from '@/lib/sites';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const siteId = body.siteId as string | undefined;
    const stopAll = body.stopAll === true;

    if (stopAll) {
      const sites = await getAllSites();
      await Promise.all(sites.map(async (site) => {
        stopScheduler(site.id);
        await cancelDistribution(site.id);
      }));
      return NextResponse.json({
        stopped: true,
        stopAll: true,
        sites: sites.map((s) => s.id),
      });
    }

    const cancelOnly = body.cancelOnly === true;
    const id = siteId ?? process.env.DEFAULT_SITE_ID ?? 'grocery';

    if (!cancelOnly) stopScheduler(id);
    await cancelDistribution(id);

    return NextResponse.json({
      stopped: !cancelOnly,
      cancelOnly,
      siteId: id,
      running: isSchedulerRunning(id),
      distributing: isDistributing(id),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
