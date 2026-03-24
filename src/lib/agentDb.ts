import { cbGet, cbUpsert } from './couchbase';
import type { GuardrailResult, SupervisorDecision } from '@/types';

const MAX_GUARDRAIL_LOG = 200;
const MAX_SUPERVISOR_DECISIONS = 100;

// ─────────────────────────────────────────────
// Guardrail violation log (per industry)
// ─────────────────────────────────────────────

export async function appendGuardrailViolation(
  industryId: string,
  violation: GuardrailResult
): Promise<void> {
  const doc = await cbGet<{ violations: GuardrailResult[] }>('agentData', `guardrails_${industryId}`);
  const violations = [violation, ...(doc?.violations ?? [])].slice(0, MAX_GUARDRAIL_LOG);
  await cbUpsert('agentData', `guardrails_${industryId}`, { violations });
}

export async function getGuardrailViolations(industryId: string): Promise<GuardrailResult[]> {
  const doc = await cbGet<{ violations: GuardrailResult[] }>('agentData', `guardrails_${industryId}`);
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
