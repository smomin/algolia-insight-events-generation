import { cbGet, cbUpsert } from './couchbase';
import type { GuardrailResult, SupervisorDecision, AgentConfigs } from '@/types';

const MAX_GUARDRAIL_LOG = 200;
const MAX_SUPERVISOR_DECISIONS = 100;

// ─────────────────────────────────────────────
// Guardrail violation log (per agent)
// ─────────────────────────────────────────────

export async function appendGuardrailViolation(
  agentId: string,
  violation: GuardrailResult
): Promise<void> {
  const doc = await cbGet<{ violations: GuardrailResult[] }>('agentData', `guardrails_${agentId}`);
  const violations = [violation, ...(doc?.violations ?? [])].slice(0, MAX_GUARDRAIL_LOG);
  await cbUpsert('agentData', `guardrails_${agentId}`, { violations });
}

export async function getGuardrailViolations(agentId: string): Promise<GuardrailResult[]> {
  const doc = await cbGet<{ violations: GuardrailResult[] }>('agentData', `guardrails_${agentId}`);
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

Your role is to monitor all worker agents, assess their progress against daily event targets, and dispatch work sessions to keep every agent on pace throughout the day.

You evaluate each agent's urgency based on:
- How many events have been sent today vs. the daily target
- What percentage of the day has elapsed
- How many sessions are needed to catch up

You coordinate multiple autonomous worker agents running in parallel, ensuring realistic and well-distributed event generation across all configured agents.`;

export const DEFAULT_GUARDRAILS_PROMPT = `You are a guardrails validator for an Algolia search event simulation system.

Your job: evaluate whether a proposed search query authentically represents what the given user persona would actually search for on this agent's configured site.

Evaluate these criteria:
1. Expertise match — is the query complexity appropriate for the persona's skill level?
2. Domain relevance — does the query fit the site domain?
3. Persona consistency — does the query reflect the persona's budget, interests, and personality?
4. Authenticity — does it sound like something a real person with this profile would type?

Respond with valid JSON ONLY (no markdown fences, no extra text):
{"approved": boolean, "reason": "one sentence", "suggestedQuery": "only if rejected"}`;

export const DEFAULT_WORKER_AGENT_PROMPT = `You are an autonomous Worker Agent responsible for simulating realistic Algolia search and discovery sessions for a specific e-commerce or content site.

Your role is to:
1. Generate search queries that authentically reflect the given user persona's intent, skill level, and interests
2. Select the most relevant search result for the persona from available hits
3. Build realistic browsing sessions including views, clicks, and conversions

Always stay in character as the persona. Generate queries that a real person with this profile would naturally type into a search box. Prefer specific, natural language over generic terms.`;

/** @deprecated Use DEFAULT_WORKER_AGENT_PROMPT */
export const DEFAULT_SITE_AGENT_PROMPT = DEFAULT_WORKER_AGENT_PROMPT;

export const DEFAULT_PRIMARY_INDEX_AGENT_PROMPT = `You are a Primary Index Search Agent responsible for generating realistic, persona-driven discovery queries for the primary catalog.

Your role is to simulate the initial search intent of a user arriving at the site — the first thing they type into the search bar during a browsing session.

Guidelines:
- Generate a single search query that authentically reflects the persona's intent, skill level, budget, and interests
- Use natural language a real person would type — avoid overly technical or generic terms
- Draw on the persona's specific attributes (dietary preferences, skills, budget, tags, domain-specific fields)
- Align the query with the site and index context to ensure it returns meaningful results
- Vary query styles across sessions: sometimes broad discovery ("healthy weeknight dinners"), sometimes specific ("sous vide salmon fillets"), sometimes need-based ("quick gluten-free pasta")
- Output ONLY the search query string — no quotes, no punctuation at the end, no explanation`;

export const DEFAULT_SECONDARY_INDEX_AGENT_PROMPT = `You are a Secondary Index Search Agent responsible for generating contextually relevant search queries that extend the user's journey after their primary discovery.

You are informed by what the user already found in the primary index — your queries should build a coherent, realistic session that leads toward conversion events (add-to-cart, purchase).

Guidelines:
- Base queries on the primary result's key attributes: name, category, type, style, brand, ingredients, or themes
- Consider what complementary, related, or necessary items this persona would search for next
- Stay true to the persona's budget, preferences, and behavioral patterns
- Generate queries that naturally lead toward add-to-cart or purchase actions in the secondary catalog
- Ensure each query is meaningfully different — cover distinct aspects of the complementary need
- Return a JSON array of 3 to 5 short search query strings — no markdown, no code fences, no extra text`;

const DEFAULT_AGENT_CONFIGS: AgentConfigs = {
  supervisor: { systemPrompt: DEFAULT_SUPERVISOR_PROMPT },
  guardrails: { systemPrompt: DEFAULT_GUARDRAILS_PROMPT },
  workerAgent: { systemPrompt: DEFAULT_WORKER_AGENT_PROMPT },
  primaryIndexAgent: { systemPrompt: DEFAULT_PRIMARY_INDEX_AGENT_PROMPT },
  secondaryIndexAgent: { systemPrompt: DEFAULT_SECONDARY_INDEX_AGENT_PROMPT },
};

export async function getAgentConfigs(): Promise<AgentConfigs> {
  const doc = await cbGet<AgentConfigs>('agentData', 'agent_configs');
  if (!doc) return { ...DEFAULT_AGENT_CONFIGS };
  return {
    supervisor: doc.supervisor ?? DEFAULT_AGENT_CONFIGS.supervisor,
    guardrails: doc.guardrails ?? DEFAULT_AGENT_CONFIGS.guardrails,
    // Support legacy `siteAgent` key stored in DB
    workerAgent: doc.workerAgent ?? doc.siteAgent ?? DEFAULT_AGENT_CONFIGS.workerAgent,
    primaryIndexAgent: doc.primaryIndexAgent ?? DEFAULT_AGENT_CONFIGS.primaryIndexAgent,
    secondaryIndexAgent: doc.secondaryIndexAgent ?? DEFAULT_AGENT_CONFIGS.secondaryIndexAgent,
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
    workerAgent: configs.workerAgent
      ? { ...configs.workerAgent, updatedAt: now }
      : current.workerAgent,
    primaryIndexAgent: configs.primaryIndexAgent
      ? { ...configs.primaryIndexAgent, updatedAt: now }
      : current.primaryIndexAgent,
    secondaryIndexAgent: configs.secondaryIndexAgent
      ? { ...configs.secondaryIndexAgent, updatedAt: now }
      : current.secondaryIndexAgent,
  };
  await cbUpsert('agentData', 'agent_configs', updated);
  return updated;
}
