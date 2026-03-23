import { algoliasearch } from 'algoliasearch';
import { resolveCredentials } from './appConfig';

export interface SearchResult {
  hits: AlgoliaHit[];
  queryID: string;
}

export interface AlgoliaHit {
  objectID: string;
  [key: string]: unknown;
}

async function getClient(industryId?: string) {
  const creds = await resolveCredentials(industryId);
  return algoliasearch(creds.algoliaAppId, creds.algoliaSearchApiKey);
}

export async function searchIndex(
  indexName: string,
  query: string,
  userToken: string,
  hitsPerPage = 10,
  industryId?: string
): Promise<SearchResult> {
  const client = await getClient(industryId);
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
  return {
    hits: response.hits as AlgoliaHit[],
    queryID: response.queryID ?? '',
  };
}

/**
 * Fetch up to `hitsPerPage` records from an index using an empty query.
 * Used to sample index contents for persona generation.
 */
export async function sampleIndex(
  indexName: string,
  hitsPerPage = 20,
  industryId?: string
): Promise<AlgoliaHit[]> {
  if (!indexName) return [];
  const client = await getClient(industryId);
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
    return response.hits as AlgoliaHit[];
  } catch {
    return [];
  }
}
