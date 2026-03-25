'use client';

import { useEffect, useRef, useCallback } from 'react';

type SSEHandler = (eventType: string, data: unknown) => void;

/**
 * Open a Server-Sent Events connection and call `handler` whenever a named
 * event arrives.  The connection is automatically:
 *  - Opened when the component mounts (or when `url` changes)
 *  - Closed / replaced when `url` or `eventTypes` change
 *  - Closed when the component unmounts
 *  - Reconnected automatically by the browser's built-in EventSource on error
 *  - Reconnected immediately when the server emits a `reload` event (dev mode
 *    hot-reload), causing the stream route to resend a fresh state snapshot
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

  // Incrementing this counter forces the effect to re-run, closing the old
  // EventSource and opening a new one with a fresh initial state snapshot.
  const reconnectRef = useRef(0);

  // Build a stable key from the types array so the effect only re-runs when
  // the list of event types actually changes (not just a new array reference).
  const typesKey = [...eventTypes].sort().join(',');

  const forceReconnect = useCallback(() => {
    reconnectRef.current += 1;
  }, []);

  useEffect(() => {
    if (!url) return;

    console.debug(`[DEBUG:useSSE] opening EventSource url="${url}" types=[${typesKey}]`);
    const es = new EventSource(url);

    es.onopen = () => {
      console.debug(`[DEBUG:useSSE] connection OPEN url="${url}"`);
    };
    es.onerror = (evt) => {
      console.error(`[DEBUG:useSSE] connection ERROR url="${url}" readyState=${es.readyState}`, evt);
    };

    const listeners: Array<{ type: string; fn: (e: MessageEvent) => void }> = [];

    // App event listeners
    for (const type of eventTypes) {
      const fn = (event: MessageEvent) => {
        console.debug(`[DEBUG:useSSE] received event type="${type}" url="${url}"`);
        try {
          handlerRef.current(type, JSON.parse(event.data as string));
        } catch {
          /* ignore malformed payloads */
        }
      };
      es.addEventListener(type, fn);
      listeners.push({ type, fn });
    }

    // Dev hot-reload listener — server emits `reload` after a module hot-swap.
    // We close the current EventSource and open a new one so the stream route
    // resends its initial state snapshot with the latest server-side data.
    const reloadFn = () => {
      console.debug(`[DEBUG:useSSE] reload event received — reconnecting url="${url}"`);
      es.close();
      forceReconnect();
    };
    es.addEventListener('reload', reloadFn);

    return () => {
      console.debug(`[DEBUG:useSSE] closing EventSource url="${url}"`);
      for (const { type, fn } of listeners) {
        es.removeEventListener(type, fn);
      }
      es.removeEventListener('reload', reloadFn);
      es.close();
    };
    // reconnectRef.current is intentionally included so a forceReconnect() call
    // re-runs this effect and opens a fresh EventSource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, typesKey, reconnectRef.current]);
}
