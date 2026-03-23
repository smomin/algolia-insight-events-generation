'use client';

import { useEffect, useState, useCallback } from 'react';

interface SessionRecord {
  id: string;
  industryId: string;
  personaId: string;
  personaName: string;
  startedAt: string;
  completedAt: string;
  totalEventsCount: number;
  eventsByIndex: Record<string, number>;
  success: boolean;
  error?: string;
}

interface SessionHistoryProps {
  industryId: string;
  isActive?: boolean;  // true while a distribution run is in progress
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

export default function SessionHistory({ industryId, isActive = false }: SessionHistoryProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions?industryId=${industryId}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions ?? []);
        setLastUpdated(new Date());
      }
    } catch {
      // ignore
    }
  }, [industryId]);

  // Poll fast (2s) while a run is active, slow (15s) otherwise
  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, isActive ? 3_000 : 30_000);
    return () => clearInterval(interval);
  }, [fetchSessions, isActive]);

  const handleClear = async () => {
    setLoading(true);
    try {
      await fetch(`/api/sessions?industryId=${industryId}`, { method: 'DELETE' });
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  const successCount = sessions.filter((s) => s.success).length;
  const totalEvents = sessions.reduce((s, r) => s + r.totalEventsCount, 0);

  // Collect all unique index IDs across sessions (preserve order of appearance)
  const allIndexIds = Array.from(
    new Set(sessions.flatMap((s) => Object.keys(s.eventsByIndex ?? {})))
  );

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">Session History</h2>
            {isActive && (
              <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {sessions.length} sessions · {successCount} successful
            {isActive
              ? <span className="ml-2 text-amber-500">· refreshing every 3s</span>
              : <span className="ml-2">· auto-refreshes every 30s</span>
            }
            {lastUpdated && <span className="ml-2">· updated {lastUpdated.toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchSessions}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded border border-slate-600 hover:border-slate-400 transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={handleClear}
            disabled={loading || sessions.length === 0}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 px-2 py-1 rounded border border-red-800 hover:border-red-600 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Summary stats */}
      {sessions.length > 0 && (
        <div className="grid border-b border-slate-700" style={{ gridTemplateColumns: `repeat(${2 + allIndexIds.length}, minmax(0, 1fr))` }}>
          {[
            { label: 'Sessions', value: sessions.length, color: 'text-white' },
            ...allIndexIds.map((id, i) => ({
              label: id,
              value: sessions.reduce((s, r) => s + (r.eventsByIndex?.[id] ?? 0), 0),
              color: i === 0 ? 'text-blue-400' : 'text-purple-400',
            })),
            { label: 'Total Events', value: totalEvents, color: 'text-emerald-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="px-4 py-3 text-center border-r border-slate-700 last:border-r-0">
              <p className={`text-xl font-bold ${color}`}>{value.toLocaleString()}</p>
              <p className="text-[10px] text-slate-500 mt-0.5 truncate">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Session rows */}
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="flex items-center justify-center h-28 text-slate-500 text-sm">
            No sessions yet. Run a session to see history here.
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-slate-800 border-b border-slate-700">
              <tr>
                {['Time', 'Persona', ...allIndexIds, 'Total', 'Duration', 'Status / Error'].map((h) => (
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
              {sessions.map((session) => (
                <tr
                  key={session.id}
                  className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                >
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {formatTime(session.startedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-xs font-medium text-slate-200">{session.personaName}</div>
                    <div className="text-[10px] text-slate-600">{session.personaId}</div>
                  </td>
                  {allIndexIds.map((id, i) => (
                    <td key={id} className={`px-3 py-2 text-xs font-semibold ${i === 0 ? 'text-blue-400' : 'text-purple-400'}`}>
                      {session.eventsByIndex?.[id] ?? 0}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs text-emerald-400 font-semibold">
                    {session.totalEventsCount}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {formatDuration(session.startedAt, session.completedAt)}
                  </td>
                  <td className="px-3 py-2">
                    {session.success ? (
                      <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        OK
                      </span>
                    ) : (
                      <div className="relative group inline-block">
                        <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full cursor-help">
                          ERR
                        </span>
                        {session.error && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover:block w-64 bg-slate-800 border border-red-500/30 rounded-lg shadow-xl px-3 py-2">
                            <p className="text-xs text-red-300 leading-snug break-words">{session.error}</p>
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
