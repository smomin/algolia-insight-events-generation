'use client';

import type { AgentState, AgentPhase } from '@/types';

interface Props {
  industryName: string;
  industryIcon: string;
  industryColor: string;
  state: AgentState;
  dailyTarget: number;
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
  industryName,
  industryIcon,
  industryColor,
  state,
  dailyTarget,
}: Props) {
  const progressPct =
    dailyTarget > 0 ? Math.min(100, Math.round((state.eventsSentToday / dailyTarget) * 100)) : 0;

  const sessionPct =
    state.sessionsTarget > 0
      ? Math.min(100, Math.round((state.sessionsCompleted / state.sessionsTarget) * 100))
      : 0;

  const phaseColorClass = PHASE_COLOR[state.phase] ?? PHASE_COLOR.idle;
  const isPulsing = PHASE_PULSE[state.phase];
  const barColor = BAR_COLOR[industryColor] ?? 'bg-blue-500';
  const accentColor = ACCENT[industryColor] ?? 'text-blue-400';

  return (
    <div className={`bg-slate-800/60 border rounded-xl p-4 flex flex-col gap-3 transition-all ${
      state.isActive ? 'border-slate-600 shadow-lg' : 'border-slate-700'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{industryIcon}</span>
          <div>
            <p className={`text-sm font-semibold ${accentColor}`}>{industryName}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {state.isActive ? 'Agent active' : 'Agent standby'}
            </p>
          </div>
        </div>
        {/* Phase badge */}
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg border whitespace-nowrap ${phaseColorClass}`}
        >
          {isPulsing && (
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          )}
          {PHASE_LABEL[state.phase]}
        </span>
      </div>

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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M6 18L18 6M6 6l12 12" />
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
    </div>
  );
}
