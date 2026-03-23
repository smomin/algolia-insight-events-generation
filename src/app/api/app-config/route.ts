import { NextResponse } from 'next/server';
import {
  getCredentialStatus,
  saveAppConfig,
} from '@/lib/appConfig';
import type { CredentialFields } from '@/types';

/**
 * GET /api/app-config
 * Returns current credential status — never exposes raw secret values.
 */
export async function GET() {
  try {
    const status = await getCredentialStatus();
    return NextResponse.json({ status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PUT /api/app-config
 * Accepts plain-text credential values, encrypts, and stores.
 * Sending an empty string for a field clears it (reverts to env fallback).
 */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<CredentialFields>;

    const allowed: (keyof CredentialFields)[] = [
      'algoliaAppId',
      'algoliaSearchApiKey',
      'anthropicApiKey',
    ];

    const filtered: Partial<CredentialFields> = {};
    for (const key of allowed) {
      if (key in body) {
        (filtered as Record<string, string>)[key] =
          (body as Record<string, string>)[key] ?? '';
      }
    }

    await saveAppConfig(filtered);
    const status = await getCredentialStatus();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
