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

import type { AgentSystemStatus } from '@/types';
import {
  startSupervisor,
  stopSupervisor,
  getSupervisorStatus,
  runSupervisorTickNow,
} from './SupervisorAgent';
import { getAllAgentStates } from './IndustryAgent';
import { getSupervisorDecisions } from '@/lib/agentDb';
import { createLogger } from '@/lib/logger';

const log = createLogger('Orchestrator');

// ─────────────────────────────────────────────
// Orchestrator state
// ─────────────────────────────────────────────

interface OrchestratorState {
  isActive: boolean;
  startedAt?: string;
}

const g = globalThis as typeof globalThis & { _orchestratorState?: OrchestratorState };
if (!g._orchestratorState) {
  g._orchestratorState = { isActive: false };
}
const state = g._orchestratorState;

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export async function startAgentSystem(): Promise<void> {
  if (state.isActive) {
    log.warn('startAgentSystem called but system is already active');
    return;
  }

  log.info('starting agent system');
  state.isActive = true;
  state.startedAt = new Date().toISOString();

  startSupervisor();
  log.info('agent system started', { startedAt: state.startedAt });
}

export function stopAgentSystem(): void {
  log.info('stopping agent system');
  stopSupervisor();
  state.isActive = false;
  log.info('agent system stopped');
}

export function isAgentSystemActive(): boolean {
  return state.isActive;
}

/** Force an immediate supervisor tick (useful from the UI "Run Now" button). */
export function triggerSupervisorNow(): void {
  log.info('manual supervisor tick triggered');
  runSupervisorTickNow();
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
