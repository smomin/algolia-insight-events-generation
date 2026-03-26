/**
 * App-level and per-agent credential + LLM provider management.
 *
 * Credential resolution order (highest → lowest priority):
 *   1. Agent-level override (stored encrypted in AgentConfig.credentials)
 *   2. Global app config     (stored encrypted in appConfig collection)
 *   3. Environment variable fallback
 *
 * LLM provider resolution order:
 *   1. Agent-level llmProviderId
 *   2. Global app config defaultLlmProviderId
 */

import { cbGet, cbUpsert } from './couchbase';
import { encrypt, decrypt, isEncrypted } from './crypto';
import { getAgentConfig } from './db';
import type { AppConfig, AlgoliaAppConfig, CredentialFields, LLMProviderConfig } from '@/types';

const CONFIG_KEY = '_config';

// ─────────────────────────────────────────────
// Storage helpers — Algolia credentials
// ─────────────────────────────────────────────

const SENSITIVE: (keyof CredentialFields)[] = ['algoliaSearchApiKey'];

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
        out[key] = undefined;
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// Storage helpers — LLM provider API keys
// ─────────────────────────────────────────────

function encryptProviders(providers: LLMProviderConfig[]): LLMProviderConfig[] {
  return providers.map((p) => {
    if (p.apiKey && !isEncrypted(p.apiKey)) {
      return { ...p, apiKey: encrypt(p.apiKey) };
    }
    return p;
  });
}

function decryptProviders(providers: LLMProviderConfig[]): LLMProviderConfig[] {
  return providers.map((p) => {
    if (p.apiKey && isEncrypted(p.apiKey)) {
      try {
        return { ...p, apiKey: decrypt(p.apiKey) };
      } catch {
        return { ...p, apiKey: undefined };
      }
    }
    return p;
  });
}

// ─────────────────────────────────────────────
// Storage helpers — Algolia app search keys
// ─────────────────────────────────────────────

function encryptAlgoliaApps(apps: AlgoliaAppConfig[]): AlgoliaAppConfig[] {
  return apps.map((a) => {
    if (a.searchApiKey && !isEncrypted(a.searchApiKey)) {
      return { ...a, searchApiKey: encrypt(a.searchApiKey) };
    }
    return a;
  });
}

function decryptAlgoliaApps(apps: AlgoliaAppConfig[]): AlgoliaAppConfig[] {
  return apps.map((a) => {
    if (a.searchApiKey && isEncrypted(a.searchApiKey)) {
      try {
        return { ...a, searchApiKey: decrypt(a.searchApiKey) };
      } catch {
        return { ...a, searchApiKey: '' };
      }
    }
    return a;
  });
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
  incoming: Partial<CredentialFields> & {
    llmProviders?: LLMProviderConfig[];
    defaultLlmProviderId?: string;
    personaGenerationLlmProviderId?: string;
    algoliaApps?: AlgoliaAppConfig[];
    defaultAlgoliaAppId?: string;
  }
): Promise<void> {
  const existing = (await getRawAppConfig()) ?? { updatedAt: '' };

  const merged: AppConfig = { ...existing, updatedAt: new Date().toISOString() };

  // Merge legacy Algolia credential fields
  for (const key of ['algoliaAppId', ...SENSITIVE] as (keyof CredentialFields)[]) {
    if (key in incoming) {
      const val = (incoming as Partial<Record<string, string>>)[key as string];
      if (val === '') {
        delete merged[key];
      } else if (val !== undefined) {
        (merged as unknown as Record<string, string>)[key as string] = val;
      }
    }
  }

  // Merge LLM provider fields — preserve existing encrypted keys for providers sent without a key
  if ('llmProviders' in incoming) {
    const existingProviders = existing.llmProviders ?? [];
    merged.llmProviders = (incoming.llmProviders ?? []).map((p) => {
      if (!p.apiKey) {
        const stored = existingProviders.find((e) => e.id === p.id);
        if (stored?.apiKey) return { ...p, apiKey: stored.apiKey };
      }
      return p;
    });
  }
  if ('defaultLlmProviderId' in incoming) {
    if (incoming.defaultLlmProviderId === '') {
      delete merged.defaultLlmProviderId;
    } else if (incoming.defaultLlmProviderId !== undefined) {
      merged.defaultLlmProviderId = incoming.defaultLlmProviderId;
    }
  }
  if ('personaGenerationLlmProviderId' in incoming) {
    if (incoming.personaGenerationLlmProviderId === '') {
      delete merged.personaGenerationLlmProviderId;
    } else if (incoming.personaGenerationLlmProviderId !== undefined) {
      merged.personaGenerationLlmProviderId = incoming.personaGenerationLlmProviderId;
    }
  }

  // Merge Algolia app fields — preserve existing encrypted keys for apps sent without a key
  if ('algoliaApps' in incoming) {
    const existingApps = existing.algoliaApps ?? [];
    merged.algoliaApps = (incoming.algoliaApps ?? []).map((a) => {
      if (!a.searchApiKey) {
        const stored = existingApps.find((e) => e.id === a.id);
        if (stored?.searchApiKey) return { ...a, searchApiKey: stored.searchApiKey };
      }
      return a;
    });
  }
  if ('defaultAlgoliaAppId' in incoming) {
    if (incoming.defaultAlgoliaAppId === '') {
      delete merged.defaultAlgoliaAppId;
    } else if (incoming.defaultAlgoliaAppId !== undefined) {
      merged.defaultAlgoliaAppId = incoming.defaultAlgoliaAppId;
    }
  }

  const encryptedCreds = encryptFields(merged);
  const toStore: AppConfig = {
    ...encryptedCreds,
    updatedAt: merged.updatedAt,
    llmProviders: merged.llmProviders ? encryptProviders(merged.llmProviders) : undefined,
    defaultLlmProviderId: merged.defaultLlmProviderId,
    personaGenerationLlmProviderId: merged.personaGenerationLlmProviderId,
    algoliaApps: merged.algoliaApps ? encryptAlgoliaApps(merged.algoliaApps) : undefined,
    defaultAlgoliaAppId: merged.defaultAlgoliaAppId,
  };
  await cbUpsert('appConfig', CONFIG_KEY, toStore);
}

