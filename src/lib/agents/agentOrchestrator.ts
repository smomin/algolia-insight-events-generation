/**
 * AgentOrchestrator — top-level lifecycle manager for the agentic system.
 *
 * Responsible for:
 *  - Loading personas for all industries on startup
 *  - Starting / stopping the SupervisorAgent
 *  - Exposing unified status for the API layer
 *
 * Persists on globalThis to survive Next.js hot reloads.
 */

import type { Persona, AgentSystemStatus } from '@/types';
import { cbGet } from '@/lib/couchbase';
import { getAllIndustries } from '@/lib/industries';
import {
  startSupervisor,
  stopSupervisor,
  isSupervisorRunning,
  getSupervisorStatus,
} from './SupervisorAgent';
import { getAllAgentStates } from './IndustryAgent';
import { getSupervisorDecisions } from '@/lib/agentDb';

// ─────────────────────────────────────────────
// Orchestrator state
// ─────────────────────────────────────────────

interface OrchestratorState {
  isActive: boolean;
  startedAt?: string;
  personasByIndustry: Record<string, Persona[]>;
}

const g = globalThis as typeof globalThis & { _orchestratorState?: OrchestratorState };
if (!g._orchestratorState) {
  g._orchestratorState = { isActive: false, personasByIndustry: {} };
}
const state = g._orchestratorState;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function loadPersonasForIndustry(industryId: string): Promise<Persona[]> {
  const doc = await cbGet<{ personas: Persona[] }>('personas', industryId);
  return doc?.personas ?? [];
}

async function loadAllPersonas(): Promise<Record<string, Persona[]>> {
  const industries = await getAllIndustries();
  const result: Record<string, Persona[]> = {};
  await Promise.all(
    industries.map(async (industry) => {
      result[industry.id] = await loadPersonasForIndustry(industry.id);
    })
  );
  return result;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export async function startAgentSystem(): Promise<void> {
  if (state.isActive) return;

  console.log('[Orchestrator] Starting agent system...');

  state.personasByIndustry = await loadAllPersonas();
  state.isActive = true;
  state.startedAt = new Date().toISOString();

  startSupervisor(state.personasByIndustry);

  const industriesLoaded = Object.keys(state.personasByIndustry).length;
  const totalPersonas = Object.values(state.personasByIndustry).reduce(
    (s, arr) => s + arr.length,
    0
  );
  console.log(
    `[Orchestrator] Agent system started — ${industriesLoaded} industries, ${totalPersonas} personas loaded`
  );
}

export function stopAgentSystem(): void {
  stopSupervisor();
  state.isActive = false;
  console.log('[Orchestrator] Agent system stopped.');
}

export function isAgentSystemActive(): boolean {
  return state.isActive;
}

/** Reload personas for all industries (called after a persona update). */
export async function refreshPersonas(): Promise<void> {
  state.personasByIndustry = await loadAllPersonas();
  console.log('[Orchestrator] Personas refreshed.');
}

export async function getAgentSystemStatus(): Promise<AgentSystemStatus> {
  const supervisorStatus = getSupervisorStatus();
  const agentStates = getAllAgentStates();
  const recentDecisions = await getSupervisorDecisions();

  return {
    isActive: state.isActive,
    startedAt: state.startedAt,
    mode: state.isActive ? 'supervisor' : 'off',
    supervisorStatus: {
      isRunning: supervisorStatus.isRunning,
      startedAt: supervisorStatus.startedAt,
      lastRunAt: supervisorStatus.lastRunAt,
    },
    agents: agentStates,
    recentDecisions: recentDecisions.slice(0, 20),
  };
}
