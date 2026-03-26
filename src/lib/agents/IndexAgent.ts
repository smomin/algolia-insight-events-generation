/**
 * IndexAgent — autonomous per-index search agent.
 *
 * Each FlexIndex in an AgentConfig gets its own IndexAgent. The agent is
 * responsible for generating contextually relevant search queries, maintaining
 * per-index query memory, and running guardrail validation with index-aware context.
 *
 * Primary index agents drive the initial discovery query from persona attributes
 * and site context. Secondary index agents extend the session by generating
 * complementary queries informed by the primary index result — creating a
 * coherent, realistic user journey toward conversion.
 *
 * The WorkerAgent (site agent) orchestrates all IndexAgents per session,
 * monitors their execution, and ensures the overall objectives are met.
 *
 * Prompt resolution priority (highest → lowest):
 *   1. FlexIndex.agentPrompts.systemPrompt  (per-index override)
 *   2. AgentConfigs.primaryIndexAgent / secondaryIndexAgent  (global default)
 *   3. Built-in hardcoded fallback
 */

import type { Persona, AgentConfig, FlexIndex, GuardrailResult } from '@/types';
import { callLLM } from '@/lib/llm';
import { guardrailsAgent } from './GuardrailsAgent';
import { getAgentConfigs } from '@/lib/agentDb';
import { getIndexQueryMemory, appendIndexQuery } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import type { AlgoliaHit } from '@/lib/algolia';

const log = createLogger('IndexAgent');

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

/**
 * Context produced by the primary IndexAgent and passed to every secondary
 * IndexAgent so they can build coherent complementary queries.
 */
export interface PrimaryIndexContext {
  /** The search query that was executed against the primary index. */
  query: string;
  /** The Algolia hit that was selected as the best result. */
  hit: AlgoliaHit;
  /** Human-readable label of the primary index (e.g. "Recipes"). */
  indexLabel: string;
  /** Actual Algolia index name of the primary index. */
  indexName: string;
  /** LLM-generated reason the hit was chosen for this persona. */
  selectionReason: string;
}

// ─────────────────────────────────────────────
// IndexAgent class
// ─────────────────────────────────────────────

export class IndexAgent {
  private readonly ilog: ReturnType<typeof log.child>;

  constructor(
    private readonly index: FlexIndex,
    private readonly agent: AgentConfig
  ) {
    this.ilog = log.child(`${agent.id}:${index.id}`);
  }

  get indexId(): string { return this.index.id; }
  get indexName(): string { return this.index.indexName; }
  get indexLabel(): string { return this.index.label; }
  get role(): 'primary' | 'secondary' { return this.index.role; }

  // ─────────────────────────────────────────────
  // Primary query generation
  // ─────────────────────────────────────────────

  /**
   * Generate a discovery search query for the primary index.
   *
   * Combines agent-level persona memory (shared across all indices) with
   * per-index memory so the agent avoids repeating queries both within this
   * index and globally across the session.
   */
  async generatePrimaryQuery(
    persona: Persona,
    agentLevelRecentQueries: string[]
  ): Promise<string> {
    const indexMemory = await getIndexQueryMemory(
      this.agent.id,
      persona.id,
      this.index.id
    ).catch(() => []);

    // Merge and deduplicate; agent-level queries first (higher priority to avoid)
    const allRecentQueries = [
      ...new Set([...agentLevelRecentQueries, ...indexMemory]),
    ];

    this.ilog.debug('generating primary query', {
      persona: persona.name,
      indexName: this.index.indexName,
      recentQueryCount: allRecentQueries.length,
    });

    const systemPrompt = await this.resolveSystemPrompt('primary');
    const recentSection =
      allRecentQueries.length > 0
        ? `\n\nRecent searches for "${this.index.label}" (avoid repeating — generate something distinctly different):\n${allRecentQueries.map((q) => `- "${q}"`).join('\n')}`
        : '';

    const userMessage = this.buildPrimaryUserMessage(persona, recentSection);

    const query = await callLLM(
      [{ role: 'user', content: userMessage }],
      { systemPrompt, maxTokens: 100 },
      this.agent.id
    );

    const trimmed = query.trim();
    this.ilog.debug('primary query generated', { query: trimmed });
    return trimmed;
  }

  // ─────────────────────────────────────────────
  // Secondary query generation
  // ─────────────────────────────────────────────

