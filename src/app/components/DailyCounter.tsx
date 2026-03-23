'use client';

import { useEffect, useState, useCallback } from 'react';
import type { FlexIndex } from '@/types';

interface DailyCounterProps {
  industryId: string;
  indices: FlexIndex[];
  eventLimit: number;
}

function ProgressBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const barColor = pct < 50 ? 'bg-emerald-500' : pct < 80 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-slate-300 truncate max-w-[60%]">{label}</span>
        <span className="text-sm font-bold text-slate-200 tabular-nums">
          {value.toLocaleString()} <span className="text-slate-500 font-normal">/ {max.toLocaleString()}</span>
        </span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-2.5 rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-slate-500 mt-0.5">{pct.toFixed(1)}% used</p>
    </div>
  );
}

export default function DailyCounter({ industryId, indices, eventLimit }: DailyCounterProps) {
  const [byIndex, setByIndex] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchCounters = useCallback(async () => {
    try {
      const res = await fetch(`/api/scheduler/status?industryId=${industryId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.counters?.byIndex) {
          setByIndex(data.counters.byIndex as Record<string, number>);
          setLastUpdated(new Date());
        }
      }
    } catch {
      // ignore
    }
  }, [industryId]);

  useEffect(() => {
    fetchCounters();
    const interval = setInterval(fetchCounters, 30_000);
    return () => clearInterval(interval);
  }, [fetchCounters]);

  const totalEvents = Object.values(byIndex).reduce((s, n) => s + n, 0);
  const totalLimit = eventLimit * Math.max(indices.length, 1);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Daily Event Budget</h2>
        <button
          onClick={fetchCounters}
          className="text-xs text-slate-400 hover:text-white transition-colors px-2 py-1 rounded border border-slate-600 hover:border-slate-400"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-4">
        {indices.map((idx) => (
          <ProgressBar
            key={idx.id}
            label={idx.label || idx.id}
            value={byIndex[idx.id] ?? 0}
            max={eventLimit}
          />
        ))}
        {indices.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-2">No indices configured</p>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-700">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Total Events Today</span>
          <span className="font-bold text-white tabular-nums">
            {totalEvents.toLocaleString()}
            <span className="text-slate-500 font-normal"> / {totalLimit.toLocaleString()}</span>
          </span>
        </div>
        {lastUpdated && (
          <p className="text-xs text-slate-500 mt-1 text-right">
            Updated {lastUpdated.toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}
