import { NextRequest, NextResponse } from 'next/server';
import { getSessions, clearSessions } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId') ?? process.env.DEFAULT_SITE_ID ?? 'grocery';
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const all = await getSessions(siteId);
    const sessions = all.slice(0, limit);
    return NextResponse.json({ sessions, siteId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId') ?? process.env.DEFAULT_SITE_ID ?? 'grocery';
    await clearSessions(siteId);
    return NextResponse.json({ cleared: true, siteId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