// ─────────────────────────────────────────────
// Public: Resolved credentials (decrypted, with fallbacks)
// ─────────────────────────────────────────────

export interface ResolvedCredentials {
  algoliaAppId: string;
  algoliaSearchApiKey: string;
}

export interface ResolvedLLMProvider {
  provider: LLMProviderConfig;
  model: string;
}

/**
 * Returns fully resolved, decrypted Algolia credentials for a given agent
 * (or global if no agentId is given).
 *
 * Resolution order (highest → lowest priority):
 *   1. Agent algoliaAppConfigId → named AlgoliaAppConfig
 *   2. App-level defaultAlgoliaAppId → named AlgoliaAppConfig
 *   3. Legacy: per-agent credentials override
 *   4. Legacy: global AppConfig algoliaAppId / algoliaSearchApiKey
 *   5. Environment variable fallback
 */
export async function resolveCredentials(
  agentId?: string
): Promise<ResolvedCredentials> {
  const raw = await getRawAppConfig();
  const app: CredentialFields = raw ? decryptFields(raw) : {};

  let agentFields: CredentialFields = {};
  let agentAlgoliaAppConfigId: string | undefined;
  if (agentId) {
    const cfg = await getAgentConfig(agentId);
    if (cfg?.credentials) {
      agentFields = decryptFields(cfg.credentials);
    }
    agentAlgoliaAppConfigId = cfg?.algoliaAppConfigId;
  }

  // Resolve via named algoliaApps list (new system)
  const resolvedAppConfigId = agentAlgoliaAppConfigId ?? raw?.defaultAlgoliaAppId;
  if (resolvedAppConfigId && raw?.algoliaApps?.length) {
    const decryptedApps = decryptAlgoliaApps(raw.algoliaApps);
    const algoliaApp = decryptedApps.find((a) => a.id === resolvedAppConfigId);
    if (algoliaApp?.appId && algoliaApp?.searchApiKey) {
      return {
        algoliaAppId: algoliaApp.appId,
        algoliaSearchApiKey: algoliaApp.searchApiKey,
      };
    }
  }

  // Fall back to legacy per-agent and global credential fields + env vars
  function pick(key: keyof CredentialFields, envVal: string | undefined): string {
    return agentFields[key] || app[key] || envVal || '';
  }

  return {
    algoliaAppId:        pick('algoliaAppId',        process.env.NEXT_PUBLIC_ALGOLIA_APP_ID),
    algoliaSearchApiKey: pick('algoliaSearchApiKey', process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY),
  };
}

