'use client';

import { useEffect, useRef, useState } from 'react';
import type { LLMProviderType } from '@/types';

// ─────────────────────────────────────────────
// Types (mirrors server status shapes)
// ─────────────────────────────────────────────

type FieldSource = 'db' | 'env' | 'none';

interface CredentialStatus {
  algoliaAppId:        { value: string;  source: FieldSource };
  algoliaSearchApiKey: { isSet: boolean; source: FieldSource };
}

interface LLMProviderStatus {
  id: string;
  name: string;
  type: LLMProviderType;
  hasApiKey: boolean;
  baseUrl?: string;
  defaultModel: string;
}

interface AppConfigStatus {
  credentials: CredentialStatus;
  llmProviders: LLMProviderStatus[];
  defaultLlmProviderId?: string;
}

interface LLMProviderDraft {
  id: string;
  name: string;
  type: LLMProviderType;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

interface AppConfigPanelProps {
  onClose: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const PROVIDER_DEFAULTS: Record<LLMProviderType, { models: string[]; placeholder: string; needsKey: boolean; defaultBaseUrl: string }> = {
  anthropic: {
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-3-5', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
    placeholder: 'sk-ant-…',
    needsKey: true,
    defaultBaseUrl: '',
  },
  openai: {
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini'],
    placeholder: 'sk-…',
    needsKey: true,
    defaultBaseUrl: '',
  },
  ollama: {
    models: ['llama3.2', 'llama3.1', 'llama3', 'mistral', 'mixtral', 'codellama', 'phi3'],
    placeholder: '(not required)',
    needsKey: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
  },
};

const TYPE_LABELS: Record<LLMProviderType, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama',
};

const TYPE_ICONS: Record<LLMProviderType, string> = {
  anthropic: '🟠',
  openai: '🟢',
  ollama: '🦙',
};

const TYPE_COLORS: Record<LLMProviderType, string> = {
  anthropic: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  openai: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  ollama: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function SourceBadge({ source }: { source: FieldSource }) {
  if (source === 'db')
    return (
      <span className="text-[10px] font-medium bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">
        saved
      </span>
    );
  if (source === 'env')
    return (
      <span className="text-[10px] font-medium bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">
        .env
      </span>
    );
  return (
    <span className="text-[10px] font-medium bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">
      not set
    </span>
  );
}

interface SecretFieldProps {
  label: string;
  isSet: boolean;
  source: FieldSource;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

function SecretField({ label, isSet, source, value, onChange, placeholder }: SecretFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-slate-300">{label}</label>
        <SourceBadge source={source} />
      </div>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isSet && !value ? '••••••••••••  (leave blank to keep current)' : (placeholder ?? '')}
          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 pr-10 focus:outline-none focus:border-blue-500 placeholder-slate-600 font-mono"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors text-xs"
          tabIndex={-1}
        >
          {show ? '🙈' : '👁'}
        </button>
      </div>
      {isSet && !value && (
        <p className="text-[10px] text-slate-600 mt-0.5">
          Enter a new value to update, or leave blank to keep the existing one.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Provider form (add / edit)
// ─────────────────────────────────────────────

function ProviderForm({
  draft,
  isEditing,
  onChange,
  onSave,
  onCancel,
}: {
  draft: LLMProviderDraft;
  isEditing: boolean;
  onChange: (d: LLMProviderDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const defaults = PROVIDER_DEFAULTS[draft.type];

  const handleTypeChange = (type: LLMProviderType) => {
    const d = PROVIDER_DEFAULTS[type];
    onChange({
      ...draft,
      type,
      baseUrl: d.defaultBaseUrl,
      defaultModel: d.models[0],
      apiKey: '',
    });
  };

  const isValid =
    draft.name.trim() &&
    draft.defaultModel.trim() &&
    (draft.type === 'ollama' || draft.apiKey.trim() || isEditing);

  return (
    <div className="bg-slate-800/80 border border-slate-600 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-semibold text-white">
        {isEditing ? 'Edit Provider' : 'Add Provider'}
      </h4>

      {/* Provider type */}
      <div>
        <label className="text-xs font-medium text-slate-400 mb-1.5 block">Provider Type</label>
        <div className="grid grid-cols-3 gap-2">
          {(['anthropic', 'openai', 'ollama'] as LLMProviderType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleTypeChange(t)}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                draft.type === t
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500'
              }`}
            >
              <span>{TYPE_ICONS[t]}</span>
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Display name */}
      <div>
        <label className="text-xs font-medium text-slate-400 mb-1 block">Display Name</label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder={`e.g. ${TYPE_LABELS[draft.type]} (production)`}
          className="w-full bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-500"
        />
      </div>

      {/* API Key */}
      {defaults.needsKey && (
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1 block">
            API Key {isEditing && <span className="text-slate-500">(leave blank to keep existing)</span>}
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={draft.apiKey}
              onChange={(e) => onChange({ ...draft, apiKey: e.target.value })}
              placeholder={isEditing ? '••••••••  (unchanged)' : defaults.placeholder}
              className="w-full bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 pr-10 focus:outline-none focus:border-blue-500 placeholder-slate-500 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
              tabIndex={-1}
            >
              {showKey ? '🙈' : '👁'}
            </button>
          </div>
        </div>
      )}

      {/* Base URL (Ollama always, others optional) */}
      {(draft.type === 'ollama' || draft.baseUrl) && (
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1 block">
            Base URL {draft.type !== 'ollama' && <span className="text-slate-500">(optional, for custom endpoints)</span>}
          </label>
          <input
            type="text"
            value={draft.baseUrl}
            onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
            placeholder={defaults.defaultBaseUrl || 'https://…'}
            className="w-full bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-500 font-mono"
          />
        </div>
      )}

      {/* Custom base URL toggle for non-ollama */}
      {draft.type !== 'ollama' && !draft.baseUrl && (
        <button
          type="button"
          onClick={() => onChange({ ...draft, baseUrl: '' })}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
        >
          <span>+</span> Add custom base URL
        </button>
      )}

      {/* Default model */}
      <div>
        <label className="text-xs font-medium text-slate-400 mb-1 block">Default Model</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft.defaultModel}
            onChange={(e) => onChange({ ...draft, defaultModel: e.target.value })}
            placeholder="e.g. gpt-4o"
            className="flex-1 bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-500 font-mono"
          />
          <select
            value={defaults.models.includes(draft.defaultModel) ? draft.defaultModel : ''}
            onChange={(e) => { if (e.target.value) onChange({ ...draft, defaultModel: e.target.value }); }}
            className="bg-slate-700 border border-slate-600 text-slate-300 text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-blue-500 max-w-[120px]"
          >
            <option value="">Presets…</option>
            {defaults.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!isValid}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {isEditing ? 'Update Provider' : 'Add Provider'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Provider card (read mode)
// ─────────────────────────────────────────────

function ProviderCard({
  provider,
  isDefault,
  onEdit,
  onRemove,
  onSetDefault,
}: {
  provider: LLMProviderStatus;
  isDefault: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
      isDefault
        ? 'bg-blue-500/10 border-blue-500/30'
        : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
    }`}>
      <span className="text-xl shrink-0 mt-0.5">{TYPE_ICONS[provider.type]}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-white truncate">{provider.name}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${TYPE_COLORS[provider.type]}`}>
            {TYPE_LABELS[provider.type]}
          </span>
          {isDefault && (
            <span className="text-[10px] font-medium bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">
              default
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
          <span className="font-mono">{provider.defaultModel}</span>
          {provider.hasApiKey && <span className="text-emerald-500">● key set</span>}
          {!provider.hasApiKey && provider.type !== 'ollama' && (
            <span className="text-red-400">● no key</span>
          )}
          {provider.baseUrl && (
            <span className="truncate max-w-[140px]" title={provider.baseUrl}>{provider.baseUrl}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!isDefault && (
          <button
            onClick={onSetDefault}
            title="Set as default"
            className="p-1.5 text-slate-500 hover:text-blue-400 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
        )}
        <button
          onClick={onEdit}
          title="Edit"
          className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <button
          onClick={onRemove}
          title="Remove"
          className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────

const EMPTY_CREDS = { algoliaAppId: '', algoliaSearchApiKey: '' };

function emptyDraft(): LLMProviderDraft {
  return { id: uid(), name: '', type: 'anthropic', apiKey: '', baseUrl: '', defaultModel: 'claude-sonnet-4-5' };
}

export default function AppConfigPanel({ onClose }: AppConfigPanelProps) {
  const [appStatus, setAppStatus] = useState<AppConfigStatus | null>(null);
  const [form, setForm] = useState(EMPTY_CREDS);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // LLM provider UI state
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [providerDraft, setProviderDraft] = useState<LLMProviderDraft>(emptyDraft);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/app-config')
      .then((r) => r.json())
      .then((d: { status: CredentialStatus; appStatus?: AppConfigStatus }) => {
        const status = d.appStatus ?? { credentials: d.status, llmProviders: [] };
        setAppStatus(status);
        setForm((prev) => ({ ...prev, algoliaAppId: status.credentials.algoliaAppId.value }));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !showProviderForm) onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saving, onClose, showProviderForm]);

  // ── Credential save ──────────────────────────
  const handleSaveCreds = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/app-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json() as { ok?: boolean; appStatus?: AppConfigStatus; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.appStatus) setAppStatus(data.appStatus);
      setForm(EMPTY_CREDS);
      setSaveMsg({ ok: true, text: 'Credentials saved and encrypted.' });
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  // ── LLM provider helpers ─────────────────────
  const currentProviders: LLMProviderStatus[] = appStatus?.llmProviders ?? [];

  const saveLLMProviders = async (
    providers: LLMProviderStatus[],
    newDefaultId?: string
  ) => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/app-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llmProviders: providers.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
            baseUrl: p.baseUrl || undefined,
            defaultModel: p.defaultModel,
            // apiKey is not sent back — only new keys are sent during add/edit
          })),
          defaultLlmProviderId: newDefaultId ?? appStatus?.defaultLlmProviderId ?? '',
        }),
      });
      const data = await res.json() as { ok?: boolean; appStatus?: AppConfigStatus; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.appStatus) setAppStatus(data.appStatus);
      setSaveMsg({ ok: true, text: 'LLM providers updated.' });
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleAddOrUpdateProvider = async () => {
    const draft = providerDraft;
    if (!draft.name.trim() || !draft.defaultModel.trim()) return;

    // Build updated list
    const existing = currentProviders;
    let updatedStatuses: LLMProviderStatus[];

    if (editingProviderId) {
      updatedStatuses = existing.map((p) =>
        p.id === editingProviderId
          ? { id: p.id, name: draft.name, type: draft.type, hasApiKey: p.hasApiKey || !!draft.apiKey, baseUrl: draft.baseUrl || undefined, defaultModel: draft.defaultModel }
          : p
      );
    } else {
      const newStatus: LLMProviderStatus = {
        id: draft.id,
        name: draft.name,
        type: draft.type,
        hasApiKey: draft.type !== 'ollama' && !!draft.apiKey,
        baseUrl: draft.baseUrl || undefined,
        defaultModel: draft.defaultModel,
      };
      updatedStatuses = [...existing, newStatus];
    }

    setSaving(true);
    setSaveMsg(null);
    try {
      // Build the full provider payload including the new/updated API key
      const fullProviders = updatedStatuses.map((p) => {
        const base = { id: p.id, name: p.name, type: p.type, defaultModel: p.defaultModel, baseUrl: p.baseUrl };
        if (p.id === (editingProviderId ?? draft.id) && draft.apiKey) {
          return { ...base, apiKey: draft.apiKey };
        }
        return base;
      });

      const res = await fetch('/api/app-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llmProviders: fullProviders,
          defaultLlmProviderId: appStatus?.defaultLlmProviderId ?? '',
        }),
      });
      const data = await res.json() as { ok?: boolean; appStatus?: AppConfigStatus; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.appStatus) setAppStatus(data.appStatus);
      setShowProviderForm(false);
      setEditingProviderId(null);
      setProviderDraft(emptyDraft());
      setSaveMsg({ ok: true, text: editingProviderId ? 'Provider updated.' : 'Provider added.' });
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveProvider = async (id: string) => {
    const updated = currentProviders.filter((p) => p.id !== id);
    const newDefaultId = appStatus?.defaultLlmProviderId === id ? '' : appStatus?.defaultLlmProviderId;
    await saveLLMProviders(updated, newDefaultId);
  };

  const handleSetDefault = async (id: string) => {
    await saveLLMProviders(currentProviders, id);
  };

  const startEdit = (id: string) => {
    const p = currentProviders.find((x) => x.id === id);
    if (!p) return;
    setProviderDraft({
      id: p.id,
      name: p.name,
      type: p.type,
      apiKey: '',
      baseUrl: p.baseUrl ?? PROVIDER_DEFAULTS[p.type].defaultBaseUrl,
      defaultModel: p.defaultModel,
    });
    setEditingProviderId(id);
    setShowProviderForm(true);
  };

  const set = (key: keyof typeof EMPTY_CREDS) => (v: string) =>
    setForm((prev) => ({ ...prev, [key]: v }));

  const status = appStatus?.credentials ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!saving && !showProviderForm ? onClose : undefined}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative z-10 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[calc(100vh-2rem)] overflow-hidden mt-16"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">App Settings</h2>
            <p className="text-xs text-slate-400 mt-0.5">Algolia credentials &amp; LLM providers</p>
          </div>
          {!saving && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors text-xl leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Encryption notice */}
          <div className="flex items-start gap-3 bg-slate-800 rounded-xl p-3 text-xs text-slate-400">
            <span className="text-lg shrink-0">🔐</span>
            <p>
              Sensitive keys are encrypted with AES-256-GCM before being stored in Couchbase.
              The encryption key is derived from{' '}
              <code className="text-slate-300 bg-slate-700 px-1 rounded">ENCRYPTION_SECRET</code>{' '}
              in your <code className="text-slate-300 bg-slate-700 px-1 rounded">.env</code> file.
            </p>
          </div>

          {/* ── Algolia section ─────────────────────── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span className="text-base">🔍</span> Algolia
            </h3>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">Application ID</label>
                {status && <SourceBadge source={status.algoliaAppId.source} />}
              </div>
              <input
                type="text"
                value={form.algoliaAppId}
                onChange={(e) => set('algoliaAppId')(e.target.value)}
                placeholder="e.g. ABCDE12345"
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600 font-mono"
              />
            </div>

            <SecretField
              label="Search API Key"
              isSet={status?.algoliaSearchApiKey.isSet ?? false}
              source={status?.algoliaSearchApiKey.source ?? 'none'}
              value={form.algoliaSearchApiKey}
              onChange={set('algoliaSearchApiKey')}
              placeholder="Search-only key"
            />
          </section>

          {/* Algolia save */}
          <div className="flex justify-end">
            <button
              onClick={handleSaveCreds}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {saving ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </>
              ) : (
                'Save Credentials'
              )}
            </button>
          </div>

