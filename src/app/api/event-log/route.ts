import { NextRequest, NextResponse } from 'next/server';
import { getEventLog, clearEventLog } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agentId') ?? searchParams.get('siteId') ?? process.env.DEFAULT_SITE_ID ?? 'grocery';
    console.log(`[DEBUG:API/event-log] GET agentId="${agentId}" — calling getEventLog`);
    const log = await getEventLog(agentId);
    console.log(`[DEBUG:API/event-log] returning ${log.length} events for "${agentId}"`);
    return NextResponse.json({ events: log });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[DEBUG:API/event-log] ERROR:`, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agentId') ?? searchParams.get('siteId') ?? process.env.DEFAULT_SITE_ID ?? 'grocery';
    await clearEventLog(agentId);
    return NextResponse.json({ cleared: true, agentId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
