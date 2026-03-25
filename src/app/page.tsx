'use client';

import { useState, useCallback, useEffect } from 'react';
import AppConfigPanel from './components/AppConfigPanel';
import AgentDashboard from './components/AgentDashboard';
import SiteEditor from './components/SiteEditor';
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
  const [sites, setSites] = useState<AgentListItem[]>([]);
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);

  // Editor state: undefined = closed, null = create mode, string = edit agentId
  const [editorTarget, setEditorTarget] = useState<string | null | undefined>(undefined);
  const [appConfigOpen, setAppConfigOpen] = useState(false);

  // ── Load agent list ──
  const loadSites = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-configs');
      if (!res.ok) return;
      const data = await res.json();
      const list: AgentListItem[] = data.agents ?? data.sites ?? [];
      setSites(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { loadSites(); }, [loadSites]);

  // ── Load app config status ──
  useEffect(() => {
    fetch('/api/app-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.appStatus) setAppStatus(data.appStatus);
      })
      .catch(() => {});
  }, []);

  const handleDeleteSite = async (id: string) => {
    if (!confirm(`Delete agent "${id}"? This cannot be undone.`)) return;
    await fetch(`/api/agent-configs/${id}`, { method: 'DELETE' });
    await loadSites();
  };

  const eventLimit = parseInt(process.env.NEXT_PUBLIC_DAILY_EVENT_LIMIT ?? '1000', 10);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* ── Header ── */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                <path
                  strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  stroke="white"
                />
              </svg>
            </div>
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
          sites={sites}
          eventLimit={eventLimit}
          appStatus={appStatus}
          onOpenSettings={() => setAppConfigOpen(true)}
          onCreateSite={() => setEditorTarget(null)}
          onEditSite={(siteId) => setEditorTarget(siteId)}
          onDeleteSite={handleDeleteSite}
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

      {/* ── Site Editor (create / edit) ── */}
      {editorTarget !== undefined && (
        <SiteEditor
          siteId={editorTarget ?? undefined}
          initialSite={editorTarget ? sites.find((s) => s.id === editorTarget) : undefined}
          appConfig={appStatus ? {
            llmProviders: appStatus.llmProviders,
            defaultLlmProviderId: appStatus.defaultLlmProviderId,
            algoliaApps: appStatus.algoliaApps,
            defaultAlgoliaAppId: appStatus.defaultAlgoliaAppId,
          } : undefined}
          onSaved={async () => {
            setEditorTarget(undefined);
            await loadSites();
          }}
          onClose={() => setEditorTarget(undefined)}
        />
      )}

      {/* ── Footer ── */}
      <footer className="border-t border-slate-800 mt-10 py-4">
        <div className="max-w-screen-2xl mx-auto px-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>Algolia Insights Event Generator</span>
          <span>
            {sites.length} agents ·{' '}
            {sites.reduce((s, i) => s + i.personaCount, 0)} total personas
          </span>
        </div>
      </footer>
    </div>
  );
}
