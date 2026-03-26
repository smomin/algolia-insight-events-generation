import { NextRequest, NextResponse } from 'next/server';
import { getSessions, clearSessions } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('API/sessions');

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agentId') ?? process.env.DEFAULT_AGENT_ID ?? 'grocery';
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    log.debug(`GET agentId="${agentId}" limit=${limit}`);
    const all = await getSessions(agentId);
    const sessions = all.slice(0, limit);
    log.debug(`returning ${sessions.length} of ${all.length} sessions for "${agentId}"`);
    return NextResponse.json({ sessions, agentId });
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
    await clearSessions(agentId);
    return NextResponse.json({ cleared: true, agentId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
