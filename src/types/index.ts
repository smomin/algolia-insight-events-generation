// ─────────────────────────────────────────────
// Flexible N-index agent model
// ─────────────────────────────────────────────

export type AlgoliaEventType = 'view' | 'click' | 'conversion';
export type AlgoliaEventSubtype = 'addToCart' | 'purchase';

/** One configurable Algolia event within an index */
export interface IndexEvent {
  eventType: AlgoliaEventType;
  eventSubtype?: AlgoliaEventSubtype;
  eventName: string;
}

/** Per-index system prompt overrides for the IndexAgent. */
export interface IndexAgentPrompts {
  /** System prompt override for this index's agent (takes priority over global defaults). */
  systemPrompt?: string;
}

/** A configured Algolia index belonging to an agent */
export interface FlexIndex {
  id: string;        // slug unique within agent, e.g. "recipes" or "hotels"
  label: string;     // human-readable, e.g. "Recipes"
  indexName: string; // actual Algolia index name
  role: 'primary' | 'secondary';
  events: IndexEvent[];
  /** Optional per-index prompt overrides for the IndexAgent. */
  agentPrompts?: IndexAgentPrompts;
}

// ─────────────────────────────────────────────
// LLM Provider configuration
// ─────────────────────────────────────────────

export type LLMProviderType = 'openai' | 'anthropic' | 'ollama';

/** A configured LLM provider — stored (with API key encrypted) in AppConfig */
export interface LLMProviderConfig {
  id: string;           // unique slug, e.g. "my-anthropic" or "local-ollama"
  name: string;         // display name, e.g. "Anthropic (prod)"
  type: LLMProviderType;
  apiKey?: string;      // stored AES-256-GCM encrypted; not required for Ollama
  baseUrl?: string;     // required for Ollama; optional for OpenAI-compatible endpoints
  defaultModel: string; // e.g. "claude-sonnet-4-5", "gpt-4o", "llama3.2"
}

// ─────────────────────────────────────────────
// Algolia Application configuration
// ─────────────────────────────────────────────

/** A named Algolia application config — stored (with search key encrypted) in AppConfig */
export interface AlgoliaAppConfig {
  id: string;           // unique slug, e.g. "prod-us" or "staging"
  name: string;         // display name, e.g. "Production (US)"
  appId: string;        // Algolia Application ID
  searchApiKey: string; // stored AES-256-GCM encrypted
}

// ─────────────────────────────────────────────
// App-level configuration (stored encrypted in Couchbase)
// ─────────────────────────────────────────────

/** Credential fields shared by AppConfig and AgentCredentials. */
export interface CredentialFields {
  algoliaAppId?: string;
  algoliaSearchApiKey?: string; // stored AES-256-GCM encrypted
}

/** Global app credentials — single document in the appConfig collection. */
export interface AppConfig extends CredentialFields {
  updatedAt: string;
  llmProviders?: LLMProviderConfig[];        // all configured LLM providers
  defaultLlmProviderId?: string;             // provider to use when no agent override
  personaGenerationLlmProviderId?: string;   // provider used specifically for persona generation
  algoliaApps?: AlgoliaAppConfig[];          // all configured Algolia applications
  defaultAlgoliaAppId?: string;             // app to use when no agent override
}

/** Per-agent credential overrides — override global app config or env vars. */
export type AgentCredentials = CredentialFields;

/** @deprecated Use AgentCredentials */
export type SiteCredentials = AgentCredentials;

