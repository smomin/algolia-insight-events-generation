import { NextResponse } from 'next/server';
import {
  getAppConfigStatus,
  getCredentialStatus,
  saveAppConfig,
} from '@/lib/appConfig';
import type { AlgoliaAppConfig, CredentialFields, LLMProviderConfig } from '@/types';

/**
 * GET /api/app-config
 * Returns current credential + LLM provider status — never exposes raw secret values.
 */
export async function GET() {
  try {
    const appStatus = await getAppConfigStatus();
    // Keep backward compat: also return top-level `status` for legacy consumers
    return NextResponse.json({ status: appStatus.credentials, appStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PUT /api/app-config
 * Accepts credential values and/or LLM provider configuration.
 * Sending an empty string for a credential field clears it (reverts to env fallback).
 */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<CredentialFields> & {
      llmProviders?: LLMProviderConfig[];
      defaultLlmProviderId?: string;
      personaGenerationLlmProviderId?: string;
      algoliaApps?: AlgoliaAppConfig[];
      defaultAlgoliaAppId?: string;
    };

    const allowedCreds: (keyof CredentialFields)[] = [
      'algoliaAppId',
      'algoliaSearchApiKey',
    ];

    const filtered: Partial<CredentialFields> & {
      llmProviders?: LLMProviderConfig[];
      defaultLlmProviderId?: string;
      personaGenerationLlmProviderId?: string;
      algoliaApps?: AlgoliaAppConfig[];
      defaultAlgoliaAppId?: string;
    } = {};

    for (const key of allowedCreds) {
      if (key in body) {
        (filtered as Record<string, string>)[key] =
          (body as Record<string, string>)[key] ?? '';
      }
    }

    if ('llmProviders' in body) {
      filtered.llmProviders = body.llmProviders;
    }
    if ('defaultLlmProviderId' in body) {
      filtered.defaultLlmProviderId = body.defaultLlmProviderId ?? '';
    }
    if ('personaGenerationLlmProviderId' in body) {
      filtered.personaGenerationLlmProviderId = body.personaGenerationLlmProviderId ?? '';
    }
    if ('algoliaApps' in body) {
      filtered.algoliaApps = body.algoliaApps;
    }
    if ('defaultAlgoliaAppId' in body) {
      filtered.defaultAlgoliaAppId = body.defaultAlgoliaAppId ?? '';
    }

    await saveAppConfig(filtered);
    const appStatus = await getAppConfigStatus();
    const status = await getCredentialStatus();
    return NextResponse.json({ ok: true, status, appStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
