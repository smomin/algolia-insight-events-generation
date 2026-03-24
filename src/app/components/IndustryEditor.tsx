'use client';

import { useState, useEffect, useCallback } from 'react';
import type { IndustryV2, FlexIndex, IndexEvent, AlgoliaEventType, AlgoliaEventSubtype, IndustryCredentials, LLMProviderType } from '@/types';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const ICONS = [
  '🛒', '💼', '🏥', '🏔️', '✈️', '🏠', '📚', '🎮', '🚗', '🍽️',
  '👗', '💊', '🏋️', '🎵', '🎨', '💰', '📱', '🛍️', '🌿', '🏦',
  '🎓', '🔬', '⚽', '🌍', '🏗️', '🚀', '🎯', '🌾', '💻', '🧪',
];

const COLORS: { id: string; label: string; bg: string; border: string; text: string }[] = [
  { id: 'blue',    label: 'Blue',    bg: 'bg-blue-500',    border: 'border-blue-400',    text: 'text-blue-400' },
  { id: 'emerald', label: 'Emerald', bg: 'bg-emerald-500', border: 'border-emerald-400', text: 'text-emerald-400' },
  { id: 'violet',  label: 'Violet',  bg: 'bg-violet-500',  border: 'border-violet-400',  text: 'text-violet-400' },
  { id: 'rose',    label: 'Rose',    bg: 'bg-rose-500',    border: 'border-rose-400',    text: 'text-rose-400' },
  { id: 'amber',   label: 'Amber',   bg: 'bg-amber-500',   border: 'border-amber-400',   text: 'text-amber-400' },
  { id: 'cyan',    label: 'Cyan',    bg: 'bg-cyan-500',    border: 'border-cyan-400',    text: 'text-cyan-400' },
  { id: 'orange',  label: 'Orange',  bg: 'bg-orange-500',  border: 'border-orange-400',  text: 'text-orange-400' },
  { id: 'pink',    label: 'Pink',    bg: 'bg-pink-500',    border: 'border-pink-400',    text: 'text-pink-400' },
  { id: 'teal',    label: 'Teal',    bg: 'bg-teal-500',    border: 'border-teal-400',    text: 'text-teal-400' },
  { id: 'indigo',  label: 'Indigo',  bg: 'bg-indigo-500',  border: 'border-indigo-400',  text: 'text-indigo-400' },
  { id: 'lime',    label: 'Lime',    bg: 'bg-lime-500',    border: 'border-lime-400',    text: 'text-lime-400' },
  { id: 'red',     label: 'Red',     bg: 'bg-red-500',     border: 'border-red-400',     text: 'text-red-400' },
];

const EVENT_TYPES: { value: AlgoliaEventType; label: string }[] = [
  { value: 'click',      label: 'click' },
  { value: 'view',       label: 'view' },
  { value: 'conversion', label: 'conversion' },
];

const EVENT_SUBTYPES: { value: AlgoliaEventSubtype | ''; label: string }[] = [
  { value: '',           label: '— none —' },
  { value: 'addToCart',  label: 'addToCart' },
  { value: 'purchase',   label: 'purchase' },
];

const DEFAULT_PROMPTS = {
  generatePrimaryQuery:
    'Generate a natural language search query for this persona. Output only the search query string, nothing else. No quotes, no punctuation at the end.',
  selectBestResult:
    'You are a recommendation engine. Return JSON only in this exact format: {"index": <number>, "reason": "<string>"}. No markdown, no extra text. Select the best result index (0-based) for this persona.',
  generateSecondaryQueries:
    'Return a JSON array only — no markdown, no code fences, no extra text. Output 3 to 5 short search query strings relevant to the primary result for this persona.',
};

// ─────────────────────────────────────────────
// Form state types
// ─────────────────────────────────────────────

interface EventRow {
  _key: string;
  eventType: AlgoliaEventType;
  eventSubtype: AlgoliaEventSubtype | '';
  eventName: string;
}

interface IndexForm {
  _key: string;
  id: string;
  label: string;
  indexName: string;
  role: 'primary' | 'secondary';
  events: EventRow[];
}

interface CredentialsForm {
  algoliaAppId: string;
  algoliaSearchApiKey: string;
}

