'use client';

import { useState } from 'react';
import type { Persona } from '@/types';
import GeneratePersonasModal from './GeneratePersonasModal';
import PersonaEditorModal from './PersonaEditorModal';

interface PersonaSelectorProps {
  personas: Persona[];
  siteId: string;
  siteName?: string;
  onSessionComplete?: (result: {
    personaId: string;
    totalEvents?: number;
    error?: string;
  }) => void;
  onPersonasGenerated?: (newPersonas: Persona[]) => void;
  onPersonaUpdated?: (updated: Persona) => void;
  onPersonaDeleted?: (personaId: string) => void;
}

const SKILL_COLOR: Record<string, string> = {
  beginner: 'bg-emerald-500/20 text-emerald-400',
  intermediate: 'bg-yellow-500/20 text-yellow-400',
  advanced: 'bg-purple-500/20 text-purple-400',
};

const BUDGET_COLOR: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-400',
  medium: 'bg-blue-500/20 text-blue-400',
  high: 'bg-amber-500/20 text-amber-400',
};

const PAGE_SIZE = 20;

function getSkill(p: Persona): string {
  return (p.skill as string) ?? (p.cookingSkill as string) ?? 'intermediate';
}

function getBudget(p: Persona): string {
  return (p.budget as string) ?? 'medium';
}

function getTags(p: Persona): string[] {
  return (
    (p.tags as string[]) ??
    (p.dietaryPreferences as string[]) ??
    []
  );
}

function getDetails(p: Persona): string {
  // Grocery-specific details
  if (p.householdSize !== undefined && p.timeConstraint) {
    return `HH: ${p.householdSize as number} · ${p.timeConstraint as string}`;
  }
  // Generic: show first extra attribute pair if available
  const excludeKeys = new Set([
    'id', 'name', 'userToken', 'description', 'site',
    'skill', 'budget', 'tags', 'cookingSkill', 'dietaryPreferences',
    'favoriteCuisines', 'avoids', 'householdSize', 'timeConstraint', 'shoppingFrequency',
  ]);
  const entries = Object.entries(p).filter(
    ([k, v]) => !excludeKeys.has(k) && typeof v === 'string'
  );
  if (entries.length > 0) return `${entries[0][1] as string}`;
  return '';
}

function PersonaCard({
  persona,
  onRun,
  onEdit,
  onDelete,
  running,
}: {
  persona: Persona;
  onRun: (id: string) => void;
  onEdit: (p: Persona) => void;
  onDelete: (p: Persona) => void;
  running: boolean;
}) {
  const skill = getSkill(persona);
  const budget = getBudget(persona);
  const tags = getTags(persona);
  const details = getDetails(persona);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col gap-3 hover:border-slate-500 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="font-semibold text-white text-sm leading-tight truncate">
              {persona.name}
            </h3>
            <button
              onClick={() => onEdit(persona)}
              className="shrink-0 text-slate-600 hover:text-slate-300 transition-colors"
              title="Edit persona"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={() => onDelete(persona)}
              className="shrink-0 text-slate-600 hover:text-rose-400 transition-colors"
              title="Delete persona"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{persona.id}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${SKILL_COLOR[skill] ?? SKILL_COLOR.intermediate}`}
          >
            {skill}
          </span>
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${BUDGET_COLOR[budget] ?? BUDGET_COLOR.medium}`}
          >
            {budget}
          </span>
        </div>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
        {persona.description}
      </p>

      <div className="flex flex-wrap gap-1">
        {tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded"
          >
            {tag}
          </span>
        ))}
        {tags.length > 3 && (
          <span className="text-[10px] text-slate-500 px-1.5 py-0.5">
            +{tags.length - 3}
          </span>
        )}
      </div>

      {details && (
        <div className="text-xs text-slate-500 truncate">{details}</div>
      )}

      <button
        onClick={() => onRun(persona.id)}
        disabled={running}
        className="mt-auto w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
      >
        {running ? 'Running…' : 'Run Session'}
      </button>
    </div>
  );
}

