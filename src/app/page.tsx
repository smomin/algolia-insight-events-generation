'use client';

import { useState, useCallback, useEffect } from 'react';
import AppConfigPanel from './components/AppConfigPanel';
import AgentDashboard from './components/AgentDashboard';
import AgentEditor from './components/AgentEditor';
import type { AgentConfig, Persona } from '@/types';

// Agent as returned by /api/agent-configs (includes personaCount + full personas array)
interface AgentListItem extends AgentConfig {
  personaCount: number;
  personas: Persona[];
}

interface AlgoliaAppStatus {
  id: string;
  name: string;
  appId: string;
  hasSearchApiKey: boolean;
}

interface LLMProviderStatus {
  id: string;
  name: string;
  type: string;
  hasApiKey: boolean;
  defaultModel: string;
}

interface CredentialStatus {
  algoliaAppId:        { value: string;  source: 'db' | 'env' | 'none' };
  algoliaSearchApiKey: { isSet: boolean; source: 'db' | 'env' | 'none' };
}

interface AppStatus {
  credentials?: CredentialStatus;
  algoliaApps: AlgoliaAppStatus[];
  defaultAlgoliaAppId?: string;
  llmProviders: LLMProviderStatus[];
  defaultLlmProviderId?: string;
}

export default function Home() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);

  // Editor state: undefined = closed, null = create mode, string = edit agentId
  const [editorTarget, setEditorTarget] = useState<string | null | undefined>(undefined);
  const [appConfigOpen, setAppConfigOpen] = useState(false);

  // Delete confirmation modal state
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Load agent list ──
  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-configs');
      if (!res.ok) return;
      const data = await res.json();
      const list: AgentListItem[] = data.agents ?? data.sites ?? [];
      setAgents(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // ── Load app config status ──
  useEffect(() => {
    fetch('/api/app-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.appStatus) setAppStatus(data.appStatus);
      })
      .catch(() => {});
  }, []);

  const handleDeleteAgent = (id: string) => {
    const agent = agents.find((a) => a.id === id);
    setPendingDelete({ id, name: agent?.name ?? id });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await fetch(`/api/agent-configs/${pendingDelete.id}`, { method: 'DELETE' });
      await loadAgents();
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  };

  const eventLimit = parseInt(process.env.NEXT_PUBLIC_DAILY_EVENT_LIMIT ?? '1000', 10);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* ── Header ── */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/icon.svg" alt="Algolia" className="w-8 h-8 rounded-lg" />
            <div>
              <h1 className="text-lg font-bold text-white leading-none">Algolia Insights Generator</h1>
              <p className="text-xs text-slate-400 mt-0.5">Autonomous agent event simulation</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Settings gear */}
            <button
              onClick={() => setAppConfigOpen(true)}
              title="App Settings"
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">
        <AgentDashboard
          sites={agents}
          eventLimit={eventLimit}
          appStatus={appStatus}
          onOpenSettings={() => setAppConfigOpen(true)}
          onCreateSite={() => setEditorTarget(null)}
          onEditSite={(agentId) => setEditorTarget(agentId)}
          onDeleteSite={handleDeleteAgent}
        />
      </main>

      {/* ── App Config Panel ── */}
      {appConfigOpen && (
        <AppConfigPanel
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          initialStatus={(appStatus ?? undefined) as any}
          onClose={() => {
            setAppConfigOpen(false);
            fetch('/api/app-config')
              .then((r) => (r.ok ? r.json() : null))
              .then((data) => { if (data?.appStatus) setAppStatus(data.appStatus); })
              .catch(() => {});
          }}
        />
      )}

      {/* ── Agent Editor (create / edit) ── */}
      {editorTarget !== undefined && (
        <AgentEditor
          agentId={editorTarget ?? undefined}
          initialAgent={editorTarget ? agents.find((a) => a.id === editorTarget) : undefined}
          appConfig={appStatus ? {
            llmProviders: appStatus.llmProviders,
            defaultLlmProviderId: appStatus.defaultLlmProviderId,
            algoliaApps: appStatus.algoliaApps,
            defaultAlgoliaAppId: appStatus.defaultAlgoliaAppId,
          } : undefined}
          onSaved={async () => {
            setEditorTarget(undefined);
            await loadAgents();
          }}
          onClose={() => setEditorTarget(undefined)}
        />
      )}

      {/* ── Delete Confirmation Modal ── */}
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
                <h3 className="text-sm font-semibold text-white">Delete Agent</h3>
                <p className="text-xs text-slate-400 mt-0.5">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-slate-300">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-white">{pendingDelete.name}</span>?
              All associated personas and session data will be permanently removed.
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
                {isDeleting ? 'Deleting…' : 'Delete Agent'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <footer className="border-t border-slate-800 mt-10 py-4">
        <div className="max-w-screen-2xl mx-auto px-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>Algolia Insights Agent Dashboard</span>
          <span>
            {agents.length} agents ·{' '}
            {agents.reduce((s, a) => s + a.personaCount, 0)} total personas
          </span>
        </div>
      </footer>
    </div>
  );
}