interface LLMProviderOption {
  id: string;
  name: string;
  type: LLMProviderType;
  defaultModel: string;
}

interface IndustryForm {
  id: string;
  name: string;
  icon: string;
  color: string;
  promptPrimary: string;
  promptSelect: string;
  promptSecondary: string;
  indices: IndexForm[];
  credentials: CredentialsForm;
  llmProviderId: string;  // '' = use app default
}

const EMPTY_CREDS: CredentialsForm = {
  algoliaAppId: '',
  algoliaSearchApiKey: '',
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function makeEventRow(partial?: Partial<EventRow>): EventRow {
  return {
    _key: uid(),
    eventType: 'click',
    eventSubtype: '',
    eventName: '',
    ...partial,
  };
}

function makeIndexForm(role: 'primary' | 'secondary' = 'secondary'): IndexForm {
  return {
    _key: uid(),
    id: '',
    label: '',
    indexName: '',
    role,
    events: [makeEventRow()],
  };
}

function industryToForm(ind: IndustryV2): IndustryForm {
  return {
    id: ind.id,
    name: ind.name,
    icon: ind.icon,
    color: ind.color,
    credentials: {
      algoliaAppId:        (ind.credentials?.algoliaAppId        ?? ''),
      algoliaSearchApiKey: (ind.credentials?.algoliaSearchApiKey ? '••set••' : ''),
    },
    promptPrimary: ind.claudePrompts.generatePrimaryQuery,
    promptSelect: ind.claudePrompts.selectBestResult,
    promptSecondary: ind.claudePrompts.generateSecondaryQueries,
    llmProviderId: ind.llmProviderId ?? '',
    indices: ind.indices.map((idx) => ({
      _key: uid(),
      id: idx.id,
      label: idx.label,
      indexName: idx.indexName,
      role: idx.role,
      events: idx.events.map((e) => ({
        _key: uid(),
        eventType: e.eventType,
        eventSubtype: e.eventSubtype ?? '',
        eventName: e.eventName,
      })),
    })),
  };
}

function formToIndustry(form: IndustryForm, existing?: IndustryV2): Omit<IndustryV2, 'isBuiltIn' | 'createdAt' | 'updatedAt'> {
  // Build credentials: only include fields that have a real (non-placeholder) value
  const creds: IndustryCredentials = {};
  const c = form.credentials;
  if (c.algoliaAppId.trim() && !c.algoliaAppId.includes('••'))
    creds.algoliaAppId = c.algoliaAppId.trim();
  if (c.algoliaSearchApiKey.trim() && !c.algoliaSearchApiKey.includes('••'))
    creds.algoliaSearchApiKey = c.algoliaSearchApiKey.trim();
  // Preserve existing encrypted credentials that weren't changed (placeholder still shown)
  const existingCreds = existing?.credentials ?? {};
  const mergedCreds: IndustryCredentials = { ...existingCreds };
  if ('algoliaAppId' in creds) mergedCreds.algoliaAppId = creds.algoliaAppId;
  // For sensitive: if user typed a real value, override; if blank, clear; if placeholder, keep existing
  if (c.algoliaSearchApiKey === '')       delete mergedCreds.algoliaSearchApiKey;
  else if (!c.algoliaSearchApiKey.includes('••')) mergedCreds.algoliaSearchApiKey = creds.algoliaSearchApiKey;

  return {
    id: form.id.trim().toLowerCase().replace(/\s+/g, '_'),
    name: form.name.trim(),
    icon: form.icon,
    color: form.color,
    credentials: Object.keys(mergedCreds).length > 0 ? mergedCreds : undefined,
    claudePrompts: {
      generatePrimaryQuery: form.promptPrimary.trim() || DEFAULT_PROMPTS.generatePrimaryQuery,
      selectBestResult: form.promptSelect.trim() || DEFAULT_PROMPTS.selectBestResult,
      generateSecondaryQueries: form.promptSecondary.trim() || DEFAULT_PROMPTS.generateSecondaryQueries,
    },
    ...(form.llmProviderId ? { llmProviderId: form.llmProviderId } : {}),
    indices: form.indices.map((idx) => ({
      id: idx.id.trim() || idx.label.trim().toLowerCase().replace(/\s+/g, '_') || uid(),
      label: idx.label.trim(),
      indexName: idx.indexName.trim(),
      role: idx.role,
      events: idx.events
        .filter((e) => e.eventName.trim())
        .map((e): IndexEvent => ({
          eventType: e.eventType,
          ...(e.eventSubtype ? { eventSubtype: e.eventSubtype as AlgoliaEventSubtype } : {}),
          eventName: e.eventName.trim(),
        })),
    })),
  };
}

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────

interface IndustryEditorProps {
  industryId?: string;    // undefined = create mode
  onSaved: (industry: IndustryV2) => void;
  onClose: () => void;
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function EventRowEditor({
  row,
  onChange,
  onRemove,
  canRemove,
}: {
  row: EventRow;
  onChange: (r: EventRow) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <select
        value={row.eventType}
        onChange={(e) => onChange({ ...row, eventType: e.target.value as AlgoliaEventType, eventSubtype: '' })}
        className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 w-28 focus:outline-none focus:border-blue-500"
      >
        {EVENT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      <select
        value={row.eventSubtype}
        onChange={(e) => onChange({ ...row, eventSubtype: e.target.value as AlgoliaEventSubtype | '' })}
        disabled={row.eventType !== 'conversion'}
        className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 w-28 disabled:opacity-40 focus:outline-none focus:border-blue-500"
      >
        {EVENT_SUBTYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      <input
        value={row.eventName}
        onChange={(e) => onChange({ ...row, eventName: e.target.value })}
        placeholder="Event name (e.g. PDP: Product Clicked)"
        className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />

      <button
        onClick={onRemove}
        disabled={!canRemove}
        className="p-1 text-gray-500 hover:text-rose-400 disabled:opacity-20 transition-colors"
        title="Remove event"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function IndexEditor({
  idx,
  position,
  onChange,
  onRemove,
  canRemove,
}: {
  idx: IndexForm;
  position: number;
  onChange: (i: IndexForm) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const updateEvent = (key: string, row: EventRow) => {
    onChange({ ...idx, events: idx.events.map((e) => (e._key === key ? row : e)) });
  };
  const removeEvent = (key: string) => {
    onChange({ ...idx, events: idx.events.filter((e) => e._key !== key) });
  };
  const addEvent = () => {
    onChange({ ...idx, events: [...idx.events, makeEventRow()] });
  };

  const isPrimary = idx.role === 'primary';

  return (
    <div className="border border-gray-700 rounded-lg bg-gray-800/60 overflow-hidden">
      {/* Index header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-750 border-b border-gray-700">
        <span className="text-xs font-bold text-gray-400 w-5">{position}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${isPrimary ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-700 text-gray-400'}`}>
          {isPrimary ? 'Primary' : 'Secondary'}
        </span>

        <select
          value={idx.role}
          onChange={(e) => onChange({ ...idx, role: e.target.value as 'primary' | 'secondary' })}
          className="bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
        >
          <option value="primary">primary</option>
          <option value="secondary">secondary</option>
        </select>

        <input
          value={idx.label}
          onChange={(e) => onChange({ ...idx, label: e.target.value })}
          placeholder="Label (e.g. Recipes)"
          className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />

        {canRemove && (
          <button
            onClick={onRemove}
            className="ml-auto p-1 text-gray-500 hover:text-rose-400 transition-colors"
            title="Remove index"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Index body */}
      <div className="p-3 space-y-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Algolia Index Name</label>
            <input
              value={idx.indexName}
              onChange={(e) => onChange({ ...idx, indexName: e.target.value })}
              placeholder="e.g. prod_RECIPES"
              className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
          <div className="w-36">
            <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Index ID (slug)</label>
            <input
              value={idx.id}
              onChange={(e) => onChange({ ...idx, id: e.target.value })}
              placeholder="auto from label"
              className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-400 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
        </div>

        {/* Events */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Events</label>
            <div className="flex gap-2 text-[9px] text-gray-600">
              <span className="w-28 text-center">type</span>
              <span className="w-28 text-center">subtype</span>
              <span className="flex-1">event name</span>
            </div>
          </div>

          <div className="space-y-0.5">
            {idx.events.map((evtRow) => (
              <EventRowEditor
                key={evtRow._key}
                row={evtRow}
                onChange={(r) => updateEvent(evtRow._key, r)}
                onRemove={() => removeEvent(evtRow._key)}
                canRemove={idx.events.length > 1}
              />
            ))}
          </div>

          <button
            onClick={addEvent}
            className="mt-2 flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Add event
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main editor
// ─────────────────────────────────────────────

const TYPE_ICONS: Record<LLMProviderType, string> = {
  anthropic: '🟠',
  openai: '🟢',
  ollama: '🦙',
};

export default function IndustryEditor({ industryId, onSaved, onClose }: IndustryEditorProps) {
  const isCreate = !industryId;

  const [showCredentials, setShowCredentials] = useState(false);
  const [showLLM, setShowLLM] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<LLMProviderOption[]>([]);
  const [appDefaultProviderId, setAppDefaultProviderId] = useState<string>('');

  const [form, setForm] = useState<IndustryForm>({
    id: '',
    name: '',
    icon: '🏭',
    color: 'blue',
    credentials: EMPTY_CREDS,
    promptPrimary: DEFAULT_PROMPTS.generatePrimaryQuery,
    promptSelect: DEFAULT_PROMPTS.selectBestResult,
    promptSecondary: DEFAULT_PROMPTS.generateSecondaryQueries,
    llmProviderId: '',
    indices: [
      {
        _key: uid(),
        id: 'primary',
        label: '',
        indexName: '',
        role: 'primary',
        events: [
          makeEventRow({ eventType: 'click' }),
          makeEventRow({ eventType: 'view' }),
          makeEventRow({ eventType: 'conversion' }),
        ],
      },
    ],
  });

  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompts, setShowPrompts] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);

  // Load available LLM providers from app config
  useEffect(() => {
    fetch('/api/app-config')
      .then((r) => r.json())
      .then((d: { appStatus?: { llmProviders?: LLMProviderOption[]; defaultLlmProviderId?: string } }) => {
        if (d.appStatus?.llmProviders) {
          setAvailableProviders(d.appStatus.llmProviders);
        }
        if (d.appStatus?.defaultLlmProviderId) {
          setAppDefaultProviderId(d.appStatus.defaultLlmProviderId);
        }
      })
      .catch(() => {/* non-critical */});
  }, []);

  // Load existing industry in edit mode
  useEffect(() => {
    if (!industryId) return;
    fetch(`/api/industries/${industryId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.industry) setForm(industryToForm(data.industry as IndustryV2));
        else setError(data.error ?? 'Failed to load industry');
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [industryId]);

  const addIndex = useCallback(() => {
    setForm((f) => ({
      ...f,
      indices: [...f.indices, makeIndexForm('secondary')],
    }));
  }, []);

  const updateIndex = useCallback((key: string, idx: IndexForm) => {
    setForm((f) => ({
      ...f,
      indices: f.indices.map((i) => (i._key === key ? idx : i)),
    }));
  }, []);

  const removeIndex = useCallback((key: string) => {
    setForm((f) => ({
      ...f,
      indices: f.indices.filter((i) => i._key !== key),
    }));
  }, []);

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Industry name is required';
    if (isCreate && !form.id.trim()) return 'Industry ID is required';
    if (form.indices.length === 0) return 'At least one index is required';
    if (!form.indices.some((i) => i.role === 'primary')) return 'At least one index must be Primary';
    for (const idx of form.indices) {
      if (!idx.indexName.trim()) return `Index "${idx.label || idx.id || 'unnamed'}" needs an Algolia index name`;
      if (!idx.label.trim()) return `An index is missing its label`;
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError(null);
    setSaving(true);

    try {
      const payload = formToIndustry(form);
      let res: Response;

      if (isCreate) {
        res = await fetch('/api/industries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/industries/${industryId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Save failed');
      } else {
        onSaved(data.industry as IndustryV2);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setSaving(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const activeColor = COLORS.find((c) => c.id === form.color) ?? COLORS[0];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/60 cursor-pointer"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="w-full max-w-2xl bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className={`px-5 py-4 border-b border-gray-700 flex items-center justify-between`}>
          <div>
            <h2 className="text-base font-semibold text-white">
              {isCreate ? 'Create Industry' : `Edit Industry`}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {isCreate
                ? 'Configure a new industry with custom indices and Algolia events'
                : 'Update indices, event names, and Claude prompts'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-500 text-sm">Loading…</div>
          ) : (
            <>
              {/* ── Basic Info ── */}
              <section className="space-y-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Basic Info</h3>

                <div className="grid grid-cols-2 gap-3">
                  {/* Name */}
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Industry Name <span className="text-rose-400">*</span></label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Financial Services"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* ID (create only) */}
                  {isCreate && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">ID (slug) <span className="text-rose-400">*</span></label>
                      <input
                        value={form.id}
                        onChange={(e) => setForm({ ...form, id: e.target.value })}
                        placeholder="e.g. finance"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                  )}

                </div>

                {/* Icon + Color */}
                <div className="flex items-start gap-4">
                  {/* Icon picker */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Icon</label>
                    <div className="relative">
                      <button
                        onClick={() => setShowIconPicker((v) => !v)}
                        className="w-14 h-10 bg-gray-800 border border-gray-700 rounded-lg flex items-center justify-center text-2xl hover:border-gray-500 transition-colors"
                      >
                        {form.icon}
                      </button>
                      {showIconPicker && (
                        <div className="absolute top-12 left-0 z-20 bg-gray-800 border border-gray-600 rounded-xl p-2 w-56 grid grid-cols-6 gap-1 shadow-2xl">
                          {ICONS.map((ic) => (
                            <button
                              key={ic}
                              onClick={() => { setForm({ ...form, icon: ic }); setShowIconPicker(false); }}
                              className={`text-xl p-1 rounded hover:bg-gray-700 transition-colors ${form.icon === ic ? 'bg-gray-700 ring-1 ring-blue-500' : ''}`}
                            >
                              {ic}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Color picker */}
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1">Color</label>
                    <div className="flex flex-wrap gap-2">
                      {COLORS.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setForm({ ...form, color: c.id })}
                          title={c.label}
                          className={`w-7 h-7 rounded-full ${c.bg} transition-all ${form.color === c.id ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900 scale-110' : 'opacity-70 hover:opacity-100'}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* ── Indices ── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                    Indices <span className="text-gray-600 font-normal normal-case tracking-normal">({form.indices.length})</span>
                  </h3>
                  <p className="text-[10px] text-gray-600">First primary index is searched first by Claude</p>
                </div>

                <div className="space-y-2">
                  {form.indices.map((idx, i) => (
                    <IndexEditor
                      key={idx._key}
                      idx={idx}
                      position={i + 1}
                      onChange={(updated) => updateIndex(idx._key, updated)}
                      onRemove={() => removeIndex(idx._key)}
                      canRemove={form.indices.length > 1}
                    />
                  ))}
                </div>

                <button
                  onClick={addIndex}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-gray-700 rounded-lg text-sm text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add another index
                </button>
              </section>

              {/* ── Claude Prompts (collapsible) ── */}
              <section>
                <button
                  onClick={() => setShowPrompts((v) => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-widest w-full"
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${showPrompts ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                  Claude Prompts
                  <span className="text-gray-600 font-normal normal-case tracking-normal">(advanced)</span>
                </button>

                {showPrompts && (
                  <div className="mt-3 space-y-3">
                    {[
                      { key: 'promptPrimary' as const, label: 'Generate primary search query' },
                      { key: 'promptSelect' as const, label: 'Select best result (JSON output)' },
                      { key: 'promptSecondary' as const, label: 'Generate secondary queries (JSON array)' },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <label className="block text-xs text-gray-500 mb-1">{label}</label>
                        <textarea
                          value={form[key]}
                          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                          rows={3}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none font-mono"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── LLM Configuration (collapsible) ── */}
              <section>
                <button
                  onClick={() => setShowLLM((v) => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-widest w-full"
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${showLLM ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                  LLM Configuration
                  {form.llmProviderId ? (
                    <span className="text-[10px] font-normal normal-case tracking-normal text-blue-400 ml-1">
                      (override set)
                    </span>
                  ) : (
                    <span className="text-gray-600 font-normal normal-case tracking-normal">(using app default)</span>
                  )}
                </button>

                {showLLM && (
                  <div className="mt-3 space-y-3">
                    <p className="text-[11px] text-gray-500 bg-gray-800 rounded-lg p-2.5">
                      Select a specific LLM provider and model for this industry. Leave on &ldquo;App Default&rdquo; to use whatever is configured globally in App Settings.
                    </p>

                    {/* Provider selector */}
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Provider</label>
                      {availableProviders.length === 0 ? (
                        <p className="text-[11px] text-gray-600 bg-gray-800 rounded-lg p-2.5">
                          No providers configured. Add providers in <span className="text-blue-400">App Settings → LLM Providers</span>.
                        </p>
                      ) : (
                        <select
                          value={form.llmProviderId}
                          onChange={(e) => setForm({ ...form, llmProviderId: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                        >
                          <option value="">
                            App Default{appDefaultProviderId
                              ? ` (${availableProviders.find((p) => p.id === appDefaultProviderId)?.name ?? appDefaultProviderId})`
                              : ' (not set)'}
                          </option>
                          {availableProviders.map((p) => (
                            <option key={p.id} value={p.id}>
                              {TYPE_ICONS[p.type]} {p.name} — {p.defaultModel}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Clear override shortcut */}
                    {form.llmProviderId && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, llmProviderId: '' })}
                        className="text-xs text-gray-600 hover:text-rose-400 transition-colors"
                      >
                        ✕ Reset to app default
                      </button>
                    )}
                  </div>
                )}
              </section>

              {/* ── Credential Overrides (collapsible) ── */}
              <section>
                <button
                  onClick={() => setShowCredentials((v) => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-widest w-full"
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${showCredentials ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                  Credential Overrides
                  <span className="text-gray-600 font-normal normal-case tracking-normal">(optional — overrides app-level settings)</span>
                </button>

                {showCredentials && (
                  <div className="mt-3 space-y-3">
                    <p className="text-[11px] text-gray-500 bg-gray-800 rounded-lg p-2.5">
                      Leave blank to use the global App Settings credentials. Enter a value to override for this industry only. Sensitive keys are encrypted before saving.
                    </p>

                    {([
                      { key: 'algoliaAppId' as const,        label: 'Algolia App ID',  secret: false, placeholder: 'e.g. ABCDE12345' },
                      { key: 'algoliaSearchApiKey' as const,  label: 'Search API Key', secret: true,  placeholder: 'Leave blank to use global' },
                    ]).map(({ key, label, secret, placeholder }) => {
                      const val = form.credentials[key];
                      const isPlaceholder = val.includes('••set••');
                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs text-gray-400">{label}</label>
                            {isPlaceholder && (
                              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">override set</span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <input
                              type={secret ? 'password' : 'text'}
                              value={isPlaceholder ? '' : val}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  credentials: { ...form.credentials, [key]: e.target.value },
                                })
                              }
                              placeholder={isPlaceholder ? '••••••  (set — enter new value to change, or clear to remove)' : placeholder}
                              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                            />
                            {isPlaceholder && (
                              <button
                                type="button"
                                onClick={() =>
                                  setForm({
                                    ...form,
                                    credentials: { ...form.credentials, [key]: '' },
                                  })
                                }
                                className="px-2 py-1 text-xs bg-red-900/40 hover:bg-red-900/60 text-red-400 rounded-lg transition-colors"
                                title="Remove override"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-700 bg-gray-900 flex items-center gap-3">
          {error && (
            <p className="flex-1 text-xs text-rose-400 bg-rose-900/20 px-3 py-2 rounded-lg border border-rose-800/50 min-w-0 truncate">
              {error}
            </p>
          )}
          {!error && <div className="flex-1" />}

          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${saving ? 'opacity-60 cursor-not-allowed' : ''} ${activeColor.bg} text-white hover:opacity-90`}
          >
            {saving ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Saving…
              </>
            ) : (
              isCreate ? 'Create Industry' : 'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
