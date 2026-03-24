import { NextRequest, NextResponse } from 'next/server';
import { stopScheduler, cancelDistribution, isSchedulerRunning, isDistributing } from '@/lib/scheduler';
import { getAllIndustries } from '@/lib/industries';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const industryId = body.industryId as string | undefined;
    const stopAll = body.stopAll === true;

    if (stopAll) {
      const industries = await getAllIndustries();
      await Promise.all(industries.map(async (industry) => {
        stopScheduler(industry.id);
        await cancelDistribution(industry.id);
      }));
      return NextResponse.json({
        stopped: true,
        stopAll: true,
        industries: industries.map((i) => i.id),
      });
    }

    const cancelOnly = body.cancelOnly === true;
    const id = industryId ?? process.env.DEFAULT_INDUSTRY_ID ?? 'grocery';

    if (!cancelOnly) stopScheduler(id);
    await cancelDistribution(id);

    return NextResponse.json({
      stopped: !cancelOnly,
      cancelOnly,
      industryId: id,
      running: isSchedulerRunning(id),
      distributing: isDistributing(id),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
