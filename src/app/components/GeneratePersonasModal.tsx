'use client';

import { useEffect, useRef, useState } from 'react';
import type { Persona } from '@/types';

interface GeneratePersonasModalProps {
  siteId: string;
  siteName: string;
  onComplete: (newPersonas: Persona[]) => void;
  onClose: () => void;
}

type Phase = 'idle' | 'sampling' | 'generating' | 'done' | 'error';

interface LogLine {
  type: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

const PHASE_LABELS: Record<Phase, string> = {
  idle: '',
  sampling: 'Sampling index records…',
  generating: 'Generating personas with AI…',
  done: 'Done!',
  error: 'Generation failed',
};

export default function GeneratePersonasModal({
  siteId,
  siteName,
  onComplete,
  onClose,
}: GeneratePersonasModalProps) {
  const [count, setCount] = useState(5);
  const [append, setAppend] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<LogLine[]>([]);
  const [result, setResult] = useState<{
    generated: Persona[];
    total: number;
    indicesSampled: { indexId: string; label: string; recordsFetched: number }[];
  } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase === 'idle') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, onClose]);

  const addLog = (type: LogLine['type'], text: string) =>
    setLog((prev) => [...prev, { type, text }]);

  const handleGenerate = async () => {
    setPhase('sampling');
    setLog([]);
    setResult(null);
    addLog('info', `Fetching sample records from indices for "${siteName}"…`);

    try {
      setPhase('generating');
      addLog('info', `Asking Claude to generate ${count} personas…`);

      const res = await fetch(`/api/sites/${siteId}/generate-personas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, append }),
      });

      const data = (await res.json()) as {
        generated?: Persona[];
        total?: number;
        indicesSampled?: { indexId: string; label: string; recordsFetched: number }[];
        totalRecordsSampled?: number;
        error?: string;
      };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      // Log index sampling results
      for (const idx of data.indicesSampled ?? []) {
        if (idx.recordsFetched > 0) {
          addLog('success', `  ✓ "${idx.label}": ${idx.recordsFetched} records sampled`);
        } else {
          addLog('warn', `  ⚠ "${idx.label}": no records found (index may be empty or misconfigured)`);
        }
      }

      addLog('success', `Generated ${data.generated?.length ?? 0} personas`);
      addLog('info', `Total personas for site: ${data.total ?? 0}`);

      setResult({
        generated: data.generated ?? [],
        total: data.total ?? 0,
        indicesSampled: data.indicesSampled ?? [],
      });
      setPhase('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('error', `Error: ${msg}`);
      setPhase('error');
    }
  };

  const handleDone = () => {
    if (result) onComplete(result.generated);
    onClose();
  };

  const isRunning = phase === 'sampling' || phase === 'generating';
  const isDone = phase === 'done';
  const isError = phase === 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={!isRunning ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative z-10 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-white">Generate Personas</h2>
            <p className="text-xs text-slate-400 mt-0.5">{siteName}</p>
          </div>
          {!isRunning && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors text-xl leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Config inputs — shown only in idle/error state */}
          {(phase === 'idle' || isError) && (
            <>
              <div className="bg-slate-800 rounded-xl p-4 text-xs text-slate-400 leading-relaxed">
                AI will sample up to <span className="text-white font-medium">25 records</span> from
                each configured Algolia index to understand what's stored there, then generate
                realistic personas that would search and interact with that content.
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Number of personas to generate
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                      className="flex-1 accent-blue-500"
                    />
                    <span className="w-10 text-center text-white font-semibold text-lg tabular-nums">
                      {count}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span>1</span>
                    <span>25</span>
                    <span>50</span>
                    <span>75</span>
                    <span>100</span>
                  </div>
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={append}
                      onChange={(e) => setAppend(e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className={`w-10 h-5 rounded-full transition-colors ${append ? 'bg-blue-600' : 'bg-slate-600'}`}
                    />
                    <div
                      className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${append ? 'translate-x-5' : ''}`}
                    />
                  </div>
                  <div>
                    <span className="text-sm text-slate-300">Add to existing personas</span>
                    <p className="text-xs text-slate-500">
                      {append
                        ? 'New personas will be appended to the current list'
                        : 'Existing personas will be replaced'}
                    </p>
                  </div>
                </label>
              </div>
            </>
          )}

          {/* Progress / log */}
          {(isRunning || isDone || isError) && (
            <div className="flex flex-col gap-3">
              {/* Phase indicator */}
              <div className="flex items-center gap-3">
                {isRunning && (
                  <svg
                    className="animate-spin w-5 h-5 text-blue-400 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                )}
                {isDone && <span className="text-green-400 text-xl">✓</span>}
                {isError && <span className="text-red-400 text-xl">✕</span>}
                <span
                  className={`text-sm font-medium ${
                    isDone
                      ? 'text-green-400'
                      : isError
                      ? 'text-red-400'
                      : 'text-blue-400'
                  }`}
                >
                  {PHASE_LABELS[phase]}
                </span>
              </div>

              {/* Log output */}
              <div
                ref={logRef}
                className="bg-slate-950 rounded-lg p-3 h-36 overflow-y-auto text-xs font-mono space-y-1"
              >
                {log.map((line, i) => (
                  <p
                    key={i}
                    className={
                      line.type === 'success'
                        ? 'text-green-400'
                        : line.type === 'warn'
                        ? 'text-yellow-400'
                        : line.type === 'error'
                        ? 'text-red-400'
                        : 'text-slate-400'
                    }
                  >
                    {line.text}
                  </p>
                ))}
                {isRunning && (
                  <p className="text-slate-600 animate-pulse">▋</p>
                )}
              </div>

              {/* Result summary */}
              {isDone && result && (
                <div className="bg-slate-800 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-semibold text-white">
                    {result.generated.length} personas generated
                  </p>
                  <div className="space-y-1">
                    {result.indicesSampled.map((idx) => (
                      <div key={idx.indexId} className="flex justify-between text-xs">
                        <span className="text-slate-400">{idx.label}</span>
                        <span className="text-slate-300">{idx.recordsFetched} records sampled</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 pt-1 border-t border-slate-700">
                    Total personas for this site: {result.total}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-3">
          {!isRunning && !isDone && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                <span>✨</span>
                Generate {count} Persona{count !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {isDone && (
            <>
              <button
                onClick={() => {
                  setPhase('idle');
                  setLog([]);
                  setResult(null);
                }}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Generate More
              </button>
              <button
                onClick={handleDone}
                className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Done
              </button>
            </>
          )}
          {isError && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setPhase('idle');
                  setLog([]);
                }}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Try Again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