export default function PersonaSelector({
  personas,
  siteId,
  siteName = 'Site',
  onSessionComplete,
  onPersonasGenerated,
  onPersonaUpdated,
  onPersonaDeleted,
}: PersonaSelectorProps) {
  const [page, setPage] = useState(0);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Persona | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const filtered = search
    ? personas.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.id.toLowerCase().includes(search.toLowerCase()) ||
          getTags(p).some((t) =>
            t.toLowerCase().includes(search.toLowerCase())
          )
      )
    : personas;

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, totalPages - 1));
  const displayed = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await fetch(
        `/api/agent-configs/${siteId}/personas?personaId=${encodeURIComponent(pendingDelete.id)}`,
        { method: 'DELETE' }
      );
      onPersonaDeleted?.(pendingDelete.id);
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  };

  const handleRun = async (personaId: string) => {
    setRunningId(personaId);
    try {
      const res = await fetch('/api/run-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId, siteId }),
      });
      // Safely parse — server may return HTML on a crash
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(text); } catch { /* non-JSON body */ }

      const errorMsg: string | undefined =
        (data.error as string | undefined) ??
        (!res.ok ? `HTTP ${res.status}${data ? '' : ` — ${text.slice(0, 120)}`}` : undefined);

      onSessionComplete?.({
        personaId,
        totalEvents: (data.totalEvents as number | undefined) ?? 0,
        error: errorMsg,
      });
    } catch (err) {
      onSessionComplete?.({
        personaId,
        totalEvents: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunningId(null);
    }
  };

  return (
    <>
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
      {/* Combined header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 min-w-0"
        >
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm font-semibold text-white">Personas</span>
          <span className="text-[10px] bg-slate-700 text-slate-400 border border-slate-600 px-1.5 py-0.5 rounded-full shrink-0">
            {filtered.length}{filtered.length !== personas.length ? ` of ${personas.length}` : ''}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {!collapsed && (
            <>
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder="Search personas…"
                className="bg-slate-700 border border-slate-600 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 w-44"
              />
              <button
                onClick={() => setGenerateModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                <span>✨</span>
                Generate
              </button>
            </>
          )}
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="border-t border-slate-700 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {displayed.map((persona) => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                onRun={handleRun}
                onEdit={setEditingPersona}
                onDelete={setPendingDelete}
                running={runningId === persona.id}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-5">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                ← Prev
              </button>
              <span className="text-sm text-slate-400">
                Page {currentPage + 1} / {totalPages}
                <span className="text-slate-600 ml-2">({displayed.length} shown)</span>
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>

    {generateModalOpen && (
      <GeneratePersonasModal
        siteId={siteId}
        siteName={siteName}
        onComplete={(newPersonas) => {
          onPersonasGenerated?.(newPersonas);
          setGenerateModalOpen(false);
        }}
        onClose={() => setGenerateModalOpen(false)}
      />
    )}

    {editingPersona && (
      <PersonaEditorModal
        persona={editingPersona}
        siteId={siteId}
        onSaved={(updated) => {
          onPersonaUpdated?.(updated);
          setEditingPersona(null);
        }}
        onDeleted={(id) => {
          onPersonaDeleted?.(id);
          setEditingPersona(null);
        }}
        onClose={() => setEditingPersona(null)}
      />
    )}

    {pendingDelete && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-sm shadow-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-rose-900/40 border border-rose-800/50 rounded-xl flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Delete Persona</h3>
              <p className="text-xs text-slate-400 mt-0.5">This action cannot be undone.</p>
            </div>
          </div>
          <p className="text-sm text-slate-300">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-white">{pendingDelete.name}</span>?
            All session data associated with this persona will be permanently removed.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setPendingDelete(null)}
              disabled={isDeleting}
              className="px-3 py-1.5 text-sm text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={isDeleting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-rose-700 hover:bg-rose-600 border border-rose-600 rounded-lg transition-colors disabled:opacity-50"
            >
              {isDeleting && (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {isDeleting ? 'Deleting…' : 'Delete Persona'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
