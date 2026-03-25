import { NextRequest, NextResponse } from 'next/server';
import { stopScheduler, cancelDistribution, isSchedulerRunning, isDistributing } from '@/lib/scheduler';
import { getAllAgents } from '@/lib/agentConfigs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const agentId = (body.agentId as string | undefined) ?? (body.siteId as string | undefined);
    const stopAll = body.stopAll === true;

    if (stopAll) {
      const agents = await getAllAgents();
      await Promise.all(agents.map(async (agent) => {
        stopScheduler(agent.id);
        await cancelDistribution(agent.id);
      }));
      return NextResponse.json({
        stopped: true,
        stopAll: true,
        agents: agents.map((a) => a.id),
      });
    }

    const cancelOnly = body.cancelOnly === true;
    const id = agentId ?? process.env.DEFAULT_SITE_ID ?? 'grocery';

    if (!cancelOnly) stopScheduler(id);
    await cancelDistribution(id);

    return NextResponse.json({
      stopped: !cancelOnly,
      cancelOnly,
      agentId: id,
      running: isSchedulerRunning(id),
      distributing: isDistributing(id),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
