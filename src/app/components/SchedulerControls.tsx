'use client';

import { useEffect, useState, useCallback } from 'react';

interface SchedulerStatus {
  isRunning: boolean;
  isDistributing: boolean;
  cancelRequested: boolean;
  nextRun: string | null;
  currentRun: { sessionsCompleted: number; errors: string[] } | null;
  lastRun: {
    id: string;
    startedAt: string;
    completedAt?: string;
    sessionsCompleted: number;
    totalEventsSent: number;
    eventsByIndex: Record<string, number>;
    errors: string[];
  } | null;
}

interface SchedulerControlsProps {
  industryId: string;
  industryName: string;
  onStatusChange?: (status: SchedulerStatus) => void;
}

export default function SchedulerControls({
  industryId,
  industryName,
  onStatusChange,
}: SchedulerControlsProps) {
  const [status, setStatus] = useState<SchedulerStatus>({
    isRunning: false,
    isDistributing: false,
    cancelRequested: false,
    nextRun: null,
    currentRun: null,
    lastRun: null,
  });
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string>('');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/scheduler/status?industryId=${industryId}`);
      if (res.ok) {
        const data = await res.json();
        const s: SchedulerStatus = {
          isRunning: data.isRunning ?? false,
          isDistributing: data.isDistributing ?? false,
          cancelRequested: data.cancelRequested ?? false,
          nextRun: data.nextRun ?? null,
          currentRun: data.currentRun ?? null,
          lastRun: data.lastRun ?? null,
        };
        setStatus(s);
        onStatusChange?.(s);
      }
    } catch {
      // ignore
    }
  }, [industryId, onStatusChange]);

  // Poll fast while a run is in progress, slow when idle
  const pollInterval = status.isDistributing ? 3_000 : status.isRunning ? 30_000 : 60_000;

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, pollInterval]);

  // Countdown to next run
  useEffect(() => {
    if (!status.nextRun) { setCountdown(''); return; }
    const update = () => {
      const diff = new Date(status.nextRun!).getTime() - Date.now();
      if (diff <= 0) { setCountdown('Running soon...'); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1000);
      setCountdown(`${h}h ${m}m ${s}s`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [status.nextRun]);

  const apiFetch = async (url: string, body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* non-JSON */ }
    if (!res.ok || data.error) {
      setApiError((data.error as string | undefined) ?? `HTTP ${res.status}`);
      return false;
    }
    setApiError(null);
    return true;
  };

  const post = async (body: Record<string, unknown>) => {
    setLoading(true);
    try {
      await apiFetch('/api/scheduler/start', { ...body, industryId });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await apiFetch('/api/scheduler/stop', { industryId });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  const handleRunAllPersonas = async () => {
    setLoading(true);
    try {
      await apiFetch('/api/run-all', { industryId });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  const cronExpr = process.env.NEXT_PUBLIC_SCHEDULER_CRON ?? '0 6 * * *';
  const isActive = status.isRunning || status.isDistributing;

  const handleStopRun = async () => {
    setLoading(true);
    try {
      await apiFetch('/api/scheduler/stop', { industryId });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Scheduler</h2>
          <p className="text-xs text-slate-500 mt-0.5">{industryName}</p>
        </div>
        <div className="flex items-center gap-2">
          {status.isDistributing && (
            <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
              status.cancelRequested
                ? 'bg-slate-600/40 text-slate-400 border border-slate-600/50'
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${status.cancelRequested ? 'bg-slate-400' : 'bg-amber-400'}`} />
              {status.cancelRequested ? 'Stopping…' : 'Distributing'}
            </span>
          )}
          <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
            status.isRunning
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-slate-700 text-slate-400 border border-slate-600'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {status.isRunning ? 'Scheduled' : 'Stopped'}
          </span>
        </div>
      </div>

      <div className="space-y-2 mb-4 text-sm">
        <div className="flex justify-between text-slate-400">
          <span>Schedule</span>
          <code className="text-slate-300 bg-slate-700 px-2 py-0.5 rounded text-xs">{cronExpr}</code>
        </div>
        {status.nextRun && (
          <div className="flex justify-between text-slate-400">
            <span>Next run</span>
            <span className="text-slate-300">{countdown || new Date(status.nextRun).toLocaleTimeString()}</span>
          </div>
        )}
        {status.currentRun && (
          <div className="flex justify-between text-slate-400">
            <span>Sessions done</span>
            <span className="text-amber-400 font-semibold">{status.currentRun.sessionsCompleted} running…</span>
          </div>
        )}
      </div>

      {status.lastRun && !status.currentRun && (
        <div className="bg-slate-700/50 rounded-lg p-3 mb-4 text-xs space-y-1">
          <p className="text-slate-400 font-medium">Last run</p>
          <div className="flex justify-between text-slate-300">
            <span>Sessions</span>
            <span>{status.lastRun.sessionsCompleted}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Total events sent</span>
            <span className="text-blue-400">{status.lastRun.totalEventsSent}</span>
          </div>
          {Object.entries(status.lastRun.eventsByIndex ?? {}).map(([indexId, count]) => (
            <div key={indexId} className="flex justify-between text-slate-400 pl-2">
              <span>{indexId}</span>
              <span>{count}</span>
            </div>
          ))}
          {status.lastRun.errors.length > 0 && (
            <div className="flex justify-between text-slate-300">
              <span>Errors</span>
              <span className="text-red-400 font-semibold">
                {status.lastRun.errors.length} — see Session History
              </span>
            </div>
          )}
        </div>
      )}

      {apiError && (
        <div className="mb-3 bg-red-900/20 border border-red-700/50 rounded-lg px-3 py-2 text-xs text-red-400 break-words">
          <span className="font-medium">Error: </span>{apiError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {/* Cron schedule toggle */}
        {status.isRunning ? (
          <button
            onClick={handleStop}
            disabled={loading}
            className="col-span-1 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Stop Scheduler
          </button>
        ) : (
          <button
            onClick={() => post({})}
            disabled={loading}
            className="col-span-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Start Scheduler
          </button>
        )}

        {/* Trigger / Stop run */}
        {status.isDistributing ? (
          <button
            onClick={handleStopRun}
            disabled={loading || status.cancelRequested}
            className={`col-span-1 px-3 py-2 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${
              status.cancelRequested
                ? 'bg-slate-600 cursor-not-allowed'
                : 'bg-orange-600 hover:bg-orange-700'
            }`}
          >
            {status.cancelRequested ? (
              <>
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse" />
                Stopping…
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                Stop Run
              </>
            )}
          </button>
        ) : (
          <button
            onClick={() => post({ runNow: true })}
            disabled={loading || isActive}
            className="col-span-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Trigger Now
          </button>
        )}

        <button
          onClick={handleRunAllPersonas}
          disabled={loading || isActive}
          className="col-span-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Run All Personas
        </button>
      </div>
    </div>
  );
}
