/**
 * AgentOrchestrator — top-level lifecycle manager for the agentic system.
 *
 * Responsible for:
 *  - Loading personas for all agents on startup
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
import { getAllAgentStates } from './WorkerAgent';
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

export async function startAgentSystem(agentIds?: string[]): Promise<void> {
  if (state.isActive) {
    log.warn('startAgentSystem called but system is already active');
    return;
  }

  log.info('starting agent system', { agentIds: agentIds ?? 'all' });
  state.isActive = true;
  state.startedAt = new Date().toISOString();

  startSupervisor(agentIds);
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

export function getAgentSystemStatus(): AgentSystemStatus {
  const supervisorStatus = getSupervisorStatus();
  const agentStates = getAllAgentStates();

  // Use in-memory decisions already maintained by SupervisorAgent on globalThis —
  // avoids a Couchbase round-trip on every status poll which could hang the API.
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
    recentDecisions: supervisorStatus.recentDecisions.slice(0, 20),
  };
}
