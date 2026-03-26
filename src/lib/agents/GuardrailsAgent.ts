/**
 * GuardrailsAgent — singleton LLM-based validator.
 *
 * Before every Algolia search query is executed, the GuardrailsAgent
 * evaluates whether the query authentically represents the persona who
 * would be running that search. Rejected queries are logged and the
 * WorkerAgent may retry with the suggested alternative (up to
 * GUARDRAIL_MAX_RETRIES times).
 */

import { callLLM } from '@/lib/llm';
import { emitToAgent } from '@/lib/sse';
import { appendGuardrailViolation, getAgentConfigs, DEFAULT_GUARDRAILS_PROMPT } from '@/lib/agentDb';
import type { Persona, AgentConfig, GuardrailResult } from '@/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('Guardrails');

export const GUARDRAIL_MAX_RETRIES = parseInt(
  process.env.GUARDRAIL_MAX_RETRIES ?? '3',
  10
);

export class GuardrailsAgent {
  async validate(
    query: string,
    persona: Persona,
    agent: AgentConfig,
    attemptNumber = 1
  ): Promise<GuardrailResult> {
    const alog = log.child(agent.id);

    alog.debug('validating query', { persona: persona.name, query, attemptNumber });

    const personaLines = Object.entries(persona)
      .filter(([k]) => !['id', 'userToken'].includes(k))
      .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? (v as unknown[]).join(', ') : v}`)
      .join('\n');

    const userMessage = `Agent: ${agent.name}\n\nPersona:\n${personaLines}\n\nProposed search query: "${query}"`;

    const configs = await getAgentConfigs().catch(() => null);
    const systemPrompt = configs?.guardrails?.systemPrompt ?? DEFAULT_GUARDRAILS_PROMPT;
    const guardrailsProviderId = configs?.guardrails?.llmProviderId;

    try {
      const raw = await callLLM(
        [{ role: 'user', content: userMessage }],
        {
          systemPrompt,
          maxTokens: 200,
          ...(guardrailsProviderId ? { providerIdOverride: guardrailsProviderId } : {}),
        },
        agent.id
      );

      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      const parsed = JSON.parse(cleaned) as {
        approved: boolean;
        reason: string;
        suggestedQuery?: string;
      };

      const result: GuardrailResult = {
        approved: !!parsed.approved,
        reason: parsed.reason ?? 'No reason provided',
        suggestedQuery: parsed.suggestedQuery,
        agentId: agent.id,
        personaId: persona.id,
        personaName: persona.name,
        originalQuery: query,
        finalQuery: query,
        attemptNumber,
        timestamp: new Date().toISOString(),
      };

      if (result.approved) {
        alog.debug('query approved', { persona: persona.name, query, attemptNumber, reason: result.reason });
      } else {
        alog.warn(`query REJECTED (attempt ${attemptNumber})`, {
          persona: persona.name,
          query,
          reason: result.reason,
          suggestedQuery: result.suggestedQuery,
        });
        emitToAgent(agent.id, 'guardrail', result);
        appendGuardrailViolation(agent.id, result).catch((err) =>
          alog.error('failed to persist guardrail violation', err)
        );
      }

      return result;
    } catch (err) {
      alog.warn('validation LLM call failed — failing open (approved by default)', {
        persona: persona.name,
        query,
        attemptNumber,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        approved: true,
        reason: 'Guardrail validation unavailable — approved by default',
        agentId: agent.id,
        personaId: persona.id,
        personaName: persona.name,
        originalQuery: query,
        finalQuery: query,
        attemptNumber,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Singleton — persists across Next.js hot reloads
const g = globalThis as typeof globalThis & { _guardrailsAgent?: GuardrailsAgent };
if (!g._guardrailsAgent) g._guardrailsAgent = new GuardrailsAgent();
export const guardrailsAgent = g._guardrailsAgent;
