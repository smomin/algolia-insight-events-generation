/**
 * Structured logger utility.
 *
 * Usage:
 *   import { createLogger } from '@/lib/logger';
 *   const log = createLogger('MyModule');
 *   log.info('Something happened', { key: 'value' });
 *   log.error('Failed', err);
 *
 * Log level is controlled via the LOG_LEVEL environment variable:
 *   LOG_LEVEL=debug   → debug + info + warn + error
 *   LOG_LEVEL=info    → info + warn + error  (default)
 *   LOG_LEVEL=warn    → warn + error
 *   LOG_LEVEL=error   → error only
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─────────────────────────────────────────────
// ANSI colour helpers (server/Node only)
// ─────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  debug: '\x1b[36m',  // cyan
  info: '\x1b[32m',   // green
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
  ns: '\x1b[35m',     // magenta for namespace
};

function levelTag(level: LogLevel): string {
  const upper = level.toUpperCase().padEnd(5);
  return `${C[level]}${C.bold}${upper}${C.reset}`;
}

// ─────────────────────────────────────────────
// Core write
// ─────────────────────────────────────────────

// Cache the resolved level so process.env is not read on every log call.
// LOG_LEVEL is expected to be set at startup and not change at runtime.
let _minLevel: number | undefined;

function getMinLevel(): number {
  if (_minLevel !== undefined) return _minLevel;
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
  _minLevel = LEVEL_RANK[env] ?? LEVEL_RANK.info;
  return _minLevel;
}

function serializeMeta(meta: unknown): string {
  if (meta === undefined || meta === null) return '';
  if (meta instanceof Error) {
    return ` ${C.dim}${meta.message}${C.reset}`;
  }
  try {
    const str = JSON.stringify(meta);
    return ` ${C.dim}${str}${C.reset}`;
  } catch {
    return ` ${C.dim}${String(meta)}${C.reset}`;
  }
}

function write(level: LogLevel, namespace: string, msg: string, meta?: unknown): void {
  if (LEVEL_RANK[level] < getMinLevel()) return;

  const ts = `${C.dim}${new Date().toISOString()}${C.reset}`;
  const lvl = levelTag(level);
  const ns = `${C.ns}[${namespace}]${C.reset}`;
  const metaStr = meta !== undefined ? serializeMeta(meta) : '';

  const line = `${ts} ${lvl} ${ns} ${msg}${metaStr}`;

  if (level === 'error') {
    console.error(line);
    if (meta instanceof Error && meta.stack) {
      console.error(`${C.dim}${meta.stack}${C.reset}`);
    }
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

// ─────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  /** Create a child logger with an extended namespace, e.g. log.child('sessionId') */
  child(subNamespace: string): Logger;
}

export function createLogger(namespace: string): Logger {
  return {
    debug: (msg, meta) => write('debug', namespace, msg, meta),
    info:  (msg, meta) => write('info',  namespace, msg, meta),
    warn:  (msg, meta) => write('warn',  namespace, msg, meta),
    error: (msg, meta) => write('error', namespace, msg, meta),
    child: (sub) => createLogger(`${namespace}:${sub}`),
  };
}
