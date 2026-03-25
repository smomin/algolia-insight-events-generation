import { NextRequest, NextResponse } from 'next/server';
import {
  startScheduler,
  isSchedulerRunning,
  distributeSessionsForDay,
  getNextRunTimeForSite,
} from '@/lib/scheduler';
import { getSite, getPersonas, getAllSites } from '@/lib/sites';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const siteId = body.siteId as string | undefined;
    const runNow = body.runNow === true;
    const startAll = body.startAll === true;

    if (startAll) {
      const sites = await getAllSites();
      await Promise.all(
        sites.map(async (site) => {
          const personas = await getPersonas(site);
          if (!isSchedulerRunning(site.id)) startScheduler(personas, site);
          if (runNow) distributeSessionsForDay(personas, site).catch(console.error);
        })
      );
      return NextResponse.json({
        started: true,
        startAll: true,
        sites: sites.map((s) => ({
          id: s.id,
          name: s.name,
          nextRun: getNextRunTimeForSite(s.id),
        })),
        message: `All ${sites.length} site schedulers started.`,
      });
    }

    const id = siteId ?? process.env.DEFAULT_SITE_ID ?? 'grocery';
    const site = await getSite(id);
    if (!site) {
      return NextResponse.json({ error: `Site "${id}" not found` }, { status: 404 });
    }

    const personas = await getPersonas(site);
    if (!isSchedulerRunning(id)) startScheduler(personas, site);
    if (runNow) distributeSessionsForDay(personas, site).catch(console.error);

    return NextResponse.json({
      started: true,
      siteId: id,
      running: isSchedulerRunning(id),
      nextRun: getNextRunTimeForSite(id),
      message: runNow
        ? `Scheduler started and immediate run triggered for ${site.name}.`
        : `Scheduler started for ${site.name}.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
