'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentState, AgentSystemStatus, SupervisorDecision, GuardrailResult, AgentConfig, AgentConfigs, Persona, SentEvent, SessionRecord } from '@/types';
import { useSSE } from '../hooks/useSSE';
import AgentStatusCard from './AgentStatusCard';
import SupervisorLog from './SupervisorLog';
import GuardrailLog from './GuardrailLog';
import PersonaSelector from './PersonaSelector';
import SessionHistory from './SessionHistory';
import EventLog from './EventLog';

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

interface Props {
  sites: Array<AgentConfig & { personaCount: number; personas?: Persona[] }>;
  eventLimit: number;
  appStatus: AppStatus | null;
  onOpenSettings: () => void;
  onCreateSite: () => void;
  onEditSite: (agentId: string) => void;
  onDeleteSite: (agentId: string) => void;
}

interface SupervisorStatusPayload {
  isRunning?: boolean;
  startedAt?: string;
  lastRunAt?: string;
  type?: string;
}

export default function AgentDashboard({ sites, eventLimit, appStatus, onOpenSettings, onCreateSite, onEditSite, onDeleteSite }: Props) {
  const [isActive, setIsActive] = useState(false);
  const [startedAt, setStartedAt] = useState<string | undefined>();
  const [supervisorStatus, setSupervisorStatus] = useState<{
    isRunning: boolean;
    startedAt?: string;
    lastRunAt?: string;
  }>({ isRunning: false });
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [supervisorDecisions, setSupervisorDecisions] = useState<SupervisorDecision[]>([]);
  const [guardrailsBySite, setGuardrailsBySite] = useState<Record<string, GuardrailResult[]>>({});
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Agent config editing
  const [agentConfigs, setAgentConfigs] = useState<AgentConfigs | null>(null);
  const [editingAgent, setEditingAgent] = useState<keyof AgentConfigs | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);

  // Personas per site
  const [personasBySite, setPersonasBySite] = useState<Record<string, Persona[]>>({});
  const [personasLoading, setPersonasLoading] = useState<Record<string, boolean>>({});

  // Sessions and events per site — populated via the shared per-agent SSE connection
  const [sessionsBySite, setSessionsBySite] = useState<Record<string, SessionRecord[]>>({});
  const [eventsBySite, setEventsBySite] = useState<Record<string, SentEvent[]>>({});
  const [sseLastUpdated, setSseLastUpdated] = useState<Record<string, Date>>({});

  // In-flight guard — prevents duplicate concurrent fetches for the same agentId
  const personasLoadingRef = useRef(new Set<string>());
  // Mirror of personasBySite state — kept in sync below so the stable loadPersonas
  // callback can read the current value without capturing stale closures.
  // Using this as the "already loaded" guard (instead of a bare Set ref) means the
  // guard resets correctly after a Fast Refresh hot-reload, which resets state but
  // leaves bare refs intact.
  const personasBySiteRef = useRef<Record<string, Persona[]>>({});

  // Keep the ref in sync with the state so loadPersonas can read current values
  personasBySiteRef.current = personasBySite;

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

  // Polling fallback every 15 s
  useEffect(() => {
    const id = setInterval(() => { loadStatus(); }, 15_000);
    return () => clearInterval(id);
  }, [loadStatus]);

  const loadAgentConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/config');
      if (!res.ok) return;
      const data: AgentConfigs = await res.json();
      setAgentConfigs(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadAgentConfigs(); }, [loadAgentConfigs]);

  // ── Load personas for a site ────────────────────────────────────────
  // Guard uses personasBySiteRef (mirrors state) instead of a separate Set ref
  // so it resets correctly after a Fast Refresh hot-reload (refs survive reloads,
  // but personasBySiteRef is overwritten from state on every render).
  const loadPersonas = useCallback(async (agentId: string) => {
    if (!agentId) {
      console.warn(`[Personas] loadPersonas called with empty agentId — skipping`);
      return;
    }

    // "Already loaded" — key exists in state mirror (resets on hot-reload unlike a bare Set ref).
    // This is only written on a successful server response, so it's safe to skip.
    if (agentId in personasBySiteRef.current) {
      const cached = personasBySiteRef.current[agentId];
      console.warn(
        `[Personas] skipping "${agentId}" — already in state, count=${cached?.length ?? 0}` +
        (cached?.length === 0 ? ' (agent has no personas)' : '')
      );
      return;
    }

    // "Fetch in flight" guard
    if (personasLoadingRef.current.has(agentId)) {
      console.warn(`[Personas] skipping "${agentId}" — fetch already in flight`);
      return;
    }

    console.warn(`[Personas] → fetching /api/agent-configs/${agentId}/personas …`);
    personasLoadingRef.current.add(agentId);
    setPersonasLoading((prev) => ({ ...prev, [agentId]: true }));

    // Abort after 15 s so a stuck fetch (e.g. due to HTTP/1.1 connection-limit congestion)
    // doesn't permanently lock the loading guard, allowing a retry on the next tab click.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[Personas] ✗ timeout (15 s) for "${agentId}" — aborting fetch, will retry on next tab click`);
      controller.abort();
    }, 15_000);

    try {
      const res = await fetch(`/api/agent-configs/${agentId}/personas`, { signal: controller.signal });
      console.warn(`[Personas] ← response status=${res.status} ok=${res.ok} for "${agentId}"`);
      if (!res.ok) {
        const errorText = await res.text();
        console.error(
          `[Personas] ✗ fetch FAILED for "${agentId}" — HTTP ${res.status}: ${errorText}. ` +
          `Guard NOT set — will retry on next tab activation.`
        );
        return;
      }
      const data = await res.json();
      const count = data?.personas?.length ?? 0;
      if (count === 0) {
        console.warn(`[Personas] ✓ loaded 0 personas for "${agentId}" — no personas exist yet. Full response:`, data);
      } else {
        console.warn(`[Personas] ✓ loaded ${count} personas for "${agentId}"`);
      }
      // Only write to state (and therefore the guard) after a successful response.
      setPersonasBySite((prev) => ({ ...prev, [agentId]: data?.personas ?? [] }));
    } catch (err) {
      // Network error or AbortError (timeout) — guard NOT set so retry is possible.
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.warn(`[Personas] ✗ fetch aborted (timeout) for "${agentId}" — guard cleared, click tab to retry`);
      } else {
        console.error(`[Personas] ✗ network error for "${agentId}" (server may be restarting):`, err);
      }
    } finally {
      clearTimeout(timeoutId);
      personasLoadingRef.current.delete(agentId);
      setPersonasLoading((prev) => ({ ...prev, [agentId]: false }));
    }
  }, []); // stable — reads guards from refs/personasBySiteRef, writes via functional setState

  // Preload personas for all agents on mount so they're ready before any tab is clicked.
  // This also handles the Fast Refresh case where activeTab state is preserved but
  // personasBySite state is reset — the mount effect re-fetches everything.
  const siteIdsRef = useRef<string[]>([]);
  siteIdsRef.current = sites.map((s) => s.id);

  useEffect(() => {
    const ids = siteIdsRef.current;
    console.warn(`[Personas] mount — preloading for ${ids.length} agent(s): [${ids.join(', ')}]`);
    if (ids.length === 0) {
      console.warn(`[Personas] mount — sites list is empty, nothing to preload (agents not loaded yet?)`);
    }
    // Stagger by 200 ms per agent to avoid saturating the 6-connection HTTP/1.1 limit
    // while SSE connections are being established (6 SSE + 5 simultaneous REST = 11 requests).
    ids.forEach((id, i) => setTimeout(() => loadPersonas(id), i * 200));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only — siteIdsRef always has the latest value

  // When the agent list changes, pre-populate personas directly from the sites prop
  // (the /api/agent-configs response already includes the full personas array, so no
  // separate per-agent fetches are needed). Only fall back to individual fetches for
  // any agent that arrived without a personas field.
  useEffect(() => {
    const fromProp = sites.filter(
      (s) => Array.isArray(s.personas) && !(s.id in personasBySiteRef.current)
    );
    if (fromProp.length > 0) {
      // Write to the ref synchronously so the loadPersonas in-flight guard fires immediately
      for (const s of fromProp) {
        personasBySiteRef.current[s.id] = s.personas!;
      }
      setPersonasBySite((prev) => {
        const next = { ...prev };
        for (const s of fromProp) next[s.id] = s.personas!;
        return next;
      });
      console.warn(`[Personas] pre-populated from prop: [${fromProp.map((s) => `${s.id}(${s.personas!.length})`).join(', ')}]`);
    }

    // Fall back to individual fetches for agents not covered by the prop
    const unloaded = sites.map((s) => s.id).filter((id) => !(id in personasBySiteRef.current));
    if (unloaded.length > 0) {
      console.warn(`[Personas] fetching missing agents: [${unloaded.join(', ')}]`);
      unloaded.forEach((id, i) => setTimeout(() => loadPersonas(id), i * 200));
    }
  }, [sites, loadPersonas]);

  // Keep the tab-switch trigger as a fast-path for the active tab.
  useEffect(() => {
    if (activeTab !== 'overview') {
      console.warn(`[Personas] tab activated: "${activeTab}" — triggering loadPersonas`);
      loadPersonas(activeTab);
    }
  }, [activeTab, loadPersonas]);

  const handleEditAgent = (agentKey: keyof AgentConfigs) => {
    if (!agentConfigs) return;
    setEditDraft(agentConfigs[agentKey]?.systemPrompt ?? '');
    setEditingAgent(agentKey);
    setConfigSaveError(null);
  };

  const handleSaveAgentConfig = async () => {
    if (!editingAgent || !agentConfigs) return;
    setIsSavingConfig(true);
    setConfigSaveError(null);
    try {
      const res = await fetch('/api/agents/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [editingAgent]: { systemPrompt: editDraft } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setConfigSaveError((body as { error?: string }).error ?? `Server error ${res.status}`);
        return;
      }
      const updated: AgentConfigs = await res.json();
      setAgentConfigs(updated);
      setEditingAgent(null);
    } catch (e) {
      setConfigSaveError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Load guardrail violations for each site
  useEffect(() => {
    sites.forEach(async (site) => {
      try {
        const res = await fetch(`/api/agents/guardrails?agentId=${site.id}`);
        if (!res.ok) return;
        const data = await res.json();
        setGuardrailsBySite((prev) => ({ ...prev, [site.id]: data.violations ?? [] }));
      } catch { /* ignore */ }
    });
  }, [sites]);

  // ── SSE: per-site agent-status + guardrail + session + event-log ──────────
  // All four types share one connection per agent so we stay within the
  // browser HTTP/1.1 limit of 6 persistent connections per origin.
  // (5 agents × 1 connection + 1 supervisor = 6 total)
  const siteIds = sites.map((s) => s.id);
  const PER_AGENT_TYPES = ['agent-status', 'guardrail', 'session', 'event-log'] as const;

  useSSE(
    siteIds.length > 0 ? `/api/stream?siteId=${siteIds[0]}&types=agent-status,guardrail,session,event-log` : null,
    PER_AGENT_TYPES,
    (type, data) => handleSiteEvent(siteIds[0], type, data)
  );
  useSSE(
    siteIds.length > 1 ? `/api/stream?siteId=${siteIds[1]}&types=agent-status,guardrail,session,event-log` : null,
    PER_AGENT_TYPES,
    (type, data) => handleSiteEvent(siteIds[1], type, data)
  );
  useSSE(
    siteIds.length > 2 ? `/api/stream?siteId=${siteIds[2]}&types=agent-status,guardrail,session,event-log` : null,
    PER_AGENT_TYPES,
    (type, data) => handleSiteEvent(siteIds[2], type, data)
  );
  useSSE(
    siteIds.length > 3 ? `/api/stream?siteId=${siteIds[3]}&types=agent-status,guardrail,session,event-log` : null,
    PER_AGENT_TYPES,
    (type, data) => handleSiteEvent(siteIds[3], type, data)
  );
  useSSE(
    siteIds.length > 4 ? `/api/stream?siteId=${siteIds[4]}&types=agent-status,guardrail,session,event-log` : null,
    PER_AGENT_TYPES,
    (type, data) => handleSiteEvent(siteIds[4], type, data)
  );
  useSSE(
    siteIds.length > 5 ? `/api/stream?siteId=${siteIds[5]}&types=agent-status,guardrail,session,event-log` : null,
    PER_AGENT_TYPES,
    (type, data) => handleSiteEvent(siteIds[5], type, data)
  );

  // ── SSE: supervisor stream ─────────────────────────────────────────
  useSSE(
    '/api/stream?siteId=_supervisor&types=supervisor',
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
      if (payload.id && !decisionsSeen.current.has(payload.id)) {
        decisionsSeen.current.add(payload.id);
        setSupervisorDecisions((prev) => [payload as SupervisorDecision, ...prev].slice(0, 50));
        setSupervisorStatus((prev) => ({ ...prev, lastRunAt: payload.timestamp }));
      }
    }
  );

  function handleSiteEvent(siteId: string | undefined, type: string, data: unknown) {
    if (!siteId) return;
    if (type === 'agent-status') {
      const state = data as AgentState;
      setAgentStates((prev) => ({ ...prev, [siteId]: state }));
    } else if (type === 'guardrail') {
      const payload = data as GuardrailResult & { violations?: GuardrailResult[]; initial?: boolean };
      if (payload.initial && payload.violations) {
        setGuardrailsBySite((prev) => ({ ...prev, [siteId]: payload.violations! }));
      } else if (payload.originalQuery) {
        setGuardrailsBySite((prev) => ({
          ...prev,
          [siteId]: [payload as GuardrailResult, ...(prev[siteId] ?? [])].slice(0, 100),
        }));
      }
    } else if (type === 'session') {
      const payload = data as { session?: SessionRecord; sessions?: SessionRecord[]; initial?: boolean; cleared?: boolean };
      setSseLastUpdated((prev) => ({ ...prev, [siteId]: new Date() }));
      if (payload.initial || payload.cleared) {
        setSessionsBySite((prev) => ({ ...prev, [siteId]: payload.sessions ?? [] }));
      } else if (payload.session) {
        setSessionsBySite((prev) => ({
          ...prev,
          [siteId]: [payload.session!, ...(prev[siteId] ?? [])].slice(0, 200),
        }));
      }
    } else if (type === 'event-log') {
      const payload = data as { events: SentEvent[]; initial?: boolean; cleared?: boolean };
      setSseLastUpdated((prev) => ({ ...prev, [siteId]: new Date() }));
      if (payload.initial || payload.cleared) {
        setEventsBySite((prev) => ({ ...prev, [siteId]: payload.events ?? [] }));
      } else {
        setEventsBySite((prev) => ({
          ...prev,
          [siteId]: [...(payload.events ?? []).slice().reverse(), ...(prev[siteId] ?? [])].slice(0, 500),
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
      await new Promise((r) => setTimeout(r, 1500));
      await loadStatus();
    } finally {
      setIsRunningNow(false);
    }
  };

  // ── Per-site Algolia / LLM resolution ─────────────────────────────
  const resolveAlgoliaApp = (site: AgentConfig): (AlgoliaAppStatus & { isLegacy?: boolean }) | null => {
    if (!appStatus) return null;
    return (
      appStatus.algoliaApps.find((a) => a.id === (site.algoliaAppConfigId ?? appStatus.defaultAlgoliaAppId)) ??
      appStatus.algoliaApps[0] ??
      (appStatus.credentials?.algoliaAppId?.value
        ? {
            id: 'legacy',
            name: appStatus.credentials.algoliaAppId.source === 'env' ? 'Env var' : 'Legacy credential',
            appId: appStatus.credentials.algoliaAppId.value,
            hasSearchApiKey: appStatus.credentials.algoliaSearchApiKey.isSet,
            isLegacy: true,
          }
        : null)
    );
  };

  const resolveLLM = (site: AgentConfig): LLMProviderStatus | null => {
    if (!appStatus) return null;
    return (
      appStatus.llmProviders.find((p) => p.id === (site.llmProviderId ?? appStatus.defaultLlmProviderId)) ??
      appStatus.llmProviders[0] ??
      null
    );
  };

  // Global defaults (for control panel banner)
  const defaultAlgoliaApp: (AlgoliaAppStatus & { isLegacy?: boolean }) | null = appStatus
    ? (appStatus.algoliaApps.find((a) => a.id === appStatus.defaultAlgoliaAppId) ??
        appStatus.algoliaApps[0] ??
        (appStatus.credentials?.algoliaAppId?.value
          ? {
              id: 'legacy',
              name: appStatus.credentials.algoliaAppId.source === 'env' ? 'Env var' : 'Legacy credential',
              appId: appStatus.credentials.algoliaAppId.value,
              hasSearchApiKey: appStatus.credentials.algoliaSearchApiKey.isSet,
              isLegacy: true,
            }
          : null))
    : null;
  const defaultLLM = appStatus
    ? appStatus.llmProviders.find((p) => p.id === appStatus.defaultLlmProviderId) ?? appStatus.llmProviders[0] ?? null
    : null;

  // ── Derived stats ──────────────────────────────────────────────────
  const allViolations = Object.values(guardrailsBySite).flat();
  const activeAgents = Object.values(agentStates).filter((s) => s.isActive).length;
  const totalEventsSentToday = Object.values(agentStates).reduce((s, a) => s + a.eventsSentToday, 0);

  const tabSite = sites.find((s) => s.id === activeTab);
  const tabViolations = activeTab !== 'overview' ? (guardrailsBySite[activeTab] ?? []) : [];

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

          <div className="flex items-center gap-2 flex-wrap">
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

            {/* New Agent button */}
            <button
              onClick={onCreateSite}
              className="px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg font-medium transition-colors flex items-center gap-1.5 border border-slate-600 hover:border-slate-500"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              New Agent
            </button>

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

        {/* Agent system prompt cards */}
        <div className="mt-4 pt-4 border-t border-slate-700/50 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
            { key: 'supervisor' as const, accent: 'text-violet-400', border: 'border-violet-800/40', bg: 'bg-violet-900/10', num: '①', label: 'Supervisor Agent', badge: 'bg-violet-900/40 text-violet-300 border-violet-800' },
            { key: 'workerAgent' as const, accent: 'text-blue-400', border: 'border-blue-800/40', bg: 'bg-blue-900/10', num: '②', label: 'Worker Agent', badge: 'bg-blue-900/40 text-blue-300 border-blue-800' },
            { key: 'guardrails' as const, accent: 'text-amber-400', border: 'border-amber-800/40', bg: 'bg-amber-900/10', num: '③', label: 'Guardrails Agent', badge: 'bg-amber-900/40 text-amber-300 border-amber-800' },
          ] as const).map(({ key, accent, border, bg, num, label, badge }) => (
            <div key={key} className={`rounded-lg border ${border} ${bg} p-3 flex flex-col gap-2`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className={`${accent} text-base`}>{num}</span>
                  <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${badge}`}>{label}</span>
                </div>
                <button
                  onClick={() => handleEditAgent(key)}
                  className="text-[10px] text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded transition-colors flex items-center gap-1"
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-3">
                {agentConfigs ? agentConfigs[key].systemPrompt : '—'}
              </p>
              {agentConfigs?.[key].updatedAt && (
                <p className="text-[9px] text-slate-600">
                  Updated {new Date(agentConfigs[key].updatedAt!).toLocaleDateString()}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* App settings row */}
        <div className="mt-3 pt-3 border-t border-slate-700/50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {appStatus === null ? (
              <span className="inline-flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700/50 text-slate-600 px-2 py-0.5 rounded-full animate-pulse">
                Loading…
              </span>
            ) : (
              <>
                {defaultAlgoliaApp ? (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                    <svg className="w-2.5 h-2.5 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
                    </svg>
                    <span className="text-blue-300 font-medium">{defaultAlgoliaApp.name}</span>
                    <span className="text-slate-600">·</span>
                    <span className="font-mono text-slate-500">{defaultAlgoliaApp.appId}</span>
                    {defaultAlgoliaApp.isLegacy && <span className="ml-0.5 text-slate-600 italic">env</span>}
                    {!defaultAlgoliaApp.hasSearchApiKey && <span className="ml-0.5 text-rose-400 italic">no key</span>}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-rose-900/20 border border-rose-800/50 text-rose-400 px-2 py-0.5 rounded-full">
                    <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    No Algolia app — add one in App Settings
                  </span>
                )}

                {defaultLLM ? (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                    <svg className="w-2.5 h-2.5 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                    </svg>
                    <span className="text-violet-300 font-medium">{defaultLLM.name}</span>
                    <span className="text-slate-600">·</span>
                    <span className="font-mono text-slate-500">{defaultLLM.defaultModel}</span>
                    {!defaultLLM.hasApiKey && <span className="ml-0.5 text-rose-400 italic">no key</span>}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-rose-900/20 border border-rose-800/50 text-rose-400 px-2 py-0.5 rounded-full">
                    <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    No LLM provider — add one in App Settings
                  </span>
                )}
              </>
            )}
          </div>

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
        </div>
      </div>

      {/* ── Tab bar: overview + per-site ──────────────────────── */}
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
        {sites.map((site) => {
          const violations = guardrailsBySite[site.id]?.length ?? 0;
          const state = agentStates[site.id];
          return (
            <button
              key={site.id}
              onClick={() => setActiveTab(site.id)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === site.id
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <span>{site.icon}</span>
              <span>{site.name}</span>
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
          {/* Warning when no site has personas */}
          {sites.length > 0 && sites.every((s) => s.personaCount === 0) && (
            <div className="flex items-start gap-3 bg-amber-900/20 border border-amber-800/50 rounded-xl px-4 py-3">
              <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-sm text-amber-300 font-medium">No personas configured</p>
                <p className="text-xs text-amber-400/70 mt-0.5">
                  Click on an agent tab above to view and generate personas for that agent.
                </p>
              </div>
            </div>
          )}

          {sites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-16 h-16 bg-slate-800 border border-slate-700 rounded-2xl flex items-center justify-center">
                <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-slate-300 font-medium">No agents yet</p>
                <p className="text-slate-500 text-sm mt-1">Create your first agent to start generating events</p>
              </div>
              <button
                onClick={onCreateSite}
                className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                Create First Agent
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sites.map((site) => {
                const agentState = agentStates[site.id] ?? {
                  siteId: site.id,
                  phase: 'idle' as const,
                  sessionsCompleted: 0,
                  sessionsTarget: 0,
                  eventsSentToday: 0,
                  dailyTarget: eventLimit * Math.max(1, site.indices.filter((i) => i.events.length > 0).length),
                  guardrailViolations: 0,
                  lastActivity: new Date().toISOString(),
                  errors: [],
                  isActive: false,
                };
                const dailyTarget =
                  eventLimit * Math.max(1, site.indices.filter((i) => i.events.length > 0).length);
                const algoliaApp = resolveAlgoliaApp(site);
                const llmProvider = resolveLLM(site);
                return (
                  <AgentStatusCard
                    key={site.id}
                    siteName={site.name}
                    siteIcon={site.icon}
                    siteColor={site.color}
                    state={agentState}
                    dailyTarget={dailyTarget}
                    personaCount={site.personaCount}
                    algoliaApp={algoliaApp ? { name: algoliaApp.name, appId: algoliaApp.appId, isOverride: !!site.algoliaAppConfigId } : undefined}
                    llmProvider={llmProvider ? { name: llmProvider.name, model: llmProvider.defaultModel, isOverride: !!site.llmProviderId } : undefined}
                    onEdit={() => onEditSite(site.id)}
                    onDelete={!site.isBuiltIn ? () => onDeleteSite(site.id) : undefined}
                    onViewDetails={() => setActiveTab(site.id)}
                  />
                );
              })}
            </div>
          )}

          <SupervisorLog
            decisions={supervisorDecisions}
            isRunning={supervisorStatus.isRunning}
            lastRunAt={supervisorStatus.lastRunAt}
          />
        </>
      )}

      {/* ── Per-site detail view ────────────────────────────────── */}
      {activeTab !== 'overview' && tabSite && (
        <div className="space-y-5">
          {/* Agent status card + action buttons */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 min-w-0">
              {(() => {
                const state = agentStates[tabSite.id] ?? {
                  siteId: tabSite.id,
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
                  eventLimit * Math.max(1, tabSite.indices.filter((i) => i.events.length > 0).length);
                const algoliaApp = resolveAlgoliaApp(tabSite);
                const llmProvider = resolveLLM(tabSite);
                return (
                  <AgentStatusCard
                    siteName={tabSite.name}
                    siteIcon={tabSite.icon}
                    siteColor={tabSite.color}
                    state={state}
                    dailyTarget={dailyTarget}
                    personaCount={tabSite.personaCount}
                    algoliaApp={algoliaApp ? { name: algoliaApp.name, appId: algoliaApp.appId, isOverride: !!tabSite.algoliaAppConfigId } : undefined}
                    llmProvider={llmProvider ? { name: llmProvider.name, model: llmProvider.defaultModel, isOverride: !!tabSite.llmProviderId } : undefined}
                    onEdit={() => onEditSite(tabSite.id)}
                    onDelete={!tabSite.isBuiltIn ? () => onDeleteSite(tabSite.id) : undefined}
                    expanded
                  />
                );
              })()}
            </div>
          </div>

          {/* Index summary chips */}
          <div className="flex flex-wrap gap-2">
            {tabSite.indices.map((idx) => (
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
            {tabSite.siteUrl && (
              <a
                href={tabSite.siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 hover:border-blue-700 rounded-lg px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                {tabSite.siteUrl}
              </a>
            )}
          </div>

          {/* Personas */}
          {tabSite.id in personasBySite ? (
            <PersonaSelector
              personas={personasBySite[tabSite.id]}
              siteId={tabSite.id}
              siteName={tabSite.name}
              onPersonasGenerated={(newPersonas) => {
                setPersonasBySite((prev) => ({
                  ...prev,
                  [tabSite.id]: [...(prev[tabSite.id] ?? []), ...newPersonas],
                }));
              }}
              onPersonaUpdated={(updated) => {
                setPersonasBySite((prev) => ({
                  ...prev,
                  [tabSite.id]: (prev[tabSite.id] ?? []).map((p) =>
                    p.id === updated.id ? updated : p
                  ),
                }));
              }}
              onPersonaDeleted={(personaId) => {
                setPersonasBySite((prev) => ({
                  ...prev,
                  [tabSite.id]: (prev[tabSite.id] ?? []).filter((p) => p.id !== personaId),
                }));
              }}
            />
          ) : (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-8 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                {personasLoading[tabSite.id] && (
                  <span className="w-3.5 h-3.5 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
                )}
                <p className="text-slate-400 text-sm">
                  {personasLoading[tabSite.id]
                    ? `Loading personas for ${tabSite.name}…`
                    : `No personas found for ${tabSite.name}`}
                </p>
              </div>
              {!personasLoading[tabSite.id] && (
                <p className="text-slate-600 text-xs mt-1">
                  Personas will appear here once the agent tab finishes loading.
                </p>
              )}
            </div>
          )}

          {/* Session History */}
          <SessionHistory
            agentId={tabSite.id}
            isActive={agentStates[tabSite.id]?.isActive ?? false}
            sessions={sessionsBySite[tabSite.id]}
            lastUpdated={sseLastUpdated[tabSite.id] ?? null}
          />

          {/* Event Log */}
          <EventLog
            agentId={tabSite.id}
            events={eventsBySite[tabSite.id]}
            sessions={sessionsBySite[tabSite.id]}
            lastUpdated={sseLastUpdated[tabSite.id] ?? null}
          />

          {/* Supervisor decisions for this agent */}
          <SupervisorLog
            decisions={supervisorDecisions.filter((d) => (d.agentId ?? d.siteId) === tabSite.id)}
            isRunning={supervisorStatus.isRunning}
            lastRunAt={supervisorStatus.lastRunAt}
          />

          {/* Guardrail violations for this site */}
          <GuardrailLog
            violations={tabViolations}
            siteName={tabSite.name}
          />
        </div>
      )}

      {/* ── Agent system prompt edit modal ─────────────────────────── */}
      {editingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <h3 className="text-sm font-semibold text-white">
                  Edit System Prompt —{' '}
                  <span className="text-slate-300">
                    {editingAgent === 'supervisor' ? 'Supervisor Agent'
                      : editingAgent === 'guardrails' ? 'Guardrails Agent'
                      : 'Site Agent'}
                  </span>
                </h3>
              </div>
              <button
                onClick={() => { setEditingAgent(null); setConfigSaveError(null); }}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 pt-3 pb-2">
              <p className="text-[11px] text-slate-400">
                {editingAgent === 'supervisor' &&
                  "This prompt defines the Supervisor Agent's role and decision-making behavior. It is stored and displayed for reference — the supervisor's pacing logic is algorithmic."}
                {editingAgent === 'guardrails' &&
                  'This system prompt is sent to the LLM on every guardrail validation call. It determines how strictly queries are evaluated against persona profiles.'}
                {editingAgent === 'workerAgent' &&
                  "This prompt describes the Worker Agent's overarching behavior. It is stored as context; per-agent query prompts are configured in the agent settings."}
              </p>
            </div>

            <div className="flex-1 overflow-hidden px-5 pb-3 min-h-0">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={14}
                className="w-full h-full min-h-[280px] bg-slate-800 border border-slate-700 focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 rounded-lg px-3 py-2.5 text-[12px] text-slate-200 font-mono leading-relaxed resize-none outline-none transition-colors"
                spellCheck={false}
              />
            </div>

            {configSaveError && (
              <div className="mx-5 mb-3 flex items-center gap-2 bg-rose-900/20 border border-rose-800/50 rounded-lg px-3 py-2">
                <svg className="w-3.5 h-3.5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-rose-300">{configSaveError}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-700">
              <button
                onClick={() => { setEditingAgent(null); setConfigSaveError(null); }}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAgentConfig}
                disabled={isSavingConfig}
                className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {isSavingConfig ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Save Prompt
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
