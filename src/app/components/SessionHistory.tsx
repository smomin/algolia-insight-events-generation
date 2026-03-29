'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { createLogger } from '@/lib/logger';

const log = createLogger('SessionHistory');

interface SessionRecord {
  id: string;
  agentId?: string;
  personaId: string;
  personaName: string;
  startedAt: string;
  completedAt: string;
  totalEventsCount: number;
  eventsByIndex: Record<string, number>;
  success: boolean;
  error?: string;
  primaryQuery?: string;
  secondaryQueries?: string[];
  failurePhase?: string;
}

interface SessionHistoryProps {
  agentId: string;
  isActive?: boolean;
  /** Live sessions streamed from the parent's SSE connection. When provided the
   *  component does not need its own SSE connection. */
  sessions?: SessionRecord[];
  /** Timestamp of the last SSE update received by the parent. */
  lastUpdated?: Date | null;
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function SessionHistory({ agentId, isActive = false, sessions: sessionsProp, lastUpdated: lastUpdatedProp }: SessionHistoryProps) {
  // Local state is used when the parent has no SSE data yet (before initial
  // snapshot arrives) or when the user presses Refresh to force a REST fetch.
  const [sessionsLocal, setSessionsLocal] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [localLastUpdated, setLocalLastUpdated] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Prefer parent-streamed data; fall back to locally fetched data.
  const sessions = sessionsProp ?? sessionsLocal;
  const lastUpdated = lastUpdatedProp !== undefined ? lastUpdatedProp : localLastUpdated;

  // If the parent hasn't pushed any sessions yet (undefined = not arrived),
  // auto-fetch via REST so the tab doesn't start empty.
  useEffect(() => {
    if (sessionsProp === undefined) {
      log.debug(`no SSE data from parent for "${agentId}" — fetching via REST`);
      fetchSessions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    log.debug(`fetching /api/sessions?agentId=${agentId}&limit=50`);
    try {
      const res = await fetch(`/api/sessions?agentId=${agentId}&limit=50`);
      log.debug(`fetch response status=${res.status} ok=${res.ok}`);
      if (res.ok) {
        const data = await res.json();
        const count = data.sessions?.length ?? 0;
        log.debug(`fetched ${count} sessions`);
        setSessionsLocal(data.sessions ?? []);
        setLocalLastUpdated(new Date());
      } else {
        const text = await res.text();
        log.error(`fetch failed — HTTP ${res.status}: ${text}`);
      }
    } catch (err) {
      log.error('fetch error', err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const handleClear = async () => {
    setLoading(true);
    try {
      await fetch(`/api/sessions?agentId=${agentId}`, { method: 'DELETE' });
      setSessionsLocal([]);
    } finally {
      setLoading(false);
    }
  };

  const successCount = sessions.filter((s) => s.success).length;
  const failCount = sessions.length - successCount;
  const totalEvents = sessions.reduce((s, r) => s + r.totalEventsCount, 0);
  const successRate = sessions.length > 0 ? Math.round((successCount / sessions.length) * 100) : 0;

  const allIndexIds = Array.from(
    new Set(sessions.flatMap((s) => Object.keys(s.eventsByIndex ?? {})))
  );

  // Group sessions by date for display
  const sessionsByDate: { date: string; sessions: SessionRecord[] }[] = [];
  for (const session of sessions) {
    const date = formatDate(session.startedAt);
    const group = sessionsByDate.find((g) => g.date === date);
    if (group) {
      group.sessions.push(session);
    } else {
      sessionsByDate.push({ date, sessions: [session] });
    }
  }

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setCollapsed((v) => !v)} className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-sm font-semibold text-white">Session History</h2>
          <span className="text-[10px] bg-slate-700 text-slate-400 border border-slate-600 px-1.5 py-0.5 rounded-full shrink-0">
            {sessions.length}
          </span>
          {isActive && (
            <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              LIVE
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {!collapsed && (
            <>
              <button
                onClick={fetchSessions}
                disabled={loading}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded border border-slate-600 hover:border-slate-400 transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {loading ? (
                  <span className="w-3 h-3 border border-slate-400/30 border-t-slate-400 rounded-full animate-spin" />
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                Refresh
              </button>
              <button
                onClick={handleClear}
                disabled={loading || sessions.length === 0}
                className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-40 px-2 py-1 rounded border border-rose-800/60 hover:border-rose-600 transition-colors"
              >
                Clear
              </button>
            </>
          )}
          <button onClick={() => setCollapsed((v) => !v)} className="text-slate-500 hover:text-slate-300 transition-colors">
            <svg
              className={`w-4 h-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Summary stats bar */}
      {!collapsed && sessions.length > 0 && (
        <div className="grid border-b border-slate-700 bg-slate-800/60" style={{
          gridTemplateColumns: `repeat(${3 + allIndexIds.length}, minmax(0, 1fr))`
        }}>
          {[
            { label: 'Sessions', value: sessions.length, sub: null, color: 'text-white' },
            ...allIndexIds.map((id, i) => ({
              label: id,
              value: sessions.reduce((s, r) => s + (r.eventsByIndex?.[id] ?? 0), 0),
              sub: null,
              color: i === 0 ? 'text-blue-400' : 'text-purple-400',
            })),
            { label: 'Total Events', value: totalEvents, sub: null, color: 'text-emerald-400' },
            {
              label: 'Success Rate',
              value: `${successRate}%`,
              sub: `${failCount > 0 ? `${failCount} failed` : 'all passed'}`,
              color: successRate === 100 ? 'text-emerald-400' : successRate >= 80 ? 'text-amber-400' : 'text-rose-400',
            },
          ].map(({ label, value, sub, color }) => (
            <div key={label} className="px-4 py-3 text-center border-r border-slate-700/50 last:border-r-0">
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-slate-500 mt-0.5 truncate">{label}</p>
              {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Session rows */}
      {!collapsed && <div className="overflow-y-auto max-h-[520px]">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <svg className="w-8 h-8 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-slate-500 text-sm">No sessions yet</p>
            <p className="text-slate-600 text-xs">Start the agent or run a persona manually to see history</p>
          </div>
        ) : (
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-slate-800/95 border-b border-slate-700">
                <tr>
                  {['Time', 'Persona', 'Query', ...allIndexIds, 'Total', 'Duration', 'Status'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessionsByDate.map(({ date, sessions: dateSessions }) => (
                  <React.Fragment key={`date-${date}`}>
                    <tr>
                      <td colSpan={5 + allIndexIds.length} className="px-3 py-1.5 bg-slate-900/30">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{date}</span>
                      </td>
                    </tr>
                    {dateSessions.map((session) => (
                      <React.Fragment key={session.id}>
                        <tr
                          className="border-b border-slate-700/40 hover:bg-slate-700/30 transition-colors cursor-pointer"
                          onClick={() => setExpandedId((p) => p === session.id ? null : session.id)}
                        >
                          <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                            {formatTime(session.startedAt)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-xs font-medium text-slate-200">{session.personaName}</div>
                            <div className="text-[10px] text-slate-600 truncate max-w-[120px]">{session.personaId}</div>
                          </td>
                          <td className="px-3 py-2 max-w-[200px]">
                            {session.primaryQuery ? (
                              <span className="text-[11px] text-slate-300 italic line-clamp-1" title={session.primaryQuery}>
                                &ldquo;{session.primaryQuery}&rdquo;
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-600">—</span>
                            )}
                          </td>
                          {allIndexIds.map((id, i) => (
                            <td key={id} className={`px-3 py-2 text-xs font-semibold tabular-nums ${i === 0 ? 'text-blue-400' : 'text-purple-400'}`}>
                              {session.eventsByIndex?.[id] ?? 0}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-xs text-emerald-400 font-semibold tabular-nums">
                            {session.totalEventsCount}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap tabular-nums">
                            {formatDuration(session.startedAt, session.completedAt)}
                          </td>
                          <td className="px-3 py-2">
                            {session.success ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                OK
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                ERR
                              </span>
                            )}
                          </td>
                        </tr>
                        {expandedId === session.id && (session.error || session.secondaryQueries?.length) && (
                          <tr key={`${session.id}-detail`} className={`border-b border-slate-700/40 ${session.error ? 'bg-rose-900/10' : 'bg-slate-900/30'}`}>
                            <td colSpan={5 + allIndexIds.length} className="px-4 py-2.5 space-y-2">
                              {session.primaryQuery && (
                                <div className="flex items-start gap-2">
                                  <svg className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                  </svg>
                                  <div>
                                    <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">Primary query</p>
                                    <p className="text-xs text-slate-300 italic">&ldquo;{session.primaryQuery}&rdquo;</p>
                                  </div>
                                </div>
                              )}
                              {session.secondaryQueries && session.secondaryQueries.length > 0 && (
                                <div className="flex items-start gap-2">
                                  <svg className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                  </svg>
                                  <div>
                                    <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">Secondary {session.secondaryQueries.length === 1 ? 'query' : 'queries'}</p>
                                    <div className="flex flex-wrap gap-1">
                                      {session.secondaryQueries.map((q, i) => (
                                        <span key={i} className="text-xs text-purple-300 italic bg-purple-900/20 border border-purple-800/40 rounded px-1.5 py-0.5">
                                          &ldquo;{q}&rdquo;
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}
                              {session.error && (
                                <div className="flex items-start gap-2">
                                  <svg className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  <div>
                                    <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-0.5">
                                      Error{session.failurePhase ? ` · ${session.failurePhase} phase` : ''}
                                    </p>
                                    <p className="text-xs text-rose-300 leading-snug">{session.error}</p>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
        )}
      </div>}
    </div>
  );
}
