'use client';

import { useState } from 'react';

interface SessionNotification {
  personaId: string;
  personaName?: string;
  totalEvents: number;
  industryId?: string;
  error?: string;
  timestamp: number;
}

interface SessionCardProps {
  session: SessionNotification | null;
}

export default function SessionCard({ session }: SessionCardProps) {
  const [expanded, setExpanded] = useState(true);

  if (!session) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-2">Latest Session</h2>
        <p className="text-slate-500 text-sm">
          No sessions run yet. Click &quot;Run Session&quot; on any persona card to begin.
        </p>
      </div>
    );
  }

  const success = !session.error && session.totalEvents > 0;

  return (
    <div className={`bg-slate-800 rounded-xl border p-5 ${success ? 'border-emerald-700/50' : 'border-red-700/50'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${success ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <div>
            <h2 className="text-lg font-semibold text-white">Latest Session</h2>
            <p className="text-xs text-slate-500">
              {new Date(session.timestamp).toLocaleTimeString()} ·{' '}
              {session.personaName ?? session.personaId}
              {session.industryId && (
                <span className="ml-2 text-slate-600">· {session.industryId}</span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-slate-400 hover:text-white transition-colors"
        >
          {expanded ? 'Collapse ↑' : 'Expand ↓'}
        </button>
      </div>

      {expanded && (
        <div className="mt-4">
          {session.error ? (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-sm text-red-400 break-words">
              <p className="font-medium mb-0.5">Error</p>
              {session.error}
            </div>
          ) : session.totalEvents > 0 ? (
            <div className="bg-slate-700/50 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-emerald-400">{session.totalEvents}</p>
              <p className="text-sm text-slate-400 mt-1">Events Sent</p>
            </div>
          ) : (
            <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-3 text-sm text-amber-400">
              <p className="font-medium mb-0.5">No events generated</p>
              <p className="text-xs text-amber-500 mt-1">
                Check that your indices have events configured and that API credentials are set in App Settings.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