  /**
   * Generate complementary search queries for a secondary index.
   *
   * Receives the full primary result context so the secondary agent can
   * reason about what the user found and what they are likely to search
   * for next on this specific secondary catalog.
   */
  async generateSecondaryQueries(
    persona: Persona,
    primaryContext: PrimaryIndexContext,
    agentLevelRecentQueries: string[]
  ): Promise<string[]> {
    const indexMemory = await getIndexQueryMemory(
      this.agent.id,
      persona.id,
      this.index.id
    ).catch(() => []);

    const allRecentQueries = [
      ...new Set([...agentLevelRecentQueries, ...indexMemory]),
    ];

    this.ilog.debug('generating secondary queries', {
      persona: persona.name,
      indexName: this.index.indexName,
      primaryQuery: primaryContext.query,
      recentQueryCount: allRecentQueries.length,
    });

    const systemPrompt = await this.resolveSystemPrompt('secondary');
    const userMessage = this.buildSecondaryUserMessage(persona, primaryContext, allRecentQueries);

    const raw = await callLLM(
      [{ role: 'user', content: userMessage }],
      { systemPrompt, maxTokens: 300 },
      this.agent.id
    );

    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    try {
      const parsed = JSON.parse(cleaned) as string[];
      if (!Array.isArray(parsed) || parsed.length === 0)
        throw new Error('Not a valid array');
      const queries = parsed.slice(0, 5).map((q) => String(q).trim()).filter(Boolean);
      this.ilog.debug('secondary queries generated', { queries });
      return queries;
    } catch (err) {
      this.ilog.warn('secondary query parse failed — falling back to primary hit name', {
        error: err instanceof Error ? err.message : String(err),
        raw: raw.slice(0, 120),
      });
      const hitName =
        (primaryContext.hit.name as string) ??
        (primaryContext.hit.title as string) ??
        primaryContext.hit.objectID;
      return [hitName];
    }
  }

  // ─────────────────────────────────────────────
  // Guardrails
  // ─────────────────────────────────────────────

  /**
   * Validate a search query through the GuardrailsAgent.
   *
   * The agent name passed to the guardrails validator is enriched with the
   * index label and role so the LLM can assess domain relevance for this
   * specific index, not just the overall site.
   */
  async validate(
    query: string,
    persona: Persona,
    attemptNumber = 1
  ): Promise<GuardrailResult> {
    // Enrich agent name with index context for the guardrails prompt
    const indexAwareAgent: AgentConfig = {
      ...this.agent,
      name: `${this.agent.name} › ${this.index.label} (${this.index.role} index)`,
    };
    return guardrailsAgent.validate(query, persona, indexAwareAgent, attemptNumber);
  }

  // ─────────────────────────────────────────────
  // Memory
  // ─────────────────────────────────────────────

  /**
   * Persist an approved query to this index's per-persona memory.
   * Failures are silently swallowed — memory is best-effort.
   */
  async rememberQuery(personaId: string, query: string): Promise<void> {
    await appendIndexQuery(this.agent.id, personaId, this.index.id, query).catch(
      (err: unknown) =>
        this.ilog.warn('failed to save query to index memory', {
          error: err instanceof Error ? err.message : String(err),
        })
    );
  }

  // ─────────────────────────────────────────────
  // Private — prompt resolution
  // ─────────────────────────────────────────────

  private async resolveSystemPrompt(role: 'primary' | 'secondary'): Promise<string> {
    // 1. Per-index override (highest priority)
    if (this.index.agentPrompts?.systemPrompt) {
      return this.index.agentPrompts.systemPrompt;
    }

    // 2. Global AgentConfigs default
    const configs = await getAgentConfigs().catch(() => null);
    const basePrompt =
      role === 'primary'
        ? configs?.primaryIndexAgent?.systemPrompt
        : configs?.secondaryIndexAgent?.systemPrompt;

    if (basePrompt) {
      // Append index-specific context so a single global prompt stays relevant
      return [
        basePrompt,
        `\nIndex context: "${this.index.label}" (${this.index.indexName}) — ${this.index.role} index on "${this.agent.name}"`,
      ].join('');
    }

    // 3. Built-in fallback
    return role === 'primary'
      ? this.builtInPrimaryPrompt()
      : this.builtInSecondaryPrompt();
  }

