'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentState, AgentSystemStatus, SupervisorDecision, GuardrailResult, IndustryV2 } from '@/types';
import { useSSE } from '../hooks/useSSE';
import AgentStatusCard from './AgentStatusCard';
import SupervisorLog from './SupervisorLog';
import GuardrailLog from './GuardrailLog';

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

interface Props {
  industries: Array<IndustryV2 & { personaCount: number }>;
  eventLimit: number;
  appStatus?: AppStatus | null;
  onOpenSettings?: () => void;
}

interface SupervisorStatusPayload {
  isRunning?: boolean;
  startedAt?: string;
  lastRunAt?: string;
  type?: string;
}

export default function AgentDashboard({ industries, eventLimit, appStatus, onOpenSettings }: Props) {
  const [isActive, setIsActive] = useState(false);
  const [startedAt, setStartedAt] = useState<string | undefined>();
  const [supervisorStatus, setSupervisorStatus] = useState<{
    isRunning: boolean;
    startedAt?: string;
    lastRunAt?: string;
  }>({ isRunning: false });
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [supervisorDecisions, setSupervisorDecisions] = useState<SupervisorDecision[]>([]);
  const [guardrailsByIndustry, setGuardrailsByIndustry] = useState<Record<string, GuardrailResult[]>>({});
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const decisionsSeen = useRef(new Set<string>());

  // ── Load initial status ────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/status');
      if (!res.ok) return;
      const data: AgentSystemStatus = await res.json();
      setIsActive(data.isActive);
      setStartedAt(data.startedAt);
      setSupervisorStatus(data.supervisorStatus);
      setAgentStates(data.agents ?? {});
      setSupervisorDecisions(data.recentDecisions ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Polling fallback every 15 s — updates agent states and decisions even if SSE events are missed
  useEffect(() => {
    const id = setInterval(() => { loadStatus(); }, 15_000);
    return () => clearInterval(id);
  }, [loadStatus]);

  // Load guardrail violations for each industry
  useEffect(() => {
    industries.forEach(async (ind) => {
      try {
        const res = await fetch(`/api/agents/guardrails?industryId=${ind.id}`);
        if (!res.ok) return;
        const data = await res.json();
        setGuardrailsByIndustry((prev) => ({ ...prev, [ind.id]: data.violations ?? [] }));
      } catch { /* ignore */ }
    });
  }, [industries]);

  // ── SSE: per-industry agent-status + guardrail events ─────────────
  // Fixed-slot hooks (up to 6 industries) — hooks must be called unconditionally;
  // null URLs prevent the connection from being opened.
  const industryIds = industries.map((i) => i.id);

  useSSE(
    industryIds.length > 0
      ? `/api/stream?industryId=${industryIds[0]}&types=agent-status,guardrail`
      : null,
    ['agent-status', 'guardrail'],
    (type, data) => handleIndustryEvent(industryIds[0], type, data)
  );
  useSSE(
    industryIds.length > 1
      ? `/api/stream?industryId=${industryIds[1]}&types=agent-status,guardrail`
      : null,
    ['agent-status', 'guardrail'],
    (type, data) => handleIndustryEvent(industryIds[1], type, data)
  );
  useSSE(
    industryIds.length > 2
      ? `/api/stream?industryId=${industryIds[2]}&types=agent-status,guardrail`
      : null,
    ['agent-status', 'guardrail'],
    (type, data) => handleIndustryEvent(industryIds[2], type, data)
  );
  useSSE(
    industryIds.length > 3
      ? `/api/stream?industryId=${industryIds[3]}&types=agent-status,guardrail`
      : null,
    ['agent-status', 'guardrail'],
    (type, data) => handleIndustryEvent(industryIds[3], type, data)
  );
  useSSE(
    industryIds.length > 4
      ? `/api/stream?industryId=${industryIds[4]}&types=agent-status,guardrail`
      : null,
    ['agent-status', 'guardrail'],
    (type, data) => handleIndustryEvent(industryIds[4], type, data)
  );
  useSSE(
    industryIds.length > 5
      ? `/api/stream?industryId=${industryIds[5]}&types=agent-status,guardrail`
      : null,
    ['agent-status', 'guardrail'],
    (type, data) => handleIndustryEvent(industryIds[5], type, data)
  );

  // ── SSE: supervisor stream ─────────────────────────────────────────
  useSSE(
    '/api/stream?industryId=_supervisor&types=supervisor',
    ['supervisor'],
    (_, data) => {
      const payload = data as SupervisorDecision & SupervisorStatusPayload;

      if (payload.type === 'started') {
        setSupervisorStatus((prev) => ({ ...prev, isRunning: true, startedAt: payload.startedAt }));
        setIsActive(true);
        return;
      }
      if (payload.type === 'stopped') {
        setSupervisorStatus((prev) => ({ ...prev, isRunning: false }));
        setIsActive(false);
        return;
      }
      if (payload.type === 'snapshot') {
        setSupervisorStatus({
          isRunning: payload.isRunning ?? false,
          startedAt: payload.startedAt,
          lastRunAt: payload.lastRunAt,
        });
        return;
      }

      // Regular decision
      if (payload.id && !decisionsSeen.current.has(payload.id)) {
        decisionsSeen.current.add(payload.id);
        setSupervisorDecisions((prev) => [payload as SupervisorDecision, ...prev].slice(0, 50));
        setSupervisorStatus((prev) => ({ ...prev, lastRunAt: payload.timestamp }));
      }
    }
  );

  function handleIndustryEvent(industryId: string | undefined, type: string, data: unknown) {
    if (!industryId) return;
    if (type === 'agent-status') {
      const state = data as AgentState;
      setAgentStates((prev) => ({ ...prev, [industryId]: state }));
    } else if (type === 'guardrail') {
      const payload = data as GuardrailResult & { violations?: GuardrailResult[]; initial?: boolean };
      if (payload.initial && payload.violations) {
        setGuardrailsByIndustry((prev) => ({ ...prev, [industryId]: payload.violations! }));
      } else if (payload.originalQuery) {
        setGuardrailsByIndustry((prev) => ({
          ...prev,
          [industryId]: [payload as GuardrailResult, ...(prev[industryId] ?? [])].slice(0, 100),
        }));
      }
    }
  }

  // ── Actions ────────────────────────────────────────────────────────
  const handleStart = async () => {
    setIsStarting(true);
    setStartError(null);
    try {
      const res = await fetch('/api/agents/start', { method: 'POST' });
      if (res.ok || res.status === 409) {
        setIsActive(true);
      } else {
        const body = await res.json().catch(() => ({}));
        setStartError((body as { error?: string }).error ?? `Server error ${res.status}`);
      }
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setIsStarting(false);
      await loadStatus();
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      await fetch('/api/agents/stop', { method: 'POST' });
      setIsActive(false);
    } finally {
      setIsStopping(false);
      await loadStatus();
    }
  };

  const handleRunNow = async () => {
    setIsRunningNow(true);
    try {
      await fetch('/api/agents/tick', { method: 'POST' });
      // Short delay then refresh status
      await new Promise((r) => setTimeout(r, 1500));
      await loadStatus();
    } finally {
      setIsRunningNow(false);
    }
  };

  // ── Resolved Algolia app + LLM provider (from appStatus defaults) ──
  const resolvedAlgoliaApp = appStatus
    ? appStatus.algoliaApps.find((a) => a.id === appStatus.defaultAlgoliaAppId) ?? appStatus.algoliaApps[0] ?? null
    : null;
  const resolvedLLM = appStatus
    ? appStatus.llmProviders.find((p) => p.id === appStatus.defaultLlmProviderId) ?? appStatus.llmProviders[0] ?? null
    : null;

  // ── Derived stats ──────────────────────────────────────────────────
  const allViolations = Object.values(guardrailsByIndustry).flat();
  const activeAgents = Object.values(agentStates).filter((s) => s.isActive).length;
  const totalEventsSentToday = Object.values(agentStates).reduce((s, a) => s + a.eventsSentToday, 0);

  const tabIndustry = industries.find((i) => i.id === activeTab);
  const tabViolations = activeTab !== 'overview' ? (guardrailsByIndustry[activeTab] ?? []) : [];

  return (
    <div className="space-y-5">
      {/* ── Control panel ─────────────────────────────────────────── */}
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isActive ? 'bg-violet-600' : 'bg-slate-700'
            }`}>
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Autonomous Agent System</h2>
              <p className="text-xs text-slate-400">
                {isActive
                  ? `Active since ${startedAt ? new Date(startedAt).toLocaleTimeString() : '—'} · ${activeAgents} agent${activeAgents !== 1 ? 's' : ''} running`
                  : 'Supervisor-driven, guardrail-validated event generation'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Stats when active */}
            {isActive && (
              <div className="hidden sm:flex items-center gap-4 text-xs text-slate-400 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2">
                <span>
                  <span className="text-white font-semibold">{activeAgents}</span> active
                </span>
                <span className="text-slate-600">|</span>
                <span>
                  <span className="text-white font-semibold">{totalEventsSentToday.toLocaleString()}</span> events today
                </span>
                <span className="text-slate-600">|</span>
                <span>
                  <span className="text-amber-400 font-semibold">{allViolations.length}</span> guardrail hits
                </span>
              </div>
            )}

            {isActive && (
              <button
                onClick={handleRunNow}
                disabled={isRunningNow}
                title="Force immediate supervisor assessment"
                className="px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 rounded-lg font-medium transition-colors flex items-center gap-1.5 border border-slate-600"
              >
                {isRunningNow ? (
                  <span className="w-3.5 h-3.5 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                Run Now
              </button>
            )}

            {isActive ? (
              <button
                onClick={handleStop}
                disabled={isStopping}
                className="px-4 py-2 text-sm bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {isStopping ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Stopping…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Stop Agents
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={isStarting}
                className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {isStarting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Start Agents
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Error display */}
        {startError && (
          <div className="mt-3 flex items-start gap-2 bg-rose-900/20 border border-rose-800/50 rounded-lg px-3 py-2">
            <svg className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-rose-300">{startError}</p>
            <button onClick={() => setStartError(null)} className="ml-auto text-rose-500 hover:text-rose-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* How it works — collapsed hint */}
        <div className="mt-4 pt-4 border-t border-slate-700/50 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] text-slate-500">
          <div className="flex items-start gap-2">
            <span className="text-violet-400 text-base shrink-0">①</span>
            <div>
              <p className="text-slate-300 font-medium mb-0.5">Supervisor Agent</p>
              Monitors all industries every 10 min. Calculates urgency from daily target vs. time elapsed. Dispatches sessions to keep every industry on pace.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 text-base shrink-0">②</span>
            <div>
              <p className="text-slate-300 font-medium mb-0.5">Industry Agents</p>
              Each industry runs as an autonomous agent. Cycles through phases: planning → validating → searching → sending. Emits live status.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-amber-400 text-base shrink-0">③</span>
            <div>
              <p className="text-slate-300 font-medium mb-0.5">Guardrails Agent</p>
              Validates every query against the active persona before it hits Algolia. Rejects off-persona queries and suggests better alternatives (up to 3 retries).
            </div>
          </div>
        </div>

        {/* App settings row */}
        <div className="mt-3 pt-3 border-t border-slate-700/50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {resolvedAlgoliaApp ? (
              <span className="inline-flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                <svg className="w-2.5 h-2.5 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
                </svg>
                <span className="text-blue-300 font-medium">{resolvedAlgoliaApp.name}</span>
                <span className="text-slate-600">·</span>
                <span className="font-mono text-slate-500">{resolvedAlgoliaApp.appId}</span>
                {!resolvedAlgoliaApp.hasSearchApiKey && (
                  <span className="ml-0.5 text-rose-400 italic">no key</span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] bg-rose-900/20 border border-rose-800/50 text-rose-400 px-2 py-0.5 rounded-full">
                <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                No Algolia app configured
              </span>
            )}

            {resolvedLLM ? (
              <span className="inline-flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                <svg className="w-2.5 h-2.5 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                </svg>
                <span className="text-violet-300 font-medium">{resolvedLLM.name}</span>
                <span className="text-slate-600">·</span>
                <span className="font-mono text-slate-500">{resolvedLLM.defaultModel}</span>
                {!resolvedLLM.hasApiKey && (
                  <span className="ml-0.5 text-rose-400 italic">no key</span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] bg-rose-900/20 border border-rose-800/50 text-rose-400 px-2 py-0.5 rounded-full">
                <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                No LLM provider configured
              </span>
            )}
          </div>

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 px-2.5 py-1 rounded-lg transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              App Settings
            </button>
          )}
        </div>
      </div>

      {/* ── Tab bar: overview + per-industry ──────────────────────── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('overview')}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'overview'
              ? 'bg-slate-700 text-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          Overview
        </button>
        {industries.map((ind) => {
          const violations = guardrailsByIndustry[ind.id]?.length ?? 0;
          const state = agentStates[ind.id];
          return (
            <button
              key={ind.id}
              onClick={() => setActiveTab(ind.id)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === ind.id
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <span>{ind.icon}</span>
              <span>{ind.name}</span>
              {state?.isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              )}
              {violations > 0 && (
                <span className="text-[10px] bg-amber-900/50 text-amber-400 border border-amber-800 px-1 py-0.5 rounded-full">
                  {violations}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Overview: agent cards grid + supervisor log ────────────── */}
      {activeTab === 'overview' && (
        <>
          {/* Warning when no industry has personas */}
          {industries.every((i) => i.personaCount === 0) && (
            <div className="flex items-start gap-3 bg-amber-900/20 border border-amber-800/50 rounded-xl px-4 py-3">
              <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-sm text-amber-300 font-medium">No personas configured</p>
                <p className="text-xs text-amber-400/70 mt-0.5">
                  The supervisor needs personas to run sessions. Switch to the <strong>Industries</strong> tab, select an industry, and use the <strong>Generate Personas</strong> button.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {industries.map((ind) => {
              const agentState = agentStates[ind.id] ?? {
                industryId: ind.id,
                phase: 'idle' as const,
                sessionsCompleted: 0,
                sessionsTarget: 0,
                eventsSentToday: 0,
                dailyTarget: eventLimit * Math.max(1, ind.indices.filter((i) => i.events.length > 0).length),
                guardrailViolations: 0,
                lastActivity: new Date().toISOString(),
                errors: [],
                isActive: false,
              };
              const dailyTarget =
                eventLimit * Math.max(1, ind.indices.filter((i) => i.events.length > 0).length);
              return (
                <AgentStatusCard
                  key={ind.id}
                  industryName={ind.name}
                  industryIcon={ind.icon}
                  industryColor={ind.color}
                  state={agentState}
                  dailyTarget={dailyTarget}
                  personaCount={ind.personaCount}
                />
              );
            })}
          </div>

          <SupervisorLog
            decisions={supervisorDecisions}
            isRunning={supervisorStatus.isRunning}
            lastRunAt={supervisorStatus.lastRunAt}
          />
        </>
      )}

      {/* ── Per-industry detail view ────────────────────────────────── */}
      {activeTab !== 'overview' && tabIndustry && (
        <div className="space-y-4">
          {/* Agent card */}
          {(() => {
            const state = agentStates[tabIndustry.id] ?? {
              industryId: tabIndustry.id,
              phase: 'idle' as const,
              sessionsCompleted: 0,
              sessionsTarget: 0,
              eventsSentToday: 0,
              dailyTarget: eventLimit,
              guardrailViolations: 0,
              lastActivity: new Date().toISOString(),
              errors: [],
              isActive: false,
            };
            const dailyTarget =
              eventLimit *
              Math.max(1, tabIndustry.indices.filter((i) => i.events.length > 0).length);
            return (
              <AgentStatusCard
                industryName={tabIndustry.name}
                industryIcon={tabIndustry.icon}
                industryColor={tabIndustry.color}
                state={state}
                dailyTarget={dailyTarget}
                personaCount={tabIndustry.personaCount}
              />
            );
          })()}

          {/* Supervisor decisions for this industry */}
          <SupervisorLog
            decisions={supervisorDecisions.filter((d) => d.industryId === tabIndustry.id)}
            isRunning={supervisorStatus.isRunning}
            lastRunAt={supervisorStatus.lastRunAt}
          />

          {/* Guardrail violations for this industry */}
          <GuardrailLog
            violations={tabViolations}
            industryName={tabIndustry.name}
          />
        </div>
      )}
    </div>
  );
}
