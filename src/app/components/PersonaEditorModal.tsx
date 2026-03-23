'use client';

import { useEffect, useState } from 'react';
import type { Persona } from '@/types';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface PersonaEditorModalProps {
  persona: Persona;
  industryId: string;
  onSaved: (updated: Persona) => void;
  onDeleted: (personaId: string) => void;
  onClose: () => void;
}

// Extra dynamic field stored as a key/value row in the UI
interface ExtraField {
  key: string;
  value: string;
}

// Known standard fields rendered individually
const STANDARD_KEYS = new Set([
  'id', 'name', 'userToken', 'description', 'industry',
  'skill', 'budget', 'tags',
  'cookingSkill', 'dietaryPreferences', 'favoriteCuisines',
  'avoids', 'householdSize', 'timeConstraint', 'shoppingFrequency',
]);

const SKILL_OPTIONS = ['', 'beginner', 'intermediate', 'advanced'];
const BUDGET_OPTIONS = ['', 'low', 'medium', 'high'];

function personaToExtra(p: Persona): ExtraField[] {
  return Object.entries(p)
    .filter(([k, v]) => !STANDARD_KEYS.has(k) && typeof v !== 'object')
    .map(([k, v]) => ({ key: k, value: String(v) }));
}

function tagsFromString(s: string): string[] {
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────

export default function PersonaEditorModal({
  persona,
  industryId,
  onSaved,
  onDeleted,
  onClose,
}: PersonaEditorModalProps) {
  // ── form state ──
  const [name, setName] = useState(persona.name ?? '');
  const [description, setDescription] = useState(persona.description ?? '');
  const [skill, setSkill] = useState<string>(
    (persona.skill as string) ?? (persona.cookingSkill as string) ?? ''
  );
  const [budget, setBudget] = useState<string>((persona.budget as string) ?? '');
  const [tagsRaw, setTagsRaw] = useState(
    ((persona.tags ?? persona.dietaryPreferences) as string[] | undefined)?.join(', ') ?? ''
  );
  const [extra, setExtra] = useState<ExtraField[]>(personaToExtra(persona));

  // ── ui state ──
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving && !deleting) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saving, deleting, onClose]);

  // ── extra field helpers ──
  const addExtra = () => setExtra((prev) => [...prev, { key: '', value: '' }]);
  const removeExtra = (i: number) => setExtra((prev) => prev.filter((_, j) => j !== i));
  const updateExtra = (i: number, field: 'key' | 'value', val: string) =>
    setExtra((prev) => prev.map((f, j) => (j === i ? { ...f, [field]: val } : f)));

  // ── save ──
  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const extraObj: Record<string, string> = {};
      for (const { key, value } of extra) {
        if (key.trim() && !STANDARD_KEYS.has(key.trim())) {
          extraObj[key.trim()] = value;
        }
      }

      const updated: Persona = {
        ...persona,
        name: name.trim(),
        description: description.trim(),
        ...(skill ? { skill: skill as Persona['skill'], cookingSkill: skill as Persona['cookingSkill'] } : {}),
        ...(budget ? { budget: budget as Persona['budget'] } : {}),
        tags: tagsFromString(tagsRaw),
        dietaryPreferences: tagsFromString(tagsRaw),
        ...extraObj,
      };

      const res = await fetch(`/api/industries/${industryId}/personas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // ── delete ──
  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/industries/${industryId}/personas?personaId=${encodeURIComponent(persona.id)}`,
        { method: 'DELETE' }
      );
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      onDeleted(persona.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const busy = saving || deleting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={!busy ? onClose : undefined}
      />

      {/* Panel */}
      <div className="relative z-10 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-700 flex items-start justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Edit Persona</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">{persona.id}</p>
          </div>
          {!busy && (
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none mt-0.5">×</button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Name <span className="text-rose-400">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
              placeholder="Persona name"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none"
              placeholder="Brief persona description"
            />
          </div>

          {/* Skill + Budget */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Skill</label>
              <select
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              >
                {SKILL_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o || '— none —'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Budget</label>
              <select
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              >
                {BUDGET_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o || '— none —'}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Tags
              <span className="ml-1 text-slate-500 font-normal">(comma-separated)</span>
            </label>
            <input
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
              placeholder="e.g. outdoor, hiking, budget-conscious"
            />
          </div>

          {/* Extra fields */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-300">
                Extra Fields
                <span className="ml-1 text-slate-500 font-normal">(custom attributes)</span>
              </label>
              <button
                type="button"
                onClick={addExtra}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                + Add field
              </button>
            </div>
            {extra.length === 0 && (
              <p className="text-xs text-slate-600 italic">No extra fields.</p>
            )}
            <div className="space-y-2">
              {extra.map((f, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    value={f.key}
                    onChange={(e) => updateExtra(i, 'key', e.target.value)}
                    placeholder="field name"
                    className="w-2/5 bg-slate-800 border border-slate-600 text-slate-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono placeholder-slate-600"
                  />
                  <input
                    value={f.value}
                    onChange={(e) => updateExtra(i, 'value', e.target.value)}
                    placeholder="value"
                    className="flex-1 bg-slate-800 border border-slate-600 text-slate-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() => removeExtra(i)}
                    className="text-slate-500 hover:text-red-400 transition-colors text-base leading-none shrink-0"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* User token (read-only) */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">User Token</label>
            <input
              readOnly
              value={persona.userToken}
              className="w-full bg-slate-800/50 border border-slate-700 text-slate-600 text-xs rounded-lg px-3 py-2 font-mono cursor-not-allowed"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700 flex items-center justify-between shrink-0 gap-3">
          {/* Delete zone */}
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Delete this persona?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors"
            >
              Delete persona
            </button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={busy}
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
                'Save Changes'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
