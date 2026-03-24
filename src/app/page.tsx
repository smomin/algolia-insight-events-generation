'use client';

import { useState, useCallback, useEffect } from 'react';
import DailyCounter from './components/DailyCounter';
import SchedulerControls from './components/SchedulerControls';
import PersonaSelector from './components/PersonaSelector';
import EventLog from './components/EventLog';
import SessionCard from './components/SessionCard';
import SessionHistory from './components/SessionHistory';
import IndustrySwitcher, {
  type IndustrySummary,
  type RunningStatus,
} from './components/IndustrySwitcher';
import IndustryEditor from './components/IndustryEditor';
import AppConfigPanel from './components/AppConfigPanel';
import AgentDashboard from './components/AgentDashboard';
import { useSSE } from './hooks/useSSE';
import type { Persona, IndustryV2 } from '@/types';

type MainView = 'industries' | 'agents';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface SessionNotification {
  personaId: string;
  personaName?: string;
  totalEvents: number;
  industryId?: string;
  error?: string;
  timestamp: number;
}

// Industry as returned by /api/industries (includes personaCount)
interface IndustryListItem extends IndustryV2 {
  personaCount: number;
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

interface AppStatus {
  algoliaApps: AlgoliaAppStatus[];
  defaultAlgoliaAppId?: string;
  llmProviders: LLMProviderStatus[];
  defaultLlmProviderId?: string;
}

// ─────────────────────────────────────────────
// Color helpers (covers all palette options)
// ─────────────────────────────────────────────

const ACCENT: Record<string, string> = {
  blue: 'text-blue-400',     emerald: 'text-emerald-400', rose: 'text-rose-400',
  amber: 'text-amber-400',   violet: 'text-violet-400',   cyan: 'text-cyan-400',
  orange: 'text-orange-400', pink: 'text-pink-400',       teal: 'text-teal-400',
  indigo: 'text-indigo-400', lime: 'text-lime-400',       red: 'text-red-400',
};

const DOT: Record<string, string> = {
  blue: 'bg-blue-500',     emerald: 'bg-emerald-500', rose: 'bg-rose-500',
  amber: 'bg-amber-500',   violet: 'bg-violet-500',   cyan: 'bg-cyan-500',
  orange: 'bg-orange-500', pink: 'bg-pink-500',       teal: 'bg-teal-500',
  indigo: 'bg-indigo-500', lime: 'bg-lime-500',       red: 'bg-red-500',
};

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────

export default function Home() {
  const [mainView, setMainView] = useState<MainView>('industries');
  const [industries, setIndustries] = useState<IndustryListItem[]>([]);
  const [personasByIndustry, setPersonasByIndustry] = useState<Record<string, Persona[]>>({});
  const [activeIndustry, setActiveIndustry] = useState<string>(
    process.env.NEXT_PUBLIC_DEFAULT_INDUSTRY_ID ?? 'grocery'
  );
  const [latestSession, setLatestSession] = useState<SessionNotification | null>(null);
  const [runningStatus, setRunningStatus] = useState<RunningStatus>({});
  const [runningAllIndustries, setRunningAllIndustries] = useState(false);
  const [distributingIndustries, setDistributingIndustries] = useState<Record<string, boolean>>({});

  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);

  // Editor state: undefined = closed, null = create mode, string = edit industryId
  const [editorTarget, setEditorTarget] = useState<string | null | undefined>(undefined);
  const [appConfigOpen, setAppConfigOpen] = useState(false);

  // ── Load industry list ──
  const loadIndustries = useCallback(async () => {
    try {
      const res = await fetch('/api/industries');
      if (!res.ok) return;
      const data = await res.json();
      const list: IndustryListItem[] = data.industries ?? [];
      setIndustries(list);
      if (list.length > 0 && !list.find((i) => i.id === activeIndustry)) {
        setActiveIndustry(list[0].id);
      }
    } catch {
      // ignore
    }
  }, [activeIndustry]);

  useEffect(() => { loadIndustries(); }, [loadIndustries]);

