import { NextRequest, NextResponse } from 'next/server';
import { getEventLog, clearEventLog } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId') ?? process.env.DEFAULT_SITE_ID ?? 'grocery';
    const log = await getEventLog(siteId);
    return NextResponse.json({ events: log });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId') ?? process.env.DEFAULT_SITE_ID ?? 'grocery';
    await clearEventLog(siteId);
    return NextResponse.json({ cleared: true, siteId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
