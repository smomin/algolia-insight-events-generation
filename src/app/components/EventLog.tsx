'use client';

import { useEffect, useState, useCallback } from 'react';
import type { SentEvent } from '@/types';

interface EventLogProps {
  industryId: string;
  isActive?: boolean;
}

const EVENT_TYPE_STYLE: Record<string, string> = {
  view: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  click: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  conversion: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

function truncate(str: string, n = 12): string {
  if (!str) return '-';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function EventRow({ event: sentEvent }: { event: SentEvent }) {
  const e = sentEvent.event;
  const style = EVENT_TYPE_STYLE[e.eventType] ?? 'bg-slate-700 text-slate-400';

  return (
    <tr className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
      <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
        {formatTime(sentEvent.sentAt)}
      </td>
      <td className="px-3 py-2 text-xs text-slate-300 max-w-[100px] truncate">
        {sentEvent.personaName ?? '—'}
      </td>
      <td className="px-3 py-2">
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${style}`}
        >
          {e.eventType}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-slate-200 max-w-[140px] truncate">
        {e.eventName}
      </td>
      <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">
        {e.index?.split('_').slice(-1)[0] ?? truncate(e.index ?? '', 14)}
      </td>
      <td className="px-3 py-2 text-xs font-mono text-slate-500">
        {truncate(e.objectIDs?.[0] ?? '', 14)}
      </td>
      <td className="px-3 py-2 text-xs font-mono text-slate-500">
        {truncate(e.queryID ?? '', 10)}
      </td>
      <td className="px-3 py-2 text-xs">
        <span
          className={`${sentEvent.batchStatus === 200 ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {sentEvent.batchStatus}
        </span>
      </td>
    </tr>
  );
}

export default function EventLog({ industryId, isActive = false }: EventLogProps) {
  const [events, setEvents] = useState<SentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`/api/event-log?industryId=${industryId}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
        setLastUpdated(new Date());
      }
    } catch {
      // ignore
    }
  }, [industryId]);

  useEffect(() => {
    fetchLog();
    const interval = setInterval(fetchLog, isActive ? 4_000 : 30_000);
    return () => clearInterval(interval);
  }, [fetchLog, isActive]);

  const handleClear = async () => {
    setLoading(true);
    try {
      await fetch(`/api/event-log?industryId=${industryId}`, {
        method: 'DELETE',
      });
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
        <div>
          <h2 className="text-lg font-semibold text-white">Event Log</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {events.length} events · auto-refreshes every 10s
            {lastUpdated && (
              <span className="ml-2">
                · updated {lastUpdated.toLocaleTimeString()}
              </span>
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

      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            No events yet. Run a session to see events here.
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-slate-800 border-b border-slate-700">
              <tr>
                {[
                  'Time',
                  'Persona',
                  'Type',
                  'Event Name',
                  'Index',
                  'ObjectID',
                  'QueryID',
                  'Status',
                ].map((h) => (
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
              {events.slice(0, 100).map((e, i) => (
                <EventRow key={`${e.sentAt}-${i}`} event={e} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
