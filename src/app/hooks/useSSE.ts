'use client';

import { useEffect, useRef } from 'react';

type SSEHandler = (eventType: string, data: unknown) => void;

/**
 * Open a Server-Sent Events connection and call `handler` whenever a named
 * event arrives.  The connection is automatically:
 *  - Opened when the component mounts (or when `url` changes)
 *  - Closed / replaced when `url` or `eventTypes` change
 *  - Closed when the component unmounts
 *  - Reconnected automatically by the browser's built-in EventSource on error
 *
 * The `handler` reference is kept up-to-date via a ref so you can pass an
 * inline callback without triggering reconnects.
 */
export function useSSE(
  url: string | null,
  eventTypes: readonly string[],
  handler: SSEHandler
): void {
  const handlerRef = useRef<SSEHandler>(handler);
  handlerRef.current = handler;

  // Build a stable key from the types array so the effect only re-runs when
  // the list of event types actually changes (not just a new array reference).
  const typesKey = [...eventTypes].sort().join(',');

  useEffect(() => {
    if (!url) return;

    const es = new EventSource(url);

    const listeners: Array<{ type: string; fn: (e: MessageEvent) => void }> = [];
    for (const type of eventTypes) {
      const fn = (event: MessageEvent) => {
        try {
          handlerRef.current(type, JSON.parse(event.data as string));
        } catch {
          /* ignore malformed payloads */
        }
      };
      es.addEventListener(type, fn);
      listeners.push({ type, fn });
    }

    return () => {
      for (const { type, fn } of listeners) {
        es.removeEventListener(type, fn);
      }
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, typesKey]);
}