  // ── Load app config status (for Algolia app + LLM resolution) ──
  useEffect(() => {
    fetch('/api/app-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.appStatus) setAppStatus(data.appStatus);
      })
      .catch(() => {});
  }, []);

  // ── Load personas for active industry ──
  useEffect(() => {
    if (!activeIndustry || activeIndustry in personasByIndustry) return;
    fetch(`/api/industries/${activeIndustry}/personas`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // Always set the key (even to []) so PersonaSelector renders with its generate button
        setPersonasByIndustry((prev) => ({
          ...prev,
          [activeIndustry]: data?.personas ?? [],
        }));
      })
      .catch(() => {
        setPersonasByIndustry((prev) => ({ ...prev, [activeIndustry]: [] }));
      });
  }, [activeIndustry, personasByIndustry]);

  // ── Global SSE stream — header running-dots for all industries ───────
  // Receives { all: Record<id, {isRunning, isDistributing}> } on connect,
  // then { industryId, isRunning, isDistributing } on each status change.
  useSSE('/api/stream?industryId=_global&types=status', ['status'], (_, rawData) => {
    const data = rawData as {
      all?: Record<string, { isRunning: boolean; isDistributing: boolean }>;
      industryId?: string;
      isRunning?: boolean;
      isDistributing?: boolean;
    };
    if (data.all) {
      setRunningStatus(data.all);
    } else if (data.industryId) {
      setRunningStatus((prev) => ({
        ...prev,
        [data.industryId!]: {
          isRunning: data.isRunning ?? false,
          isDistributing: data.isDistributing ?? false,
        },
      }));
    }
  });

  // ── Callbacks ──
  const handleSessionComplete = useCallback(
    (result: { personaId: string; totalEvents?: number; error?: string }) => {
      const personas = personasByIndustry[activeIndustry] ?? [];
      const persona = personas.find((p) => p.id === result.personaId);
      setLatestSession({
        ...result,
        totalEvents: result.totalEvents ?? 0,
        personaName: persona?.name,
        industryId: activeIndustry,
        timestamp: Date.now(),
      });
    },
    [activeIndustry, personasByIndustry]
  );

  const handleRunAllIndustries = async () => {
    setRunningAllIndustries(true);
    try {
      await fetch('/api/run-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // SSE global stream will push status updates for each industry as they start
    } finally {
      setRunningAllIndustries(false);
    }
  };

  const handleStartAllSchedulers = async () => {
    await fetch('/api/scheduler/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startAll: true }),
    });
    // SSE will push the scheduler started status for each industry
  };

  const handleDeleteIndustry = async (id: string) => {
    if (!confirm(`Delete industry "${id}"? This cannot be undone.`)) return;
    await fetch(`/api/industries/${id}`, { method: 'DELETE' });
    await loadIndustries();
    if (activeIndustry === id && industries.length > 1) {
      const next = industries.find((i) => i.id !== id);
      if (next) setActiveIndustry(next.id);
    }
  };

  // ── Derived ──
  const activeIndustryMeta = industries.find((i) => i.id === activeIndustry);
  const activePersonas = personasByIndustry[activeIndustry] ?? [];
  const anyRunning = Object.values(runningStatus).some((s) => s.isRunning || s.isDistributing);
  const runningCount = Object.values(runningStatus).filter((s) => s.isRunning || s.isDistributing).length;

  const resolvedAlgoliaApp = activeIndustryMeta && appStatus
    ? appStatus.algoliaApps.find(
        (a) => a.id === (activeIndustryMeta.algoliaAppConfigId ?? appStatus.defaultAlgoliaAppId)
      ) ?? null
    : null;

  const resolvedLLM = activeIndustryMeta && appStatus
    ? appStatus.llmProviders.find(
        (p) => p.id === (activeIndustryMeta.llmProviderId ?? appStatus.defaultLlmProviderId)
      ) ?? null
    : null;

  const industrySummaries: IndustrySummary[] = industries.map((i) => ({
    id: i.id,
    name: i.name,
    icon: i.icon,
    color: i.color,
    personaCount: i.personaCount,
  }));

  const eventLimit = parseInt(process.env.NEXT_PUBLIC_DAILY_EVENT_LIMIT ?? '1000', 10);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* ── Header ── */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                <path
                  d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-none">Algolia Insights Generator</h1>
              <p className="text-xs text-slate-400 mt-0.5">Multi-industry event simulation</p>
            </div>
          </div>

          {/* Global industry status dots */}
          <div className="hidden md:flex items-center gap-3">
            {industries.map((ind) => {
              const status = runningStatus[ind.id];
              const active = status?.isRunning || status?.isDistributing;
              return (
                <button
                  key={ind.id}
                  onClick={() => setActiveIndustry(ind.id)}
                  title={`${ind.name}${active ? ' — active' : ''}`}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <span className={`w-2 h-2 rounded-full transition-colors ${
                    active
                      ? `${DOT[ind.color] ?? 'bg-blue-500'} shadow-[0_0_6px_2px] shadow-current animate-pulse`
                      : 'bg-slate-600'
                  }`} />
                  <span className={active ? (ACCENT[ind.color] ?? 'text-blue-400') : ''}>{ind.icon}</span>
                </button>
              );
            })}
          </div>

          {/* Global action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {anyRunning && mainView === 'industries' && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {runningCount} running
              </span>
            )}

            {/* View toggle */}
            <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5">
              <button
                onClick={() => setMainView('industries')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mainView === 'industries'
                    ? 'bg-slate-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Industries
              </button>
              <button
                onClick={() => setMainView('agents')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                  mainView === 'agents'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Agents
              </button>
            </div>

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
            {mainView === 'industries' && (
              <>
                <button
                  onClick={() => setEditorTarget(null)}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg font-medium transition-colors border border-slate-600 flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  New Industry
                </button>
                <button
                  onClick={handleStartAllSchedulers}
                  className="hidden sm:block text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                >
                  Schedule All
                </button>
                <button
                  onClick={handleRunAllIndustries}
                  disabled={runningAllIndustries}
                  className="text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap"
                >
                  {runningAllIndustries ? 'Triggering…' : '⚡ Run All'}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">
        {/* ── Agent dashboard view ── */}
        {mainView === 'agents' && (
          <AgentDashboard
            industries={industries}
            eventLimit={eventLimit}
          />
        )}

        {/* ── Industry tab switcher (only in industries view) ── */}
        {mainView === 'industries' && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-3">
          {industrySummaries.length > 0 ? (
            <IndustrySwitcher
              industries={industrySummaries}
              activeIndustry={activeIndustry}
              runningStatus={runningStatus}
              onSwitch={setActiveIndustry}
            />
          ) : (
            <div className="text-slate-500 text-sm px-2">Loading industries…</div>
          )}
        </div>
        )}

        {mainView === 'industries' && activeIndustryMeta && (
          <>
            {/* ── Industry name banner ── */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{activeIndustryMeta.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className={`text-xl font-bold ${ACCENT[activeIndustryMeta.color] ?? 'text-white'}`}>
                      {activeIndustryMeta.name}
                    </h2>
                    {activeIndustryMeta.isBuiltIn && (
                      <span className="text-[10px] text-slate-600 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded-full">built-in</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {activePersonas.length} personas ·{' '}
                    {activeIndustryMeta.indices.length} {activeIndustryMeta.indices.length === 1 ? 'index' : 'indices'} ·{' '}
                    {activeIndustryMeta.indices.reduce((s, i) => s + i.events.length, 0)} events/session
                  </p>
                  {(resolvedAlgoliaApp || resolvedLLM) && (
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {resolvedAlgoliaApp && (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                          <svg className="w-2.5 h-2.5 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
                          </svg>
                          <span className="text-blue-300 font-medium">{resolvedAlgoliaApp.name}</span>
                          <span className="text-slate-600">·</span>
                          <span className="font-mono text-slate-500">{resolvedAlgoliaApp.appId}</span>
                          {activeIndustryMeta.algoliaAppConfigId && (
                            <span className="ml-0.5 text-blue-400/70 italic">override</span>
                          )}
                        </span>
                      )}
                      {resolvedLLM && (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                          <svg className="w-2.5 h-2.5 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                          </svg>
                          <span className="text-violet-300 font-medium">{resolvedLLM.name}</span>
                          <span className="text-slate-600">·</span>
                          <span className="font-mono text-slate-500">{resolvedLLM.defaultModel}</span>
                          {activeIndustryMeta.llmProviderId && (
                            <span className="ml-0.5 text-violet-400/70 italic">override</span>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditorTarget(activeIndustry)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 rounded-lg transition-colors"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400">
                    <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                    <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
                  </svg>
                  Edit Industry
                </button>
                {!activeIndustryMeta.isBuiltIn && (
                  <button
                    onClick={() => handleDeleteIndustry(activeIndustry)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-rose-400 hover:text-rose-300 bg-slate-800 hover:bg-rose-900/20 border border-slate-700 hover:border-rose-800 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* ── Index summary chips ── */}
            <div className="flex flex-wrap gap-2">
              {activeIndustryMeta.indices.map((idx) => (
                <div key={idx.id} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${idx.role === 'primary' ? 'text-blue-400' : 'text-slate-400'}`}>
                    {idx.role}
                  </span>
                  <span className="text-xs font-medium text-slate-300">{idx.label || idx.id}</span>
                  {idx.indexName && (
                    <code className="text-[10px] text-slate-500 font-mono bg-slate-700 px-1.5 py-0.5 rounded">{idx.indexName}</code>
                  )}
                  <span className="text-[10px] text-slate-600">{idx.events.length} events</span>
                </div>
              ))}
            </div>

            {/* ── Counters + Scheduler ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DailyCounter
                industryId={activeIndustry}
                indices={activeIndustryMeta.indices}
                eventLimit={eventLimit}
              />
              <SchedulerControls
                industryId={activeIndustry}
                industryName={activeIndustryMeta.name}
                onStatusChange={(s) =>
                  setDistributingIndustries((prev) => ({
                    ...prev,
                    [activeIndustry]: s.isDistributing,
                  }))
                }
              />
            </div>

            {/* ── Latest session result ── */}
            {latestSession?.industryId === activeIndustry && (
              <SessionCard session={latestSession} />
            )}

            {/* ── Session history ── */}
            <SessionHistory
              industryId={activeIndustry}
              isActive={distributingIndustries[activeIndustry] ?? false}
            />

            {/* ── Persona grid ── */}
            {activeIndustry in personasByIndustry ? (
              <PersonaSelector
                personas={activePersonas}
                industryId={activeIndustry}
                industryName={activeIndustryMeta.name}
                onSessionComplete={handleSessionComplete}
                onPersonasGenerated={(newPersonas) => {
                  setPersonasByIndustry((prev) => ({
                    ...prev,
                    [activeIndustry]: [
                      ...(prev[activeIndustry] ?? []),
                      ...newPersonas,
                    ],
                  }));
                }}
                onPersonaUpdated={(updated) => {
                  setPersonasByIndustry((prev) => ({
                    ...prev,
                    [activeIndustry]: (prev[activeIndustry] ?? []).map((p) =>
                      p.id === updated.id ? updated : p
                    ),
                  }));
                }}
                onPersonaDeleted={(personaId) => {
                  setPersonasByIndustry((prev) => ({
                    ...prev,
                    [activeIndustry]: (prev[activeIndustry] ?? []).filter(
                      (p) => p.id !== personaId
                    ),
                  }));
                }}
              />
            ) : (
              <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-8 text-center">
                <p className="text-slate-400 text-sm">
                  Loading personas for {activeIndustryMeta.name}…
                </p>
                <p className="text-slate-600 text-xs mt-2">
                  Make sure the personas file is configured in the industry settings.
                </p>
              </div>
            )}

            {/* ── Event log ── */}
            <EventLog industryId={activeIndustry} />
          </>
        )}

        {/* ── No industries loaded state ── */}
        {mainView === 'industries' && industries.length === 0 && (
          <div className="text-center py-20">
            <p className="text-slate-400">Loading industry configurations…</p>
          </div>
        )}
      </main>

      {/* ── Industry Editor (create / edit) ── */}
      {appConfigOpen && (
        <AppConfigPanel
          onClose={() => {
            setAppConfigOpen(false);
            fetch('/api/app-config')
              .then((r) => (r.ok ? r.json() : null))
              .then((data) => { if (data?.appStatus) setAppStatus(data.appStatus); })
              .catch(() => {});
          }}
        />
      )}

      {editorTarget !== undefined && (
        <IndustryEditor
          industryId={editorTarget ?? undefined}
          onSaved={async () => {
            setEditorTarget(undefined);
            await loadIndustries();
            // Refresh personas for the active industry
            setPersonasByIndustry((prev) => {
              const updated = { ...prev };
              delete updated[activeIndustry];
              return updated;
            });
          }}
          onClose={() => setEditorTarget(undefined)}
        />
      )}

      {/* ── Footer ── */}
      <footer className="border-t border-slate-800 mt-10 py-4">
        <div className="max-w-screen-2xl mx-auto px-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>Algolia Insights Event Generator</span>
          <span>
            {industries.length} industries ·{' '}
            {industries.reduce((s, i) => s + i.personaCount, 0)} total personas
          </span>
        </div>
      </footer>
    </div>
  );
}