  // ─────────────────────────────────────────────
  // Private — user message builders
  // ─────────────────────────────────────────────

  private buildPrimaryUserMessage(persona: Persona, recentSection: string): string {
    const personaLines = Object.entries(persona)
      .filter(([k]) => !['id', 'userToken'].includes(k))
      .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? (v as unknown[]).join(', ') : v}`)
      .join('\n');

    return [
      `Site: ${this.agent.name}${this.agent.siteUrl ? ` (${this.agent.siteUrl})` : ''}`,
      `Index: ${this.index.label} (${this.index.indexName})`,
      `\nPersona:\n${personaLines}`,
      recentSection,
    ].join('\n');
  }

  private buildSecondaryUserMessage(
    persona: Persona,
    primaryContext: PrimaryIndexContext,
    recentQueries: string[]
  ): string {
    // Compact summary of the primary hit — skip internal / empty fields
    const hitSummary = Object.entries(primaryContext.hit)
      .filter(
        ([k]) => !k.startsWith('_') && !['objectID', '__position'].includes(k)
      )
      .slice(0, 12)
      .map(([k, v]) => {
        const str = Array.isArray(v)
          ? (v as unknown[]).slice(0, 4).join(', ')
          : String(v ?? '');
        return str
          ? `  ${k}: ${str.length > 100 ? str.slice(0, 100) + '…' : str}`
          : null;
      })
      .filter(Boolean)
      .join('\n');

    const recentSection =
      recentQueries.length > 0
        ? `\nRecent searches for "${this.index.label}" (avoid repeating):\n${recentQueries.map((q) => `- "${q}"`).join('\n')}`
        : '';

    const personaTags = (
      (persona.tags as string[] | undefined) ??
      (persona.dietaryPreferences as string[] | undefined) ??
      []
    ).join(', ');

    return [
      `Site: ${this.agent.name}${this.agent.siteUrl ? ` (${this.agent.siteUrl})` : ''}`,
      `\nPrimary index searched: ${primaryContext.indexLabel} (${primaryContext.indexName})`,
      `Primary query used: "${primaryContext.query}"`,
      `\nPrimary result selected:\n${hitSummary}`,
      `Selection reason: ${primaryContext.selectionReason}`,
      `\nNow generating queries for secondary index: ${this.index.label} (${this.index.indexName})`,
      `\nPersona budget: ${persona.budget ?? 'medium'}`,
      `Persona tags: ${personaTags || 'none'}`,
      `Persona description: ${persona.description ?? ''}`,
      recentSection,
    ]
      .filter(Boolean)
      .join('\n');
  }

  // ─────────────────────────────────────────────
  // Private — built-in fallback prompts
  // ─────────────────────────────────────────────

  private builtInPrimaryPrompt(): string {
    return `You are the Primary Index Search Agent for "${this.agent.name}".

Your role is to generate a realistic, persona-driven search query for the primary catalog "${this.index.label}"${this.agent.siteUrl ? ` at ${this.agent.siteUrl}` : ''}. This represents the user's initial discovery intent — the first thing they type into the search bar.

Guidelines:
- Generate a query that authentically reflects the persona's intent, skill level, budget, and interests
- Use natural language a real person would type — avoid overly technical or generic terms
- Draw on the persona's specific attributes (dietary preferences, skills, budget, tags, domain-specific fields)
- Consider the site context and what products or content exist in "${this.index.label}"
- Vary query style across sessions: broad discovery, specific product searches, or need-based queries
- Output ONLY the search query string — no quotes, no punctuation at the end, no explanation`;
  }

  private builtInSecondaryPrompt(): string {
    return `You are a Secondary Index Search Agent for "${this.agent.name}".

Your role is to generate contextually relevant search queries for the "${this.index.label}" catalog, informed by what the user already found in their primary search. You represent the user's continued discovery journey — the complementary searches that follow their initial find.

Guidelines:
- Base queries on the primary result's key attributes: name, category, type, style, brand, or themes
- Consider what complementary, related, or necessary items this persona would search for next
- Stay true to the persona's budget, preferences, and behavioral patterns
- Generate queries that naturally lead toward add-to-cart or purchase events in "${this.index.label}"
- Return a JSON array of 3 to 5 short search query strings — no markdown, no code fences, no extra text`;
  }
}
