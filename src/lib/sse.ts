import { EventEmitter } from 'events';

export type SSEEventType = 'status' | 'session' | 'event-log' | 'counters' | 'agent-status' | 'guardrail' | 'supervisor' | 'reload';

// Persist emitter on globalThis so it survives Next.js hot reloads.
// Without this, each hot reload creates a fresh emitter and active SSE
// connections lose their event subscriptions.
const g = globalThis as typeof globalThis & { _sseEmitter?: EventEmitter };
if (!g._sseEmitter) {
  g._sseEmitter = new EventEmitter();
  g._sseEmitter.setMaxListeners(200);
}
const emitter = g._sseEmitter;

/**
 * Emit an event for a specific industry channel.
 * For 'status' events, also broadcasts a lightweight update to the '_global'
 * channel so page.tsx can update the header running-dots without subscribing
 * to every industry individually.
 */
export function emitToIndustry(
  industryId: string,
  type: SSEEventType,
  data: unknown
): void {
  emitter.emit(`${industryId}:${type}`, data);
  if (type === 'status') {
    const d = data as { isRunning?: boolean; isDistributing?: boolean };
    emitter.emit('_global:status', {
      industryId,
      isRunning: d.isRunning ?? false,
      isDistributing: d.isDistributing ?? false,
    });
  }
}

/**
 * Subscribe to SSE events for an industry channel.
 * Pass '_global' as industryId to receive cross-industry status updates.
 * Returns an unsubscribe / cleanup function.
 */
export function subscribeToStream(
  industryId: string,
  types: SSEEventType[],
  handler: (type: SSEEventType, data: unknown) => void
): () => void {
  const cleanups: Array<() => void> = [];
  for (const type of types) {
    const channel = `${industryId}:${type}`;
    const fn = (data: unknown) => handler(type, data);
    emitter.on(channel, fn);
    cleanups.push(() => emitter.off(channel, fn));
  }
  return () => cleanups.forEach((c) => c());
}

// ─────────────────────────────────────────────
// Dev-mode live reload helpers
// ─────────────────────────────────────────────

const RELOAD_CHANNEL = '__dev_reload__';

/**
 * Broadcast a reload event to all connected SSE clients.
 * Called in development when Next.js hot-reloads a server module.
 * Clients that receive this event will close and reopen their EventSource,
 * triggering a fresh initial state snapshot from the stream route.
 */
export function emitDevReload(): void {
  emitter.emit(RELOAD_CHANNEL, { timestamp: Date.now() });
}

/** Subscribe to dev reload broadcasts. Returns an unsubscribe function. */
export function subscribeToDevReload(handler: (data: { timestamp: number }) => void): () => void {
  emitter.on(RELOAD_CHANNEL, handler);
  return () => emitter.off(RELOAD_CHANNEL, handler);
}
