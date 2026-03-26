import { NextRequest, NextResponse } from 'next/server';
import { getEventLog, clearEventLog } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('API/event-log');

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agentId') ?? process.env.DEFAULT_AGENT_ID ?? 'grocery';
    log.debug(`GET agentId="${agentId}"`);
    const events = await getEventLog(agentId);
    log.debug(`returning ${events.length} events for "${agentId}"`);
    return NextResponse.json({ events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('GET failed', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agentId') ?? process.env.DEFAULT_AGENT_ID ?? 'grocery';
    await clearEventLog(agentId);
    return NextResponse.json({ cleared: true, agentId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('DELETE failed', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
