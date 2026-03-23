/**
 * App-level and per-industry credential management.
 *
 * Credential resolution order (highest → lowest priority):
 *   1. Industry-level override (stored encrypted in IndustryV2.credentials)
 *   2. Global app config     (stored encrypted in appConfig collection)
 *   3. Environment variable fallback
 */

import { cbGet, cbUpsert } from './couchbase';
import { encrypt, decrypt, isEncrypted } from './crypto';
import { getIndustryConfig } from './db';
import type { AppConfig, CredentialFields } from '@/types';

const CONFIG_KEY = '_config';

// ─────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────

const SENSITIVE: (keyof CredentialFields)[] = [
  'algoliaSearchApiKey',
  'anthropicApiKey',
];

function encryptFields(fields: CredentialFields): CredentialFields {
  const out: CredentialFields = { ...fields };
  for (const key of SENSITIVE) {
    const val = out[key];
    if (val && !isEncrypted(val)) {
      out[key] = encrypt(val);
    }
  }
  return out;
}

function decryptFields(fields: CredentialFields): CredentialFields {
  const out: CredentialFields = { ...fields };
  for (const key of SENSITIVE) {
    const val = out[key];
    if (val && isEncrypted(val)) {
      try {
        out[key] = decrypt(val);
      } catch {
        out[key] = undefined; // corrupt — treat as unset
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// Public: App config CRUD
// ─────────────────────────────────────────────

/** Returns raw (still-encrypted) app config from Couchbase. */
export async function getRawAppConfig(): Promise<AppConfig | null> {
  return cbGet<AppConfig>('appConfig', CONFIG_KEY);
}

/**
 * Merge incoming partial fields into the existing config and save.
 * Sensitive values are encrypted before writing.
 * Pass an empty string for a field to clear it.
 */
export async function saveAppConfig(
  incoming: Partial<CredentialFields>
): Promise<void> {
  const existing = (await getRawAppConfig()) ?? { updatedAt: '' };

  const merged: AppConfig = { ...existing, updatedAt: new Date().toISOString() };

  for (const key of ['algoliaAppId', ...SENSITIVE] as (keyof CredentialFields)[]) {
    if (key in incoming) {
      const val = (incoming as Partial<Record<string, string>>)[key as string];
      if (val === '') {
        delete merged[key]; // explicit clear
      } else if (val !== undefined) {
        (merged as unknown as Record<string, string>)[key as string] = val;
      }
    }
  }

  // Encrypt sensitive before storing
  const toStore: AppConfig = {
    ...encryptFields(merged),
    updatedAt: merged.updatedAt,
  };
  await cbUpsert('appConfig', CONFIG_KEY, toStore);
}

// ─────────────────────────────────────────────
// Public: Resolved credentials (decrypted, with fallbacks)
// ─────────────────────────────────────────────

export interface ResolvedCredentials {
  algoliaAppId: string;
  algoliaSearchApiKey: string;
  anthropicApiKey: string;
}

/**
 * Returns fully resolved, decrypted credentials for a given industry
 * (or global if no industryId is given).
 */
export async function resolveCredentials(
  industryId?: string
): Promise<ResolvedCredentials> {
  // Load app-level config (decrypted)
  const raw = await getRawAppConfig();
  const app: CredentialFields = raw ? decryptFields(raw) : {};

  // Load industry overrides (decrypted) if an industry is specified
  let ind: CredentialFields = {};
  if (industryId) {
    const cfg = await getIndustryConfig(industryId);
    if (cfg?.credentials) {
      ind = decryptFields(cfg.credentials);
    }
  }

  function pick(key: keyof CredentialFields, envVal: string | undefined): string {
    return ind[key] || app[key] || envVal || '';
  }

  return {
    algoliaAppId:        pick('algoliaAppId',        process.env.NEXT_PUBLIC_ALGOLIA_APP_ID),
    algoliaSearchApiKey: pick('algoliaSearchApiKey', process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY),
    anthropicApiKey:     pick('anthropicApiKey',     process.env.ANTHROPIC_API_KEY),
  };
}

// ─────────────────────────────────────────────
// Public: Masked status for UI (never exposes secrets)
// ─────────────────────────────────────────────

export type FieldSource = 'db' | 'env' | 'none';

export interface CredentialStatus {
  algoliaAppId:        { value: string;  source: FieldSource };
  algoliaSearchApiKey: { isSet: boolean; source: FieldSource };
  anthropicApiKey:     { isSet: boolean; source: FieldSource };
}

export async function getCredentialStatus(
  industryId?: string
): Promise<CredentialStatus> {
  const raw = await getRawAppConfig();
  const app: CredentialFields = raw ? decryptFields(raw) : {};

  let ind: CredentialFields = {};
  if (industryId) {
    const cfg = await getIndustryConfig(industryId);
    if (cfg?.credentials) ind = decryptFields(cfg.credentials);
  }

  function sourceFor(key: keyof CredentialFields): FieldSource {
    if (ind[key]) return 'db';
    if (app[key]) return 'db';
    const envKeys: Record<string, string | undefined> = {
      algoliaAppId:        process.env.NEXT_PUBLIC_ALGOLIA_APP_ID,
      algoliaSearchApiKey: process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY,
      anthropicApiKey:     process.env.ANTHROPIC_API_KEY,
    };
    return envKeys[key as string] ? 'env' : 'none';
  }

  return {
    algoliaAppId:        { value: ind.algoliaAppId || app.algoliaAppId || process.env.NEXT_PUBLIC_ALGOLIA_APP_ID || '', source: sourceFor('algoliaAppId') },
    algoliaSearchApiKey: { isSet: !!(ind.algoliaSearchApiKey || app.algoliaSearchApiKey || process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY), source: sourceFor('algoliaSearchApiKey') },
    anthropicApiKey:     { isSet: !!(ind.anthropicApiKey     || app.anthropicApiKey     || process.env.ANTHROPIC_API_KEY),                  source: sourceFor('anthropicApiKey')     },
  };
}

/** Encrypt industry credentials before saving to IndustryV2. */
export function encryptIndustryCredentials(
  creds: CredentialFields
): CredentialFields {
  const filtered: CredentialFields = {};
  for (const [k, v] of Object.entries(creds)) {
    if (v && v.trim()) {
      (filtered as Record<string, string>)[k] = v;
    }
  }
  return encryptFields(filtered);
}
