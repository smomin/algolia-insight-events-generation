import { NextRequest, NextResponse } from 'next/server';
import {
  startScheduler,
  isSchedulerRunning,
  distributeSessionsForDay,
  getNextRunTimeForIndustry,
} from '@/lib/scheduler';
import { getIndustry, getPersonas, getAllIndustries } from '@/lib/industries';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const industryId = body.industryId as string | undefined;
    const runNow = body.runNow === true;
    const startAll = body.startAll === true;

    if (startAll) {
      const industries = await getAllIndustries();
      await Promise.all(
        industries.map(async (industry) => {
          const personas = await getPersonas(industry);
          if (!isSchedulerRunning(industry.id)) startScheduler(personas, industry);
          if (runNow) distributeSessionsForDay(personas, industry).catch(console.error);
        })
      );
      return NextResponse.json({
        started: true,
        startAll: true,
        industries: industries.map((i) => ({
          id: i.id,
          name: i.name,
          nextRun: getNextRunTimeForIndustry(i.id),
        })),
        message: `All ${industries.length} industry schedulers started.`,
      });
    }

    const id = industryId ?? 'grocery';
    const industry = await getIndustry(id);
    if (!industry) {
      return NextResponse.json({ error: `Industry "${id}" not found` }, { status: 404 });
    }

    const personas = await getPersonas(industry);
    if (!isSchedulerRunning(id)) startScheduler(personas, industry);
    if (runNow) distributeSessionsForDay(personas, industry).catch(console.error);

    return NextResponse.json({
      started: true,
      industryId: id,
      running: isSchedulerRunning(id),
      nextRun: getNextRunTimeForIndustry(id),
      message: runNow
        ? `Scheduler started and immediate run triggered for ${industry.name}.`
        : `Scheduler started for ${industry.name}.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
