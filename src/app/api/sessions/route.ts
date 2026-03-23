import { NextRequest, NextResponse } from 'next/server';
import { getSessions, clearSessions } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const industryId = searchParams.get('industryId') ?? 'grocery';
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const all = await getSessions(industryId);
    const sessions = all.slice(0, limit);
    return NextResponse.json({ sessions, industryId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const industryId = searchParams.get('industryId') ?? 'grocery';
    await clearSessions(industryId);
    return NextResponse.json({ cleared: true, industryId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
