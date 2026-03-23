/**
 * Couchbase Server connection singleton.
 *
 * On first use, the module:
 *   1. Connects to the configured Couchbase Server.
 *   2. Creates the bucket if it does not exist.
 *   3. Creates all required collections inside the _default scope.
 *
 * Bucket layout
 * ─────────────────────────────────────────────
 * Bucket : algolia-insights  (env COUCHBASE_BUCKET)
 * Scope  : _default
 * Collections:
 *   appConfig         — single doc (key = "_config")  global app credentials
 *   industryConfigs   — one doc per industry  (key = industryId)
 *   personas          — one doc per industry  (key = industryId)
 *   counters          — one doc per industry  (key = industryId)
 *   eventLogs         — one doc per industry  (key = industryId)
 *   schedulerRuns     — one doc per industry  (key = industryId)
 *   sessions          — one doc per industry  (key = industryId)
 */

import {
  connect,
  Cluster,
  Collection,
  DocumentNotFoundError,
  BucketType,
} from 'couchbase';

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const BUCKET_NAME = process.env.COUCHBASE_BUCKET ?? 'algolia-insights';
const SCOPE_NAME = '_default';

export const COLLECTIONS = [
  'appConfig',
  'industryConfigs',
  'personas',
  'counters',
  'eventLogs',
  'schedulerRuns',
  'sessions',
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

// ─────────────────────────────────────────────
// Singleton connection
// ─────────────────────────────────────────────

let _initPromise: Promise<Cluster> | null = null;

async function initCluster(): Promise<Cluster> {
  const url = process.env.COUCHBASE_URL ?? 'couchbase://localhost';
  const username = process.env.COUCHBASE_USERNAME ?? 'Administrator';
  const password = process.env.COUCHBASE_PASSWORD ?? 'password';

  const cluster = await connect(url, { username, password });

  // ── Ensure bucket exists ──
  const bucketMgr = cluster.buckets();
  try {
    await bucketMgr.getBucket(BUCKET_NAME);
  } catch {
    await bucketMgr.createBucket({
      name: BUCKET_NAME,
      ramQuotaMB: 256,
      bucketType: BucketType.Couchbase,
      numReplicas: 0,
    });
    // Couchbase needs a moment after bucket creation
    await delay(2000);
  }

  // ── Ensure all collections exist ──
  const collMgr = cluster.bucket(BUCKET_NAME).collections();
  for (const collName of COLLECTIONS) {
    try {
      await collMgr.createCollection({ name: collName, scopeName: SCOPE_NAME });
      await delay(300);
    } catch {
      // Collection already exists — ignore
    }
  }

  console.log(`[Couchbase] Connected. Bucket: "${BUCKET_NAME}"`);
  return cluster;
}

function getCluster(): Promise<Cluster> {
  if (!_initPromise) {
    _initPromise = initCluster().catch((err) => {
      _initPromise = null; // reset so we retry on next call
      throw err;
    });
  }
  return _initPromise;
}

// ─────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────

export async function getCollection(name: CollectionName): Promise<Collection> {
  const cluster = await getCluster();
  return cluster.bucket(BUCKET_NAME).scope(SCOPE_NAME).collection(name);
}

/** Get a document; returns null if it does not exist. */
export async function cbGet<T>(
  collName: CollectionName,
  key: string
): Promise<T | null> {
  try {
    const coll = await getCollection(collName);
    const result = await coll.get(key);
    return result.content as T;
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return null;
    throw err;
  }
}

/** Upsert (create or replace) a document. */
export async function cbUpsert<T extends object>(
  collName: CollectionName,
  key: string,
  value: T
): Promise<void> {
  const coll = await getCollection(collName);
  await coll.upsert(key, value);
}

/** Delete a document if it exists (no-op if missing). */
export async function cbDelete(
  collName: CollectionName,
  key: string
): Promise<void> {
  try {
    const coll = await getCollection(collName);
    await coll.remove(key);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return;
    throw err;
  }
}

/**
 * Get all document keys stored under a given collection.
 * Uses a `_index` document (key = "_index") that tracks every document key.
 */
export async function cbGetIndex(collName: CollectionName): Promise<string[]> {
  const index = await cbGet<{ keys: string[] }>(collName, '_index');
  return index?.keys ?? [];
}

/**
 * Register a key in the collection index (idempotent).
 */
export async function cbAddToIndex(
  collName: CollectionName,
  key: string
): Promise<void> {
  const keys = await cbGetIndex(collName);
  if (!keys.includes(key)) {
    await cbUpsert(collName, '_index', { keys: [...keys, key] });
  }
}

/**
 * Remove a key from the collection index.
 */
export async function cbRemoveFromIndex(
  collName: CollectionName,
  key: string
): Promise<void> {
  const keys = await cbGetIndex(collName);
  await cbUpsert(collName, '_index', { keys: keys.filter((k) => k !== key) });
}

// ─────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
