import type {
  InsightEvent,
  CartProduct,
  SentEvent,
  FlexIndex,
  IndexEvent,
} from '@/types';
import { resolveCredentials } from './appConfig';
import { createLogger } from './logger';

const log = createLogger('Insights');

const INSIGHTS_ENDPOINT =
  process.env.ALGOLIA_INSIGHTS_URL ?? 'https://insights.algolia.io/1/events';

function randomFloat(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function sendEvents(
  events: InsightEvent[],
  industryId?: string
): Promise<number> {
  const creds = await resolveCredentials(industryId);
  if (!creds.algoliaAppId || !creds.algoliaSearchApiKey) {
    log.error('sendEvents: missing Algolia credentials — set them in App Settings', { industryId });
    return 401;
  }

  const eventSummary = events.map((e) => ({ type: e.eventType, name: e.eventName, index: e.index }));
  log.debug('sendEvents', { industryId, eventCount: events.length, endpoint: INSIGHTS_ENDPOINT, events: eventSummary });

  const start = Date.now();
  try {
    const response = await fetch(INSIGHTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-Algolia-Application-Id': creds.algoliaAppId,
        'X-Algolia-API-Key': creds.algoliaSearchApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events }),
    });

    log.debug('sendEvents response', {
      industryId,
      status: response.status,
      durationMs: Date.now() - start,
    });

    if (response.status !== 200) {
      const body = await response.text().catch(() => '');
      log.warn('sendEvents non-200 response', { industryId, status: response.status, body: body.slice(0, 200) });
    }

    return response.status;
  } catch (err) {
    log.error('sendEvents fetch failed', { industryId, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// ─────────────────────────────────────────────
// Generic event builder — driven by FlexIndex config
// ─────────────────────────────────────────────

/**
 * Builds Algolia Insight events for a configured index.
 *
 * - For PRIMARY indices: single hit (primaryHit + queryID are used).
 * - For SECONDARY indices: multiple cart products for addToCart/purchase,
 *   first product for click/view.
 */
export function buildFlexIndexEvents(
  persona: { userToken: string },
  indexConfig: FlexIndex,
  primaryHit: { objectID: string },
  primaryPosition: number,
  primaryQueryID: string,
  cartProducts: CartProduct[]
): InsightEvent[] {
  const now = Date.now();
  const events: InsightEvent[] = [];

  const allObjectIDs = cartProducts.length > 0
    ? cartProducts.map((p) => p.objectID)
    : [primaryHit.objectID];
  const totalValue =
    cartProducts.length > 0
      ? Math.round(cartProducts.reduce((s, p) => s + p.price * p.quantity, 0) * 100) / 100
      : 0;
  const objectData =
    cartProducts.length > 0
      ? cartProducts.map((p) => ({
          queryID: p.queryID,
          price: p.price,
          discount: p.discount,
          quantity: p.quantity,
        }))
      : [];

  for (let i = 0; i < indexConfig.events.length; i++) {
    const cfg: IndexEvent = indexConfig.events[i];
    const ts = now + i * 2000;

    if (cfg.eventType === 'click') {
      const clickHit = cartProducts.length > 0 ? cartProducts[0] : null;
      events.push({
        eventType: 'click',
        eventName: cfg.eventName,
        index: indexConfig.indexName,
        objectIDs: clickHit ? [clickHit.objectID] : [primaryHit.objectID],
        positions: [clickHit ? (clickHit.position ?? 1) : primaryPosition],
        queryID: clickHit ? clickHit.queryID : primaryQueryID,
        userToken: persona.userToken,
        timestamp: ts,
      });
    } else if (cfg.eventType === 'view') {
      const viewHit = cartProducts.length > 0 ? cartProducts[0] : null;
      events.push({
        eventType: 'view',
        eventName: cfg.eventName,
        index: indexConfig.indexName,
        objectIDs: viewHit ? [viewHit.objectID] : [primaryHit.objectID],
        userToken: persona.userToken,
        timestamp: ts,
      });
    } else if (cfg.eventType === 'conversion') {
      const isCartEvent =
        cfg.eventSubtype === 'addToCart' || cfg.eventSubtype === 'purchase';

      if (isCartEvent && cartProducts.length > 0) {
        events.push({
          eventType: 'conversion',
          eventSubtype: cfg.eventSubtype,
          eventName: cfg.eventName,
          index: indexConfig.indexName,
          objectIDs: allObjectIDs,
          objectData,
          value: totalValue,
          currency: 'USD',
          queryID: cartProducts[0].queryID,
          userToken: persona.userToken,
          timestamp: ts,
        });
      } else {
        events.push({
          eventType: 'conversion',
          ...(cfg.eventSubtype ? { eventSubtype: cfg.eventSubtype } : {}),
          eventName: cfg.eventName,
          index: indexConfig.indexName,
          objectIDs: [primaryHit.objectID],
          queryID: primaryQueryID,
          userToken: persona.userToken,
          timestamp: ts,
        });
      }
    }
  }

  return events;
}

// ─────────────────────────────────────────────
// Cart product builder
// ─────────────────────────────────────────────

export function buildCartProduct(
  hit: { objectID: string; [key: string]: unknown },
  queryID: string,
  position: number
): CartProduct {
  const price =
    typeof hit.price === 'number' ? hit.price : randomFloat(1.99, 99.99);
  return {
    objectID: hit.objectID,
    queryID,
    price,
    quantity: randomInt(1, 3),
    discount: 0,
    position,
  };
}

// ─────────────────────────────────────────────
// Sent event wrapper
// ─────────────────────────────────────────────

export function toSentEvents(
  events: InsightEvent[],
  status: number,
  meta?: {
    industryId?: string;
    personaId?: string;
    personaName?: string;
    sessionId?: string;
  }
): SentEvent[] {
  const sentAt = Date.now();
  return events.map((event) => ({
    event,
    batchStatus: status,
    sentAt,
    ...meta,
  }));
}

// ─────────────────────────────────────────────
// Legacy builders — kept for any remaining references
// ─────────────────────────────────────────────

export function buildPrimaryEvents(
  persona: { userToken: string },
  indexName: string,
  objectID: string,
  position: number,
  queryID: string,
  eventNames: { click: string; view: string; conversion: string }
): InsightEvent[] {
  return buildFlexIndexEvents(
    persona,
    {
      id: 'primary',
      label: '',
      indexName,
      role: 'primary',
      events: [
        { eventType: 'click', eventName: eventNames.click },
        { eventType: 'view', eventName: eventNames.view },
        { eventType: 'conversion', eventName: eventNames.conversion },
      ],
    },
    { objectID },
    position,
    queryID,
    []
  );
}

export function buildSecondaryEvents(
  persona: { userToken: string },
  indexName: string,
  products: CartProduct[],
  eventNames: { click: string; view: string; addToCart: string; purchase: string }
): InsightEvent[] {
  const firstProduct = products[0] ?? { objectID: '', queryID: '' };
  const primaryHit: { objectID: string } = firstProduct;
  return buildFlexIndexEvents(
    persona,
    {
      id: 'secondary',
      label: '',
      indexName,
      role: 'secondary',
      events: [
        { eventType: 'click', eventName: eventNames.click },
        { eventType: 'view', eventName: eventNames.view },
        { eventType: 'conversion', eventSubtype: 'addToCart', eventName: eventNames.addToCart },
        { eventType: 'conversion', eventSubtype: 'purchase', eventName: eventNames.purchase },
      ],
    },
    primaryHit,
    1,
    firstProduct.queryID,
    products
  );
}