/** Full agent definition — stored in DB, editable via UI */
export interface AgentConfig {
  id: string;
  name: string;
  icon: string;
  color: string;
  siteUrl?: string;              // optional URL of the site being simulated
  indices: FlexIndex[];          // first primary, then 0-N secondaries
  claudePrompts: {
    generatePrimaryQuery: string;
    selectBestResult: string;
    generateSecondaryQueries: string;
  };
  credentials?: AgentCredentials; // optional per-agent credential overrides
  llmProviderId?: string;         // override app-level default LLM provider
  algoliaAppConfigId?: string;    // override app-level default Algolia app
  isBuiltIn: boolean;             // built-in agents cannot be deleted
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Use AgentConfig */
export type SiteConfig = AgentConfig;

// ─────────────────────────────────────────────
// Persona — generic across all agents
// ─────────────────────────────────────────────

export interface PersonaBase {
  id: string;
  name: string;
  userToken: string;
  description: string;
  agentId?: string;
  /** @deprecated Use agentId */
  site?: string;
  skill?: 'beginner' | 'intermediate' | 'advanced';
  budget?: 'low' | 'medium' | 'high';
  tags?: string[];
  // Grocery-specific (kept for backward compat)
  cookingSkill?: 'beginner' | 'intermediate' | 'advanced';
  dietaryPreferences?: string[];
  favoriteCuisines?: string[];
  avoids?: string[];
  householdSize?: number;
  timeConstraint?: string;
  shoppingFrequency?: string;
}

export type Persona = PersonaBase & Record<string, unknown>;

// ─────────────────────────────────────────────
// Algolia event types
// ─────────────────────────────────────────────

export interface InsightEvent {
  eventType: 'view' | 'click' | 'conversion';
  eventName: string;
  index: string;
  objectIDs: string[];
  userToken: string;
  timestamp: number;
  positions?: number[];
  queryID?: string;
  eventSubtype?: 'addToCart' | 'purchase';
  objectData?: ObjectData[];
  value?: number;
  currency?: string;
}

export interface ObjectData {
  queryID: string;
  price: number;
  discount: number;
  quantity: number;
}

export interface CartProduct {
  objectID: string;
  queryID: string;
  price: number;
  quantity: number;
  discount: number;
  position?: number;
}

// ─────────────────────────────────────────────
// Sent event — stored in event log
// ─────────────────────────────────────────────

export interface SentEvent {
  event: InsightEvent;
  batchStatus: number;
  sentAt: number;
  agentId?: string;
  /** @deprecated Use agentId */
  siteId?: string;
  personaId?: string;
  personaName?: string;
  sessionId?: string;
}

// ─────────────────────────────────────────────
// Session result (returned from run-session API)
// ─────────────────────────────────────────────

export interface SessionResult {
  persona: Persona;
  generatedPrimaryQuery: string;
  selectedPrimaryResult: {
    objectID: string;
    name: string;
    position: number;
    selectionReason: string;
  };
  primaryQueryID: string;
  secondaryQueries: string[];
  cartProducts: CartProduct[];
  totalCartValue: number;
  totalPurchaseValue: number;
  events: SentEvent[];
  success: boolean;
  error?: string;
}

// ─────────────────────────────────────────────
// Session record — stored in DB per-agent
// ─────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  agentId: string;
  /** @deprecated Use agentId */
  siteId?: string;
  personaId: string;
  personaName: string;
  startedAt: string;
  completedAt: string;
  totalEventsCount: number;
  eventsByIndex: Record<string, number>; // FlexIndex.id → event count
  success: boolean;
  error?: string;
}

// ─────────────────────────────────────────────
// Scheduler run record
// ─────────────────────────────────────────────

export interface SchedulerRun {
  id: string;
  agentId: string;
  /** @deprecated Use agentId */
  siteId?: string;
  startedAt: string;
  completedAt?: string;
  sessionsPlanned: number;
  sessionsCompleted: number;
  totalEventsSent: number;
  eventsByIndex: Record<string, number>; // FlexIndex.id → event count
  errors: string[];
}

// ─────────────────────────────────────────────
// Per-agent daily counters (N-index)
// ─────────────────────────────────────────────

export interface AgentCounters {
  date: string;
  byIndex: Record<string, number>; // FlexIndex.id → count today
}

/** @deprecated Use AgentCounters */
export type SiteCounters = AgentCounters;