          <div className="border-t border-slate-700" />

          {/* ── LLM Providers ───────────────────────── */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <span className="text-base">🤖</span> LLM Providers
              </h3>
              {!showProviderForm && (
                <button
                  onClick={() => {
                    setProviderDraft(emptyDraft());
                    setEditingProviderId(null);
                    setShowProviderForm(true);
                  }}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Provider
                </button>
              )}
            </div>

            {/* Provider add/edit form */}
            {showProviderForm && (
              <ProviderForm
                draft={providerDraft}
                isEditing={!!editingProviderId}
                onChange={setProviderDraft}
                onSave={handleAddOrUpdateProvider}
                onCancel={() => {
                  setShowProviderForm(false);
                  setEditingProviderId(null);
                  setProviderDraft(emptyDraft());
                }}
              />
            )}

            {/* Provider list */}
            {currentProviders.length === 0 && !showProviderForm ? (
              <div className="text-center py-6 text-xs text-slate-500 bg-slate-800/40 rounded-xl border border-dashed border-slate-700">
                <p className="text-2xl mb-2">🤖</p>
                <p>No LLM providers configured.</p>
                <p className="mt-0.5">Add one above or rely on the legacy Anthropic key.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {currentProviders.map((p) => (
                  <ProviderCard
                    key={p.id}
                    provider={p}
                    isDefault={p.id === appStatus?.defaultLlmProviderId}
                    onEdit={() => startEdit(p.id)}
                    onRemove={() => handleRemoveProvider(p.id)}
                    onSetDefault={() => handleSetDefault(p.id)}
                  />
                ))}
              </div>
            )}

            {/* Default provider selector */}
            {currentProviders.length > 1 && (
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                  Default Provider
                </label>
                <select
                  value={appStatus?.defaultLlmProviderId ?? ''}
                  onChange={(e) => handleSetDefault(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                >
                  <option value="">— None selected —</option>
                  {currentProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {TYPE_ICONS[p.type]} {p.name} ({p.defaultModel})
                    </option>
                  ))}
                </select>
              </div>
            )}

          </section>

          {/* Feedback */}
          {saveMsg && (
            <div
              className={`text-sm px-4 py-3 rounded-xl ${
                saveMsg.ok
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}
            >
              {saveMsg.text}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700 flex justify-end shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
