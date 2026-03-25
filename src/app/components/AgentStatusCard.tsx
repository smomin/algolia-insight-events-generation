'use client';

import type { AgentState, AgentPhase } from '@/types';

interface AlgoliaAppInfo {
  name: string;
  appId: string;
  isOverride?: boolean;
}

interface LLMProviderInfo {
  name: string;
  model: string;
  isOverride?: boolean;
}

interface Props {
  siteName: string;
  siteIcon: string;
  siteColor: string;
  state: AgentState;
  dailyTarget: number;
  personaCount?: number;
  algoliaApp?: AlgoliaAppInfo;
  llmProvider?: LLMProviderInfo;
  expanded?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onViewDetails?: () => void;
}

const PHASE_LABEL: Record<AgentPhase, string> = {
  idle: 'Idle',
  planning: 'Planning query…',
  validating: 'Validating…',
  searching: 'Searching Algolia…',
  sending: 'Sending events…',
  complete: 'Session complete',
  error: 'Error',
};

const PHASE_COLOR: Record<AgentPhase, string> = {
  idle: 'text-slate-400 bg-slate-800 border-slate-700',
  planning: 'text-violet-300 bg-violet-900/40 border-violet-700',
  validating: 'text-amber-300 bg-amber-900/40 border-amber-700',
  searching: 'text-blue-300 bg-blue-900/40 border-blue-700',
  sending: 'text-emerald-300 bg-emerald-900/40 border-emerald-700',
  complete: 'text-emerald-400 bg-emerald-900/30 border-emerald-800',
  error: 'text-rose-400 bg-rose-900/30 border-rose-800',
};

const PHASE_PULSE: Record<AgentPhase, boolean> = {
  idle: false,
  planning: true,
  validating: true,
  searching: true,
  sending: true,
  complete: false,
  error: false,
};

const ACCENT: Record<string, string> = {
  blue: 'text-blue-400', emerald: 'text-emerald-400', rose: 'text-rose-400',
  amber: 'text-amber-400', violet: 'text-violet-400', cyan: 'text-cyan-400',
  orange: 'text-orange-400', pink: 'text-pink-400', teal: 'text-teal-400',
  indigo: 'text-indigo-400', lime: 'text-lime-400', red: 'text-red-400',
};

const BAR_COLOR: Record<string, string> = {
  blue: 'bg-blue-500', emerald: 'bg-emerald-500', rose: 'bg-rose-500',
  amber: 'bg-amber-500', violet: 'bg-violet-500', cyan: 'bg-cyan-500',
  orange: 'bg-orange-500', pink: 'bg-pink-500', teal: 'bg-teal-500',
  indigo: 'bg-indigo-500', lime: 'bg-lime-500', red: 'bg-red-500',
};

