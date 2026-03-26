'use client';

import { useState } from 'react';
import type { GuardrailResult } from '@/types';

interface Props {
  violations: GuardrailResult[];
  siteName?: string;
}

export default function GuardrailLog({ violations, siteName }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <h3 className="text-sm font-semibold text-white">Guardrail Log</h3>
          {siteName && (
            <span className="text-[10px] text-slate-500">— {siteName}</span>
          )}
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
          violations.length > 0
            ? 'text-amber-400 bg-amber-900/30 border-amber-800'
            : 'text-slate-500 bg-slate-800 border-slate-700'
        }`}>
          {violations.length} violation{violations.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* List */}
      <div className="max-h-64 overflow-y-auto divide-y divide-slate-700/50">
        {violations.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <svg className="w-8 h-8 text-slate-700 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-slate-500 text-sm">No guardrail violations</p>
            <p className="text-slate-600 text-xs mt-1">All queries have been persona-consistent</p>
          </div>
        ) : (
          violations.map((v) => {
            const key = `${v.timestamp}-${v.originalQuery}`;
            const isOpen = expanded === key;

            return (
              <div
                key={key}
                className="hover:bg-slate-700/20 transition-colors cursor-pointer"
                onClick={() => setExpanded(isOpen ? null : key)}
              >
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-medium text-amber-400 bg-amber-900/30 border border-amber-800 px-1.5 py-0.5 rounded shrink-0">
                        Attempt {v.attemptNumber}
                      </span>
                      <span className="text-xs text-slate-300 font-medium truncate">{v.personaName}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-slate-500">
                        {new Date(v.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <svg
                        className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Rejected query */}
                  <div className="flex items-start gap-1.5 mb-1">
                    <span className="text-[10px] text-rose-500 shrink-0 mt-0.5">✗</span>
                    <span className="text-[11px] text-rose-300/80 italic">&ldquo;{v.originalQuery}&rdquo;</span>
                  </div>

                  {/* Reason */}
                  <p className="text-[11px] text-slate-400 leading-relaxed">{v.reason}</p>

                  {/* Expanded: suggested query */}
                  {isOpen && v.suggestedQuery && (
                    <div className="mt-2 pt-2 border-t border-slate-700/50">
                      <div className="flex items-start gap-1.5">
                        <span className="text-[10px] text-emerald-500 shrink-0 mt-0.5">↗</span>
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Suggested alternative:</p>
                          <span className="text-[11px] text-emerald-300/80 italic">
                            &ldquo;{v.suggestedQuery}&rdquo;
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
