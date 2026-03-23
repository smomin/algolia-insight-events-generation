'use client';

import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────
// Types (mirrors server CredentialStatus)
// ─────────────────────────────────────────────

type FieldSource = 'db' | 'env' | 'none';

interface CredentialStatus {
  algoliaAppId:        { value: string;  source: FieldSource };
  algoliaSearchApiKey: { isSet: boolean; source: FieldSource };
  anthropicApiKey:     { isSet: boolean; source: FieldSource };
}

interface AppConfigPanelProps {
  onClose: () => void;
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
  fieldKey: string;
  isSet: boolean;
  source: FieldSource;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

function SecretField({
  label,
  fieldKey,
  isSet,
  source,
  value,
  onChange,
  placeholder,
}: SecretFieldProps) {
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
          placeholder={
            isSet && !value
              ? '••••••••••••  (leave blank to keep current)'
              : (placeholder ?? '')
          }
          className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 pr-10 focus:outline-none focus:border-blue-500 placeholder-slate-600 font-mono"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors text-xs"
          tabIndex={-1}
          aria-label={show ? 'Hide' : 'Show'}
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
// Main panel
// ─────────────────────────────────────────────

const EMPTY_FORM = {
  algoliaAppId: '',
  algoliaSearchApiKey: '',
  anthropicApiKey: '',
};

export default function AppConfigPanel({ onClose }: AppConfigPanelProps) {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load current status
  useEffect(() => {
    fetch('/api/app-config')
      .then((r) => r.json())
      .then((d: { status: CredentialStatus }) => {
        setStatus(d.status);
        // Pre-fill the (non-secret) App ID from the status value
        setForm((prev) => ({
          ...prev,
          algoliaAppId: d.status.algoliaAppId.value,
        }));
      })
      .catch(console.error);
  }, []);

  // Escape to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saving, onClose]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/app-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        status?: CredentialStatus;
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.status) setStatus(data.status);
      setForm(EMPTY_FORM);
      setSaveMsg({ ok: true, text: 'Credentials saved and encrypted.' });
    } catch (err) {
      setSaveMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof typeof EMPTY_FORM) => (v: string) =>
    setForm((prev) => ({ ...prev, [key]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!saving ? onClose : undefined}
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
            <p className="text-xs text-slate-400 mt-0.5">
              Global API credentials — encrypted at rest
            </p>
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

          {/* Algolia section */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span className="text-base">🔍</span> Algolia
            </h3>

            {/* App ID — plain text */}
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
              fieldKey="algoliaSearchApiKey"
              isSet={status?.algoliaSearchApiKey.isSet ?? false}
              source={status?.algoliaSearchApiKey.source ?? 'none'}
              value={form.algoliaSearchApiKey}
              onChange={set('algoliaSearchApiKey')}
              placeholder="Search-only key"
            />
          </section>

          <div className="border-t border-slate-700" />

          {/* LLM section */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span className="text-base">🤖</span> LLM (Anthropic Claude)
            </h3>

            <SecretField
              label="Anthropic API Key"
              fieldKey="anthropicApiKey"
              isSet={status?.anthropicApiKey.isSet ?? false}
              source={status?.anthropicApiKey.source ?? 'none'}
              value={form.anthropicApiKey}
              onChange={set('anthropicApiKey')}
              placeholder="sk-ant-..."
            />
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
        <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
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
      </div>
    </div>
  );
}
