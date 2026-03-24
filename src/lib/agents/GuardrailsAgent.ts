/**
 * GuardrailsAgent — singleton LLM-based validator.
 *
 * Before every Algolia search query is executed, the GuardrailsAgent
 * evaluates whether the query authentically represents the persona who
 * would be running that search. Rejected queries are logged and the
 * IndustryAgent may retry with the suggested alternative (up to
 * GUARDRAIL_MAX_RETRIES times).
 */

import { callLLM } from '@/lib/llm';
import { emitToIndustry } from '@/lib/sse';
import { appendGuardrailViolation } from '@/lib/agentDb';
import type { Persona, IndustryV2, GuardrailResult } from '@/types';

export const GUARDRAIL_MAX_RETRIES = parseInt(
  process.env.GUARDRAIL_MAX_RETRIES ?? '3',
  10
);

const SYSTEM_PROMPT = `You are a guardrails validator for an Algolia search event simulation system.

Your job: evaluate whether a proposed search query authentically represents what the given user persona would actually search for in this industry.

Evaluate these criteria:
1. Expertise match — is the query complexity appropriate for the persona's skill level?
2. Domain relevance — does the query fit the industry domain?
3. Persona consistency — does the query reflect the persona's budget, interests, and personality?
4. Authenticity — does it sound like something a real person with this profile would type?

Respond with valid JSON ONLY (no markdown fences, no extra text):
{"approved": boolean, "reason": "one sentence", "suggestedQuery": "only if rejected"}`;

export class GuardrailsAgent {
  async validate(
    query: string,
    persona: Persona,
    industry: IndustryV2,
    attemptNumber = 1
  ): Promise<GuardrailResult> {
    const personaLines = Object.entries(persona)
      .filter(([k]) => !['id', 'userToken'].includes(k))
      .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? (v as unknown[]).join(', ') : v}`)
      .join('\n');

    const userMessage = `Industry: ${industry.name}\n\nPersona:\n${personaLines}\n\nProposed search query: "${query}"`;

    try {
      const raw = await callLLM(
        [{ role: 'user', content: userMessage }],
        { systemPrompt: SYSTEM_PROMPT, maxTokens: 200 },
        industry.id
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
        industryId: industry.id,
        personaId: persona.id,
        personaName: persona.name,
        originalQuery: query,
        finalQuery: query,
        attemptNumber,
        timestamp: new Date().toISOString(),
      };

      if (!result.approved) {
        console.log(
          `[Guardrails:${industry.id}] REJECTED attempt ${attemptNumber} — "${query}" for ${persona.name}: ${result.reason}`
        );
        emitToIndustry(industry.id, 'guardrail', result);
        appendGuardrailViolation(industry.id, result).catch(console.error);
      }

      return result;
    } catch (err) {
      // Fail open — if the guardrail LLM call errors, approve and continue
      console.warn(`[Guardrails:${industry.id}] Validation error, approving by default:`, err);
      return {
        approved: true,
        reason: 'Guardrail validation unavailable — approved by default',
        industryId: industry.id,
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
