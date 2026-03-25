import { NextRequest, NextResponse } from 'next/server';
import {
  startScheduler,
  isSchedulerRunning,
  distributeSessionsForDay,
  getNextRunTimeForAgent,
} from '@/lib/scheduler';
import { getAgent, getPersonas, getAllAgents } from '@/lib/agentConfigs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const agentId = (body.agentId as string | undefined) ?? (body.siteId as string | undefined);
    const runNow = body.runNow === true;
    const startAll = body.startAll === true;

    if (startAll) {
      const agents = await getAllAgents();
      await Promise.all(
        agents.map(async (agent) => {
          const personas = await getPersonas(agent);
          if (!isSchedulerRunning(agent.id)) startScheduler(personas, agent);
          if (runNow) distributeSessionsForDay(personas, agent).catch(console.error);
        })
      );
      return NextResponse.json({
        started: true,
        startAll: true,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          nextRun: getNextRunTimeForAgent(a.id),
        })),
        message: `All ${agents.length} agent schedulers started.`,
      });
    }

    const id = agentId ?? process.env.DEFAULT_SITE_ID ?? 'grocery';
    const agent = await getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: `Agent "${id}" not found` }, { status: 404 });
    }

    const personas = await getPersonas(agent);
    if (!isSchedulerRunning(id)) startScheduler(personas, agent);
    if (runNow) distributeSessionsForDay(personas, agent).catch(console.error);

    return NextResponse.json({
      started: true,
      agentId: id,
      running: isSchedulerRunning(id),
      nextRun: getNextRunTimeForAgent(id),
      message: runNow
        ? `Scheduler started and immediate run triggered for ${agent.name}.`
        : `Scheduler started for ${agent.name}.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
