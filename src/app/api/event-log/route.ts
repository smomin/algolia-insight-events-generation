import { NextRequest, NextResponse } from 'next/server';
import { getEventLog, clearEventLog } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const industryId = (searchParams.get('industryId') ?? 'grocery');
    const log = await getEventLog(industryId);
    return NextResponse.json({ events: log });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const industryId = (searchParams.get('industryId') ?? 'grocery');
    await clearEventLog(industryId);
    return NextResponse.json({ cleared: true, industryId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