/**
 * Resolves the LLM provider and model for a given agent.
 * Resolution order:
 *   1. directProviderId (explicit override — bypasses agent lookup)
 *   2. Agent llmProviderId
 *   3. App-level defaultLlmProviderId
 * Model always comes from the resolved provider's defaultModel.
 */
export async function resolveLLMProvider(
  agentId?: string,
  directProviderId?: string
): Promise<ResolvedLLMProvider | null> {
  const raw = await getRawAppConfig();
  if (!raw) return null;

  const providers = raw.llmProviders ? decryptProviders(raw.llmProviders) : [];

  let agentProviderId: string | undefined;
  if (!directProviderId && agentId) {
    const cfg = await getAgentConfig(agentId);
    agentProviderId = cfg?.llmProviderId;
  }

  const resolvedProviderId = directProviderId || agentProviderId || raw.defaultLlmProviderId;

  if (resolvedProviderId) {
    const provider = providers.find((p) => p.id === resolvedProviderId);
    if (provider) {
      return {
        provider,
        model: provider.defaultModel,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────
// Public: Masked status for UI (never exposes secrets)
// ─────────────────────────────────────────────

export type FieldSource = 'db' | 'env' | 'none';

export interface CredentialStatus {
  algoliaAppId:        { value: string;  source: FieldSource };
  algoliaSearchApiKey: { isSet: boolean; source: FieldSource };
}

export interface LLMProviderStatus {
  id: string;
  name: string;
  type: LLMProviderConfig['type'];
  hasApiKey: boolean;
  baseUrl?: string;
  defaultModel: string;
}

export interface AlgoliaAppStatus {
  id: string;
  name: string;
  appId: string;
  hasSearchApiKey: boolean;
}

export interface AppConfigStatus {
  credentials: CredentialStatus;
  llmProviders: LLMProviderStatus[];
  defaultLlmProviderId?: string;
  personaGenerationLlmProviderId?: string;
  algoliaApps: AlgoliaAppStatus[];
  defaultAlgoliaAppId?: string;
}

export async function getCredentialStatus(
  agentId?: string
): Promise<CredentialStatus> {
  const raw = await getRawAppConfig();
  const app: CredentialFields = raw ? decryptFields(raw) : {};

  let agentFields: CredentialFields = {};
  if (agentId) {
    const cfg = await getAgentConfig(agentId);
    if (cfg?.credentials) agentFields = decryptFields(cfg.credentials);
  }

  function sourceFor(key: keyof CredentialFields): FieldSource {
    if (agentFields[key]) return 'db';
    if (app[key]) return 'db';
    const envKeys: Record<string, string | undefined> = {
      algoliaAppId:        process.env.NEXT_PUBLIC_ALGOLIA_APP_ID,
      algoliaSearchApiKey: process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY,
    };
    return envKeys[key as string] ? 'env' : 'none';
  }

  return {
    algoliaAppId:        { value: agentFields.algoliaAppId || app.algoliaAppId || process.env.NEXT_PUBLIC_ALGOLIA_APP_ID || '', source: sourceFor('algoliaAppId') },
    algoliaSearchApiKey: { isSet: !!(agentFields.algoliaSearchApiKey || app.algoliaSearchApiKey || process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY), source: sourceFor('algoliaSearchApiKey') },
  };
}

export async function getAppConfigStatus(): Promise<AppConfigStatus> {
  const raw = await getRawAppConfig();
  const credentialStatus = await getCredentialStatus();

  const providers = raw?.llmProviders ? decryptProviders(raw.llmProviders) : [];
  const llmProviders: LLMProviderStatus[] = providers.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    hasApiKey: !!p.apiKey,
    baseUrl: p.baseUrl,
    defaultModel: p.defaultModel,
  }));

  const apps = raw?.algoliaApps ? decryptAlgoliaApps(raw.algoliaApps) : [];
  const algoliaApps: AlgoliaAppStatus[] = apps.map((a) => ({
    id: a.id,
    name: a.name,
    appId: a.appId,
    hasSearchApiKey: !!a.searchApiKey,
  }));

  return {
    credentials: credentialStatus,
    llmProviders,
    defaultLlmProviderId: raw?.defaultLlmProviderId,
    personaGenerationLlmProviderId: raw?.personaGenerationLlmProviderId,
    algoliaApps,
    defaultAlgoliaAppId: raw?.defaultAlgoliaAppId,
  };
}

/** Encrypt agent credentials before saving to AgentConfig. */
export function encryptAgentCredentials(
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
