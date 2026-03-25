'use client';

import type { SupervisorDecision, SupervisorUrgency } from '@/types';

interface Props {
  decisions: SupervisorDecision[];
  isRunning: boolean;
  lastRunAt?: string;
}

const URGENCY_STYLES: Record<SupervisorUrgency, string> = {
  ahead: 'text-emerald-400 bg-emerald-900/30 border-emerald-800',
  normal: 'text-blue-400 bg-blue-900/30 border-blue-800',
  high: 'text-amber-400 bg-amber-900/30 border-amber-800',
  critical: 'text-rose-400 bg-rose-900/30 border-rose-800',
};

const URGENCY_DOT: Record<SupervisorUrgency, string> = {
  ahead: 'bg-emerald-400',
  normal: 'bg-blue-400',
  high: 'bg-amber-400',
  critical: 'bg-rose-400',
};

export default function SupervisorLog({ decisions, isRunning, lastRunAt }: Props) {
  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          <h3 className="text-sm font-semibold text-white">Supervisor Log</h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          {lastRunAt && (
            <span>
              Last run: {new Date(lastRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${
            isRunning
              ? 'text-emerald-400 bg-emerald-900/30 border-emerald-800'
              : 'text-slate-500 bg-slate-800 border-slate-700'
          }`}>
            {isRunning ? 'Active' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Decision list */}
      <div className="max-h-72 overflow-y-auto divide-y divide-slate-700/50">
        {decisions.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-500 text-sm">
            No supervisor decisions yet. Start the agent system to begin.
          </div>
        ) : (
          decisions.map((d) => (
            <div key={d.id} className="px-4 py-3 hover:bg-slate-700/20 transition-colors">
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base shrink-0">{getSiteIcon(d.siteName ?? (d as unknown as Record<string, string>).industryName)}</span>
                  <span className="text-sm text-slate-200 font-medium truncate">{d.siteName ?? (d as unknown as Record<string, string>).industryName}</span>
                  <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${URGENCY_STYLES[d.urgency]}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${URGENCY_DOT[d.urgency]}`} />
                    {d.urgency.toUpperCase()}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 shrink-0">
                  {new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed mb-2">{d.reasoning}</p>

              <div className="flex items-center gap-4 text-[10px]">
                <span className="text-slate-500">
                  Progress:{' '}
                  <span className="text-slate-300 font-medium">
                    {d.progressSnapshot.sent.toLocaleString()} / {d.progressSnapshot.target.toLocaleString()}
                  </span>
                  {' '}({d.progressSnapshot.percentComplete}%)
                </span>
                {d.sessionsDispatched > 0 && (
                  <span className="text-violet-400">
                    ↗ {d.sessionsDispatched} session{d.sessionsDispatched !== 1 ? 's' : ''} dispatched
                  </span>
                )}
                {d.sessionsDispatched === 0 && (
                  <span className="text-slate-600">No sessions dispatched</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function getSiteIcon(name: string | undefined): string {
  if (!name) return '🏭';
  const n = name.toLowerCase();
  if (n.includes('grocery') || n.includes('food')) return '🛒';
  if (n.includes('travel') || n.includes('hotel')) return '✈️';
  if (n.includes('fashion') || n.includes('cloth')) return '👗';
  if (n.includes('tech') || n.includes('electronic')) return '💻';
  if (n.includes('health') || n.includes('medical')) return '🏥';
  if (n.includes('sport') || n.includes('fitness')) return '🏃';
  if (n.includes('book')) return '📚';
  if (n.includes('music')) return '🎵';
  if (n.includes('beauty') || n.includes('cosmetic')) return '💄';
  return '🏭';
}
