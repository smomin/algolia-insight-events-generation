// ─────────────────────────────────────────────
// Flexible N-index industry model (V2)
// ─────────────────────────────────────────────

export type AlgoliaEventType = 'view' | 'click' | 'conversion';
export type AlgoliaEventSubtype = 'addToCart' | 'purchase';

/** One configurable Algolia event within an index */
export interface IndexEvent {
  eventType: AlgoliaEventType;
  eventSubtype?: AlgoliaEventSubtype;
  eventName: string;
}

/** A configured Algolia index belonging to an industry */
export interface FlexIndex {
  id: string;       // slug unique within industry, e.g. "recipes" or "hotels"
  label: string;    // human-readable, e.g. "Recipes"
  indexName: string; // actual Algolia index name
  role: 'primary' | 'secondary';
  events: IndexEvent[];
}

// ─────────────────────────────────────────────
// App-level configuration (stored encrypted in Couchbase)
// ─────────────────────────────────────────────

/** Credential fields shared by AppConfig and IndustryCredentials. */
export interface CredentialFields {
  algoliaAppId?: string;
  algoliaSearchApiKey?: string;   // stored AES-256-GCM encrypted
  anthropicApiKey?: string;       // stored AES-256-GCM encrypted
}

/** Global app credentials — single document in the appConfig collection. */
export interface AppConfig extends CredentialFields {
  updatedAt: string;
}

/** Per-industry credential overrides — override global app config or env vars. */
export type IndustryCredentials = CredentialFields;

/** Full industry definition — stored in DB, editable via UI */
export interface IndustryV2 {
  id: string;
  name: string;
  icon: string;
  color: string;
  indices: FlexIndex[];        // first primary, then 0-N secondaries
  claudePrompts: {
    generatePrimaryQuery: string;
    selectBestResult: string;
    generateSecondaryQueries: string;
  };
  credentials?: IndustryCredentials; // optional per-industry credential overrides
  isBuiltIn: boolean;          // built-in industries cannot be deleted
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// Persona — generic across all industries
// ─────────────────────────────────────────────

export interface PersonaBase {
  id: string;
  name: string;
  userToken: string;
  description: string;
  industry?: string;
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
  industryId?: string;
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
// Session record — stored in DB per-industry
// ─────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  industryId: string;
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
  industryId: string;
  startedAt: string;
  completedAt?: string;
  sessionsPlanned: number;
  sessionsCompleted: number;
  totalEventsSent: number;
  eventsByIndex: Record<string, number>; // FlexIndex.id → event count
  errors: string[];
}

// ─────────────────────────────────────────────
// Per-industry daily counters (N-index)
// ─────────────────────────────────────────────

export interface IndustryCounters {
  date: string;
  byIndex: Record<string, number>; // FlexIndex.id → count today
}

// ─────────────────────────────────────────────
// DB schema
// ─────────────────────────────────────────────

export interface IndustryData {
  counters: IndustryCounters;
  eventLog: SentEvent[];
  schedulerRuns: SchedulerRun[];
  sessions: SessionRecord[];
}

export interface DbSchema {
  industryConfigs: Record<string, IndustryV2>; // all industry definitions
  industries: Record<string, IndustryData>;    // per-industry runtime data
}

// ─────────────────────────────────────────────
// Scheduler status (returned from status API)
// ─────────────────────────────────────────────

export interface IndustrySchedulerStatus {
  industryId: string;
  isRunning: boolean;
  isDistributing: boolean;
  nextRun: string | null;
  counters: IndustryCounters;
  eventLimit: number;
  lastRun: SchedulerRun | null;
  currentRun: SchedulerRun | null;
}

export interface AllSchedulerStatus {
  industries: Record<string, IndustrySchedulerStatus>;
}