export default function AgentStatusCard({
  siteName,
  siteIcon,
  siteColor,
  state,
  dailyTarget,
  personaCount,
  algoliaApp,
  llmProvider,
  expanded,
  onEdit,
  onDelete,
  onViewDetails,
}: Props) {
  const progressPct =
    dailyTarget > 0 ? Math.min(100, Math.round((state.eventsSentToday / dailyTarget) * 100)) : 0;

  const sessionPct =
    state.sessionsTarget > 0
      ? Math.min(100, Math.round((state.sessionsCompleted / state.sessionsTarget) * 100))
      : 0;

  const phaseColorClass = PHASE_COLOR[state.phase] ?? PHASE_COLOR.idle;
  const isPulsing = PHASE_PULSE[state.phase];
  const barColor = BAR_COLOR[siteColor] ?? 'bg-blue-500';
  const accentColor = ACCENT[siteColor] ?? 'text-blue-400';

  return (
    <div className={`bg-slate-800/60 border rounded-xl p-4 flex flex-col gap-3 transition-all ${
      state.isActive ? 'border-slate-600 shadow-lg shadow-slate-900/50' : 'border-slate-700'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">{siteIcon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className={`text-sm font-semibold truncate ${accentColor}`}>{siteName}</p>
              {onViewDetails && (
                <button
                  onClick={onViewDetails}
                  title="View details"
                  className="shrink-0 text-slate-600 hover:text-blue-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              {onEdit && (
                <button
                  onClick={onEdit}
                  title="Edit agent"
                  className="shrink-0 text-slate-600 hover:text-slate-300 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              {onDelete && (
                <button
                  onClick={onDelete}
                  title="Delete agent"
                  className="shrink-0 text-slate-700 hover:text-rose-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {state.isActive ? 'Agent active' : 'Agent standby'}
            </p>
          </div>
        </div>
        {/* Phase badge */}
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg border whitespace-nowrap shrink-0 ${phaseColorClass}`}
        >
          {isPulsing && (
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          )}
          {PHASE_LABEL[state.phase]}
        </span>
      </div>

      {/* Algolia App + LLM pills */}
      {(algoliaApp || llmProvider) && (
        <div className="flex flex-wrap gap-1.5">
          {algoliaApp && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-slate-900/60 border border-slate-700/80 text-slate-400 px-2 py-0.5 rounded-full">
              <svg className="w-2.5 h-2.5 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
              </svg>
              <span className="text-blue-300 font-medium">{algoliaApp.name}</span>
              <span className="text-slate-600">·</span>
              <span className="font-mono text-slate-500">{algoliaApp.appId}</span>
              {algoliaApp.isOverride && (
                <span className="text-blue-400/60 italic ml-0.5">override</span>
              )}
            </span>
          )}
          {llmProvider && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-slate-900/60 border border-slate-700/80 text-slate-400 px-2 py-0.5 rounded-full">
              <svg className="w-2.5 h-2.5 text-violet-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
              </svg>
              <span className="text-violet-300 font-medium">{llmProvider.name}</span>
              <span className="text-slate-600">·</span>
              <span className="font-mono text-slate-500">{llmProvider.model}</span>
              {llmProvider.isOverride && (
                <span className="text-violet-400/60 italic ml-0.5">override</span>
              )}
            </span>
          )}
        </div>
      )}

      {/* No-personas warning */}
      {personaCount === 0 && (
        <div className="flex items-center gap-1.5 bg-amber-900/20 border border-amber-800/40 rounded-lg px-2.5 py-1.5">
          <svg className="w-3 h-3 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-[10px] text-amber-400">No personas — click the agent tab to generate some</span>
        </div>
      )}
      {personaCount !== undefined && personaCount > 0 && !state.currentPersonaName && (
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[10px] text-slate-600">{personaCount} persona{personaCount !== 1 ? 's' : ''} ready</span>
        </div>
      )}

      {/* Current persona + query */}
      {state.currentPersonaName && (
        <div className="bg-slate-900/60 rounded-lg px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5">
            <svg className="w-3 h-3 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-[11px] text-slate-300 font-medium">{state.currentPersonaName}</span>
          </div>
          {state.currentQuery && (
            <div className="flex items-start gap-1.5">
              <svg className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-[11px] text-slate-400 italic leading-snug line-clamp-2">
                &ldquo;{state.currentQuery}&rdquo;
              </span>
            </div>
          )}
        </div>
      )}

      {/* Daily progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-500">Daily target</span>
          <span className="text-[10px] text-slate-400">
            {state.eventsSentToday.toLocaleString()} / {dailyTarget.toLocaleString()} events
          </span>
        </div>
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-[10px] text-slate-600 mt-0.5 text-right">{progressPct}%</p>
      </div>

      {/* Session progress (when active) */}
      {state.isActive && state.sessionsTarget > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-500">Current batch</span>
            <span className="text-[10px] text-slate-400">
              {state.sessionsCompleted} / {state.sessionsTarget} sessions
            </span>
          </div>
          <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-500"
              style={{ width: `${sessionPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-slate-500">
        {state.guardrailViolations > 0 && (
          <span className="flex items-center gap-1 text-amber-500">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {state.guardrailViolations} guardrail {state.guardrailViolations === 1 ? 'hit' : 'hits'}
          </span>
        )}
        {state.errors.length > 0 && (
          <span className="flex items-center gap-1 text-rose-500">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            {state.errors.length} {state.errors.length === 1 ? 'error' : 'errors'}
          </span>
        )}
        <span className="ml-auto">
          {new Date(state.lastActivity).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Latest error */}
      {state.errors.length > 0 && (
        <p className="text-[10px] text-rose-400/80 bg-rose-900/20 border border-rose-900/40 rounded px-2 py-1 line-clamp-2">
          {state.errors[state.errors.length - 1]}
        </p>
      )}

      {/* Expanded: sessions completed stat */}
      {expanded && state.sessionsCompleted > 0 && (
        <div className="pt-2 border-t border-slate-700/50 grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="text-lg font-bold text-white">{state.sessionsCompleted}</p>
            <p className="text-[10px] text-slate-500">Sessions completed</p>
          </div>
          <div>
            <p className="text-lg font-bold text-emerald-400">{state.eventsSentToday.toLocaleString()}</p>
            <p className="text-[10px] text-slate-500">Events today</p>
          </div>
        </div>
      )}
    </div>
  );
}
