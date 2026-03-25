import { cbGet, cbUpsert } from './couchbase';
import type { GuardrailResult, SupervisorDecision, AgentConfigs } from '@/types';

const MAX_GUARDRAIL_LOG = 200;
const MAX_SUPERVISOR_DECISIONS = 100;

// ─────────────────────────────────────────────
// Guardrail violation log (per site)
// ─────────────────────────────────────────────

export async function appendGuardrailViolation(
  siteId: string,
  violation: GuardrailResult
): Promise<void> {
  const doc = await cbGet<{ violations: GuardrailResult[] }>('agentData', `guardrails_${siteId}`);
  const violations = [violation, ...(doc?.violations ?? [])].slice(0, MAX_GUARDRAIL_LOG);
  await cbUpsert('agentData', `guardrails_${siteId}`, { violations });
}

export async function getGuardrailViolations(siteId: string): Promise<GuardrailResult[]> {
  const doc = await cbGet<{ violations: GuardrailResult[] }>('agentData', `guardrails_${siteId}`);
  return doc?.violations ?? [];
}

// ─────────────────────────────────────────────
// Supervisor decision log (global)
// ─────────────────────────────────────────────

export async function appendSupervisorDecision(decision: SupervisorDecision): Promise<void> {
  const doc = await cbGet<{ decisions: SupervisorDecision[] }>('agentData', 'supervisor_log');
  const decisions = [decision, ...(doc?.decisions ?? [])].slice(0, MAX_SUPERVISOR_DECISIONS);
  await cbUpsert('agentData', 'supervisor_log', { decisions });
}

export async function getSupervisorDecisions(): Promise<SupervisorDecision[]> {
  const doc = await cbGet<{ decisions: SupervisorDecision[] }>('agentData', 'supervisor_log');
  return doc?.decisions ?? [];
}

// ─────────────────────────────────────────────
// Agent configuration (editable system prompts)
// ─────────────────────────────────────────────

export const DEFAULT_SUPERVISOR_PROMPT = `You are the Supervisor Agent, an autonomous orchestrator for the Algolia Insights event generation system.

Your role is to monitor all site agents, assess their progress against daily event targets, and dispatch work sessions to keep every site on pace throughout the day.

You evaluate each site's urgency based on:
- How many events have been sent today vs. the daily target
- What percentage of the day has elapsed
- How many sessions are needed to catch up

You coordinate multiple autonomous site agents running in parallel, ensuring realistic and well-distributed event generation across all configured sites.`;

export const DEFAULT_GUARDRAILS_PROMPT = `You are a guardrails validator for an Algolia search event simulation system.

Your job: evaluate whether a proposed search query authentically represents what the given user persona would actually search for on this site.

Evaluate these criteria:
1. Expertise match — is the query complexity appropriate for the persona's skill level?
2. Domain relevance — does the query fit the site domain?
3. Persona consistency — does the query reflect the persona's budget, interests, and personality?
4. Authenticity — does it sound like something a real person with this profile would type?

Respond with valid JSON ONLY (no markdown fences, no extra text):
{"approved": boolean, "reason": "one sentence", "suggestedQuery": "only if rejected"}`;

export const DEFAULT_SITE_AGENT_PROMPT = `You are an autonomous Site Agent responsible for simulating realistic Algolia search and discovery sessions for a specific e-commerce or content site.

Your role is to:
1. Generate search queries that authentically reflect the given user persona's intent, skill level, and interests
2. Select the most relevant search result for the persona from available hits
3. Build realistic browsing sessions including views, clicks, and conversions

Always stay in character as the persona. Generate queries that a real person with this profile would naturally type into a search box. Prefer specific, natural language over generic terms.`;

const DEFAULT_AGENT_CONFIGS: AgentConfigs = {
  supervisor: { systemPrompt: DEFAULT_SUPERVISOR_PROMPT },
  guardrails: { systemPrompt: DEFAULT_GUARDRAILS_PROMPT },
  siteAgent: { systemPrompt: DEFAULT_SITE_AGENT_PROMPT },
};

export async function getAgentConfigs(): Promise<AgentConfigs> {
  const doc = await cbGet<AgentConfigs>('agentData', 'agent_configs');
  if (!doc) return { ...DEFAULT_AGENT_CONFIGS };
  return {
    supervisor: doc.supervisor ?? DEFAULT_AGENT_CONFIGS.supervisor,
    guardrails: doc.guardrails ?? DEFAULT_AGENT_CONFIGS.guardrails,
    siteAgent: doc.siteAgent ?? DEFAULT_AGENT_CONFIGS.siteAgent,
  };
}

export async function upsertAgentConfigs(configs: Partial<AgentConfigs>): Promise<AgentConfigs> {
  const current = await getAgentConfigs();
  const now = new Date().toISOString();
  const updated: AgentConfigs = {
    supervisor: configs.supervisor
      ? { ...configs.supervisor, updatedAt: now }
      : current.supervisor,
    guardrails: configs.guardrails
      ? { ...configs.guardrails, updatedAt: now }
      : current.guardrails,
    siteAgent: configs.siteAgent
      ? { ...configs.siteAgent, updatedAt: now }
      : current.siteAgent,
  };
  await cbUpsert('agentData', 'agent_configs', updated);
  return updated;
}
