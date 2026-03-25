'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { SentEvent, SessionRecord } from '@/types';

interface EventLogProps {
  agentId: string;
  /** Live events streamed from the parent's SSE connection. */
  events?: SentEvent[];
  /** Live sessions streamed from the parent's SSE connection. */
  sessions?: SessionRecord[];
  /** Timestamp of the last SSE update received by the parent. */
  lastUpdated?: Date | null;
}

const EVENT_TYPE_STYLE: Record<string, string> = {
  view:       'bg-blue-500/20 text-blue-400 border-blue-500/30',
  click:      'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  conversion: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const EVENT_TYPE_DOT: Record<string, string> = {
  view:       'bg-blue-400',
  click:      'bg-yellow-400',
  conversion: 'bg-emerald-400',
};

function truncate(str: string, n = 14): string {
  if (!str) return '-';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function formatTime(ts: number | string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface SessionGroup {
  sessionId: string;
  session?: SessionRecord;
  events: SentEvent[];
  personaName: string;
  earliestAt: number;
}

function EventsTable({ events }: { events: SentEvent[] }) {
  // Compute type distribution for this session
  const typeCounts = events.reduce<Record<string, number>>((acc, e) => {
    const t = e.event.eventType;
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="border-t border-slate-700/50 bg-slate-900/40">
      {/* Mini type bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700/30">
        {Object.entries(typeCounts).map(([type, count]) => (
          <span key={type} className="flex items-center gap-1 text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full ${EVENT_TYPE_DOT[type] ?? 'bg-slate-400'}`} />
            <span className="text-slate-400 capitalize">{type}</span>
            <span className="text-slate-500">×{count}</span>
          </span>
        ))}
        <span className="ml-auto text-[10px] text-slate-600">{events.length} events total</span>
      </div>
      <table className="w-full text-left">
        <thead className="bg-slate-900/60">
          <tr>
            {['Time', 'Type', 'Event Name', 'Index', 'ObjectID', 'QueryID', 'Status'].map((h) => (
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
          {events.map((sentEvent, i) => {
            const e = sentEvent.event;
            const style = EVENT_TYPE_STYLE[e.eventType] ?? 'bg-slate-700 text-slate-400 border-slate-600';
            return (
              <tr
                key={`${sentEvent.sentAt}-${i}`}
                className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors"
              >
                <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap tabular-nums">
                  {formatTime(sentEvent.sentAt)}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${style}`}>
                    {e.eventType}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-200 max-w-[160px] truncate">
                  {e.eventName}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400 font-mono whitespace-nowrap">
                  {e.index ?? '-'}
                </td>
                <td className="px-3 py-2 text-xs font-mono text-slate-500">
                  {truncate(e.objectIDs?.[0] ?? '', 14)}
                </td>
                <td className="px-3 py-2 text-xs font-mono text-slate-500">
                  {truncate(e.queryID ?? '', 10)}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                    sentEvent.batchStatus === 200
                      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                      : 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                  }`}>
                    {sentEvent.batchStatus}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function EventLog({ agentId, events: eventsProp, sessions: sessionsProp, lastUpdated: lastUpdatedProp }: EventLogProps) {
  // Local state is used when the parent has no SSE data yet (before initial
  // snapshot arrives) or when the user presses Refresh to force a REST fetch.
  const [eventsLocal, setEventsLocal] = useState<SentEvent[]>([]);
  const [sessionsLocal, setSessionsLocal] = useState<SessionRecord[]>([]);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [localLastUpdated, setLocalLastUpdated] = useState<Date | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Prefer parent-streamed data; fall back to locally fetched data.
  const events = eventsProp ?? eventsLocal;
  const sessions = sessionsProp ?? sessionsLocal;
  const lastUpdated = lastUpdatedProp !== undefined ? lastUpdatedProp : localLastUpdated;

  // If the parent hasn't pushed any events yet (undefined = not arrived),
  // auto-fetch via REST so the tab doesn't start empty.
  useEffect(() => {
    if (eventsProp === undefined) {
      console.debug(`[DEBUG:EventLog] no SSE data from parent for "${agentId}" — fetching via REST`);
      fetchLog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const map = new Map<string, SessionGroup>();

    for (const sentEvent of events) {
      const sid = sentEvent.sessionId ?? '__untracked__';
      if (!map.has(sid)) {
        const session = sessions.find((s) => s.id === sid);
        map.set(sid, {
          sessionId: sid,
          session,
          events: [],
          personaName: sentEvent.personaName ?? session?.personaName ?? '—',
          earliestAt: sentEvent.sentAt,
        });
      }
      const group = map.get(sid)!;
      group.events.push(sentEvent);
      if (sentEvent.sentAt < group.earliestAt) {
        group.earliestAt = sentEvent.sentAt;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.earliestAt - a.earliestAt);
  }, [events, sessions]);

  // Compute overall type distribution
  const typeDistribution = useMemo(() => {
    return events.reduce<Record<string, number>>((acc, e) => {
      const t = e.event.eventType;
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});
  }, [events]);

  const successCount = sessions.filter((s) => s.success).length;

  const fetchLog = useCallback(async () => {
    setLoading(true);
    console.debug(`[DEBUG:EventLog] fetching via REST for agentId="${agentId}"`);
    try {
      const [logRes, sessRes] = await Promise.all([
        fetch(`/api/event-log?agentId=${agentId}`),
        fetch(`/api/sessions?agentId=${agentId}&limit=200`),
      ]);
      console.debug(`[DEBUG:EventLog] fetch results — event-log status=${logRes.status} sessions status=${sessRes.status}`);
      if (logRes.ok) {
        const data = await logRes.json();
        console.debug(`[DEBUG:EventLog] event-log fetched ${data.events?.length ?? 0} events`);
        setEventsLocal(data.events ?? []);
      } else {
        const text = await logRes.text();
        console.error(`[DEBUG:EventLog] event-log fetch failed — HTTP ${logRes.status}:`, text);
      }
      if (sessRes.ok) {
        const data = await sessRes.json();
        console.debug(`[DEBUG:EventLog] sessions fetched ${data.sessions?.length ?? 0} sessions`);
        setSessionsLocal(data.sessions ?? []);
      } else {
        const text = await sessRes.text();
        console.error(`[DEBUG:EventLog] sessions fetch failed — HTTP ${sessRes.status}:`, text);
      }
      setLocalLastUpdated(new Date());
    } catch (err) {
      console.error(`[DEBUG:EventLog] fetch error:`, err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const handleClear = async () => {
    setLoading(true);
    try {
      await fetch(`/api/event-log?agentId=${agentId}`, { method: 'DELETE' });
      setEventsLocal([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleSession = (sessionId: string) => {
    setExpandedSessionId((prev) => (prev === sessionId ? null : sessionId));
  };

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setCollapsed((v) => !v)} className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h2 className="text-sm font-semibold text-white">Event Log</h2>
          <span className="text-[10px] bg-slate-700 text-slate-400 border border-slate-600 px-1.5 py-0.5 rounded-full shrink-0">
            {events.length}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {!collapsed && (
            <>
              {/* Type distribution pills */}
              {Object.entries(typeDistribution).length > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 mr-1">
                  {Object.entries(typeDistribution).map(([type, count]) => (
                    <span
                      key={type}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${EVENT_TYPE_STYLE[type] ?? 'bg-slate-700 text-slate-400 border-slate-600'}`}
                    >
                      {type} {count}
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={fetchLog}
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
                disabled={loading || events.length === 0}
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

      {/* Summary stats */}
      {!collapsed && sessionGroups.length > 0 && (
        <div className="grid grid-cols-3 border-b border-slate-700/50 bg-slate-800/60">
          <div className="px-4 py-2.5 text-center border-r border-slate-700/50">
            <p className="text-base font-bold text-white">{sessionGroups.length}</p>
            <p className="text-[10px] text-slate-500">Sessions</p>
          </div>
          <div className="px-4 py-2.5 text-center border-r border-slate-700/50">
            <p className="text-base font-bold text-emerald-400">{events.length}</p>
            <p className="text-[10px] text-slate-500">Events sent</p>
          </div>
          <div className="px-4 py-2.5 text-center">
            <p className={`text-base font-bold ${successCount === sessions.length && sessions.length > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {sessions.length > 0 ? `${Math.round((successCount / sessions.length) * 100)}%` : '—'}
            </p>
            <p className="text-[10px] text-slate-500">Success rate</p>
          </div>
        </div>
      )}

      {/* Session groups */}
      {!collapsed && <div className="overflow-y-auto max-h-[520px]">
        {sessionGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <svg className="w-8 h-8 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-slate-500 text-sm">No events yet</p>
            <p className="text-slate-600 text-xs">Start the agent or run a session to see events here</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700/50">
            {sessionGroups.map((group) => {
              const isExpanded = expandedSessionId === group.sessionId;
              const success = group.session?.success;
              const hasStatus = group.session !== undefined;
              const eventsToday = group.events.length;

              // Type breakdown for this group
              const groupTypes = group.events.reduce<Record<string, number>>((acc, e) => {
                const t = e.event.eventType;
                acc[t] = (acc[t] ?? 0) + 1;
                return acc;
              }, {});

              return (
                <div key={group.sessionId}>
                  <button
                    onClick={() => toggleSession(group.sessionId)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/30 transition-colors text-left"
                  >
                    <svg
                      className={`w-3 h-3 text-slate-500 flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>

                    <span className="text-xs text-slate-500 whitespace-nowrap w-[72px] flex-shrink-0 tabular-nums">
                      {formatTime(group.earliestAt)}
                    </span>

                    <span className="text-xs font-medium text-slate-200 flex-1 min-w-0 truncate">
                      {group.personaName}
                    </span>

                    {/* Type breakdown pills */}
                    <span className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                      {Object.entries(groupTypes).map(([type, count]) => (
                        <span key={type} className="flex items-center gap-0.5 text-[10px]">
                          <span className={`w-1.5 h-1.5 rounded-full ${EVENT_TYPE_DOT[type] ?? 'bg-slate-400'}`} />
                          <span className="text-slate-500 tabular-nums">{count}</span>
                        </span>
                      ))}
                    </span>

                    <span className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0 tabular-nums">
                      {eventsToday} events
                    </span>

                    {hasStatus && (
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${
                          success
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                            : 'bg-rose-500/15 text-rose-400 border-rose-500/25'
                        }`}
                      >
                        {success ? 'OK' : 'ERR'}
                      </span>
                    )}
                  </button>

                  {isExpanded && <EventsTable events={group.events} />}
                </div>
              );
            })}
          </div>
        )}
      </div>}
    </div>
  );
}
