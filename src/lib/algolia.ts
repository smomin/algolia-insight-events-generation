import { algoliasearch } from 'algoliasearch';
import { resolveCredentials } from './appConfig';
import { createLogger } from './logger';

const log = createLogger('Algolia');

export interface SearchResult {
  hits: AlgoliaHit[];
  queryID: string;
}

export interface AlgoliaHit {
  objectID: string;
  [key: string]: unknown;
}

async function getClient(agentId?: string) {
  const creds = await resolveCredentials(agentId);
  if (!creds.algoliaAppId || !creds.algoliaSearchApiKey) {
    log.error('missing credentials — set them in App Settings', { agentId });
  }
  return algoliasearch(creds.algoliaAppId, creds.algoliaSearchApiKey);
}

export async function searchIndex(
  indexName: string,
  query: string,
  userToken: string,
  hitsPerPage = 10,
  agentId?: string
): Promise<SearchResult> {
  log.debug('search', { indexName, query, userToken, hitsPerPage, agentId });
  const start = Date.now();
  const client = await getClient(agentId);

  try {
    const response = await client.searchSingleIndex({
      indexName,
      searchParams: {
        query,
        analytics: true,
        clickAnalytics: true,
        enablePersonalization: true,
        userToken,
        hitsPerPage,
      },
    });

    log.debug('search result', {
      indexName,
      query,
      hitCount: response.hits.length,
      queryID: response.queryID,
      durationMs: Date.now() - start,
    });

    return {
      hits: response.hits as AlgoliaHit[],
      queryID: response.queryID ?? '',
    };
  } catch (err) {
    log.error('search failed', { indexName, query, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Fetch up to `hitsPerPage` records from an index using an empty query.
 * Used to sample index contents for persona generation.
 */
export async function sampleIndex(
  indexName: string,
  hitsPerPage = 20,
  agentId?: string
): Promise<AlgoliaHit[]> {
  if (!indexName) return [];
  log.debug('sample index', { indexName, hitsPerPage, agentId });
  const client = await getClient(agentId);
  try {
    const response = await client.searchSingleIndex({
      indexName,
      searchParams: {
        query: '',
        hitsPerPage,
        analytics: false,
        clickAnalytics: false,
      },
    });
    log.debug('sample result', { indexName, hitCount: response.hits.length });
    return response.hits as AlgoliaHit[];
  } catch (err) {
    log.warn('sample failed, returning empty', { indexName, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