// ─────────────────────────────────────────────
// DB schema
// ─────────────────────────────────────────────

export interface AgentData {
  counters: AgentCounters;
  eventLog: SentEvent[];
  schedulerRuns: SchedulerRun[];
  sessions: SessionRecord[];
}

/** @deprecated Use AgentData */
export type SiteData = AgentData;

export interface DbSchema {
  agentConfigs: Record<string, AgentConfig>; // all agent definitions
  agents: Record<string, AgentData>;         // per-agent runtime data
}

// ─────────────────────────────────────────────
// Scheduler status (returned from status API)
// ─────────────────────────────────────────────

export interface AgentSchedulerStatus {
  agentId: string;
  /** @deprecated Use agentId */
  siteId?: string;
  isRunning: boolean;
  isDistributing: boolean;
  nextRun: string | null;
  counters: AgentCounters;
  eventLimit: number;
  lastRun: SchedulerRun | null;
  currentRun: SchedulerRun | null;
}

/** @deprecated Use AgentSchedulerStatus */
export type SiteSchedulerStatus = AgentSchedulerStatus;

export interface AllSchedulerStatus {
  agents: Record<string, AgentSchedulerStatus>;
  /** @deprecated Use agents */
  sites?: Record<string, AgentSchedulerStatus>;
}

// ─────────────────────────────────────────────
// Agent system types
// ─────────────────────────────────────────────

export type AgentPhase =
  | 'idle'
  | 'planning'
  | 'validating'
  | 'searching'
  | 'sending'
  | 'complete'
  | 'error';

export interface AgentState {
  agentId: string;
  /** @deprecated Use agentId */
  siteId?: string;
  phase: AgentPhase;
  currentPersonaId?: string;
  currentPersonaName?: string;
  currentQuery?: string;
  sessionsCompleted: number;
  sessionsTarget: number;
  eventsSentToday: number;
  dailyTarget: number;
  guardrailViolations: number;
  lastActivity: string;
  errors: string[];
  isActive: boolean;
}

export interface GuardrailResult {
  approved: boolean;
  reason: string;
  suggestedQuery?: string;
  agentId: string;
  /** @deprecated Use agentId */
  siteId?: string;
  personaId: string;
  personaName: string;
  originalQuery: string;
  finalQuery: string;
  attemptNumber: number;
  timestamp: string;
}

export type SupervisorUrgency = 'ahead' | 'normal' | 'high' | 'critical';

export interface SupervisorDecision {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  /** @deprecated Use agentId */
  siteId?: string;
  /** @deprecated Use agentName */
  siteName?: string;
  urgency: SupervisorUrgency;
  sessionsDispatched: number;
  reasoning: string;
  progressSnapshot: {
    sent: number;
    target: number;
    percentComplete: number;
  };
}

export interface AgentSystemStatus {
  isActive: boolean;
  startedAt?: string;
  mode: 'supervisor' | 'off';
  agents: Record<string, AgentState>;
  recentDecisions: SupervisorDecision[];
  supervisorStatus: {
    isRunning: boolean;
    startedAt?: string;
    lastRunAt?: string;
  };
}

// ─────────────────────────────────────────────
// Agent configuration (editable system prompts)
// ─────────────────────────────────────────────

export interface AgentPromptConfig {
  systemPrompt: string;
  updatedAt?: string;
  /** Optional LLM provider override for this agent role (supervisor / guardrails). */
  llmProviderId?: string;
}

export interface AgentConfigs {
  supervisor: AgentPromptConfig;
  guardrails: AgentPromptConfig;
  workerAgent: AgentPromptConfig;
  /** System prompt for primary index agents (drives initial discovery queries). */
  primaryIndexAgent: AgentPromptConfig;
  /** System prompt for secondary index agents (extends journey from primary result context). */
  secondaryIndexAgent: AgentPromptConfig;
  /** @deprecated Use workerAgent */
  siteAgent?: AgentPromptConfig;
}
