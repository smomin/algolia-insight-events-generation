'use client';

import { useState, useCallback, useMemo } from 'react';
import type { SentEvent, SessionRecord } from '@/types';
import { useSSE } from '@/app/hooks/useSSE';

interface EventLogProps {
  siteId: string;
}

const EVENT_TYPE_STYLE: Record<string, string> = {
  view: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  click: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  conversion: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

function truncate(str: string, n = 14): string {
  if (!str) return '-';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function formatTime(ts: number | string): string {
  return new Date(ts).toLocaleTimeString();
}

interface SessionGroup {
  sessionId: string;
  session?: SessionRecord;
  events: SentEvent[];
  personaName: string;
  earliestAt: number;
}

function EventsTable({ events }: { events: SentEvent[] }) {
  return (
    <div className="border-t border-slate-700/50 bg-slate-900/40">
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
                <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                  {formatTime(sentEvent.sentAt)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${style}`}
                  >
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
                <td className="px-3 py-2 text-xs">
                  <span className={sentEvent.batchStatus === 200 ? 'text-emerald-400' : 'text-red-400'}>
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

export default function EventLog({ siteId }: EventLogProps) {
  const [events, setEvents] = useState<SentEvent[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const sseUrl = `/api/stream?siteId=${siteId}&types=event-log,session`;

  useSSE(sseUrl, ['event-log', 'session'], (type, rawData) => {
    if (type === 'event-log') {
      const data = rawData as { events: SentEvent[]; initial?: boolean; cleared?: boolean };
      if (data.initial || data.cleared) {
        setEvents(data.events ?? []);
      } else {
        setEvents((prev) =>
          [...(data.events ?? []).slice().reverse(), ...prev].slice(0, 500)
        );
      }
    } else if (type === 'session') {
      const data = rawData as {
        session?: SessionRecord;
        sessions?: SessionRecord[];
        initial?: boolean;
        cleared?: boolean;
      };
      if (data.initial || data.cleared) {
        setSessions(data.sessions ?? []);
      } else if (data.session) {
        setSessions((prev) => [data.session!, ...prev].slice(0, 200));
      }
    }
    setLastUpdated(new Date());
  });

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

  const fetchLog = useCallback(async () => {
    try {
      const [logRes, sessRes] = await Promise.all([
        fetch(`/api/event-log?siteId=${siteId}`),
        fetch(`/api/sessions?siteId=${siteId}&limit=200`),
      ]);
      if (logRes.ok) {
        const data = await logRes.json();
        setEvents(data.events ?? []);
      }
      if (sessRes.ok) {
        const data = await sessRes.json();
        setSessions(data.sessions ?? []);
      }
      setLastUpdated(new Date());
    } catch {
      /* ignore */
    }
  }, [siteId]);

  const handleClear = async () => {
    setLoading(true);
    try {
      await fetch(`/api/event-log?siteId=${siteId}`, { method: 'DELETE' });
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleSession = (sessionId: string) => {
    setExpandedSessionId((prev) => (prev === sessionId ? null : sessionId));
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <div>
          <h2 className="text-lg font-semibold text-white">Event Log</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {sessionGroups.length} sessions · {events.length} events · live via SSE
            {lastUpdated && (
              <span className="ml-2">· updated {lastUpdated.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchLog}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded border border-slate-600 hover:border-slate-400 transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={handleClear}
            disabled={loading || events.length === 0}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 px-2 py-1 rounded border border-red-800 hover:border-red-600 transition-colors"
          >
            Clear Log
          </button>
        </div>
      </div>

      <div className="overflow-y-auto max-h-96">
        {sessionGroups.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            No sessions yet. Run a session to see events here.
          </div>
        ) : (
          <div className="divide-y divide-slate-700/50">
            {sessionGroups.map((group) => {
              const isExpanded = expandedSessionId === group.sessionId;
              const success = group.session?.success;
              const hasStatus = group.session !== undefined;

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

                    <span className="text-xs text-slate-500 whitespace-nowrap w-20 flex-shrink-0">
                      {formatTime(group.earliestAt)}
                    </span>

                    <span className="text-xs font-medium text-slate-200 flex-1 min-w-0 truncate">
                      {group.personaName}
                    </span>

                    <span className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0">
                      {group.events.length} events
                    </span>

                    {hasStatus && (
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${
                          success
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : 'bg-red-500/20 text-red-400 border-red-500/30'
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
      </div>
    </div>
  );
}
