# Algolia Insights Event Generator — Project Details

## Overview

A **Next.js 14 + TypeScript** application that simulates realistic Algolia Insights events for multiple industry verticals simultaneously. It uses **Anthropic Claude** to generate persona-driven search queries, selects relevant results, builds event sequences, and sends the full event lifecycle (view → click → conversion) to the Algolia Insights API. A built-in per-industry scheduler distributes up to **1,000 events per index per day** with realistic timing variation.

Industries supported out of the box: **Grocery, Finance, Healthcare, Adventure, Travel (Cruises)**. Any number of additional industries can be added through the UI.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| LLM | Anthropic SDK — `claude-sonnet-4-6`, `maxRetries: 4`, `timeout: 60s` |
| Search | `algoliasearch` v5 |
| Insights | Algolia Insights REST API |
| Scheduler | `node-cron` (per-industry instances) |
| Database | **Couchbase Server Community Edition** (local Docker) |
| DB SDK | `couchbase` npm package (native Node.js SDK) |
| Encryption | Node.js `crypto` — AES-256-GCM for API key storage |
| Styling | Tailwind CSS |

---

## Project Structure

```
/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── app-config/
│   │   │   │   └── route.ts              # GET/PUT global credentials
│   │   │   ├── industries/
│   │   │   │   ├── route.ts              # GET all / POST create industry
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts          # GET/PUT/DELETE single industry
│   │   │   │       ├── personas/
│   │   │   │       │   └── route.ts      # GET/POST/PUT/DELETE personas
│   │   │   │       └── generate-personas/
│   │   │   │           └── route.ts      # POST — AI persona generation
│   │   │   ├── scheduler/
│   │   │   │   ├── start/route.ts        # POST — start cron / trigger now
│   │   │   │   ├── stop/route.ts         # POST — stop cron + cancel run
│   │   │   │   └── status/route.ts       # GET  — merged in-memory + DB status
│   │   │   ├── run-all/route.ts          # POST — fire-and-forget distribution
│   │   │   ├── event-log/route.ts        # GET/DELETE event log
│   │   │   └── sessions/route.ts         # GET session history
│   │   ├── components/
│   │   │   ├── AppConfigPanel.tsx        # Modal: global API credentials
│   │   │   ├── IndustryEditor.tsx        # Create/edit industry, indices, events, credentials
│   │   │   ├── PersonaSelector.tsx       # Persona cards + run session
│   │   │   ├── PersonaEditorModal.tsx    # Edit / delete individual persona
│   │   │   ├── GeneratePersonasModal.tsx # AI persona generation modal
│   │   │   ├── SchedulerControls.tsx     # Start / Stop / Trigger / Stop Run
│   │   │   ├── SessionHistory.tsx        # Per-industry session history table
│   │   │   ├── SessionCard.tsx           # Latest session result card
│   │   │   └── EventLog.tsx              # Real-time scrolling event log
│   │   ├── icon.svg                      # Algolia-style favicon
│   │   ├── layout.tsx
│   │   └── page.tsx                      # Main dashboard with industry switcher
│   ├── lib/
│   │   ├── couchbase.ts                  # Singleton connection + collection bootstrap
│   │   ├── db.ts                         # All Couchbase CRUD helpers + distribution state
│   │   ├── appConfig.ts                  # Global credential store + resolve + encrypt
│   │   ├── crypto.ts                     # AES-256-GCM encrypt / decrypt
│   │   ├── industries.ts                 # Industry + persona read helpers
│   │   ├── scheduler.ts                  # Per-industry cron + distribution loop
│   │   ├── algolia.ts                    # Search + sample index (async, credential-aware)
│   │   ├── anthropic.ts                  # Claude queries + persona generation
│   │   └── insights.ts                   # Build + send Insights events
│   └── types/
│       └── index.ts                      # All shared TypeScript interfaces
├── .env                                  # ENCRYPTION_SECRET + Couchbase + scheduler config
├── .env.local.example                    # Template (API keys managed via UI/DB)
└── next.config.mjs                       # couchbase + node-cron marked as external packages
```

---

## Architecture

### Multi-Industry Model

Each **industry** is a fully independent unit stored in Couchbase with:

- **N configurable Algolia indices** (one `primary`, zero or more `secondary`)
- **Per-index event definitions** (any combination of view / click / conversion / addToCart / purchase event types)
- **Claude prompt templates** (stored per-industry, editable in UI)
- **Personas** (stored in DB, AI-generatable, fully editable)
- **Optional credential overrides** (industry-specific Algolia + Anthropic keys)
- **Its own scheduler instance** (cron task, distribution loop, daily counters)
- **Its own session history, event log, and scheduler run history**

All industries can run simultaneously and independently.

### Session Flow (per persona)

```
1. generatePrimaryQuery(persona, industry.claudePrompts.generatePrimaryQuery)
   → Claude → short search query string

2. searchIndex(primaryIndex.indexName, query, persona.userToken, clickAnalytics: true)
   → Algolia → { hits, queryID }

3. selectBestResult(persona, hits, industry.claudePrompts.selectBestResult)
   → Claude → { index, reason }

4. buildFlexIndexEvents(persona, primaryIndex, selectedHit, position, queryID)
   → Event objects for all configured primary index events

5. generateSecondaryQueries(selectedHit, persona, industry.claudePrompts.generateSecondaryQueries)
   → Claude → string[]

6. For each secondary index:
   → Search with each secondary query
   → buildFlexIndexEvents(persona, secondaryIndex, hit, position, queryID, cartProducts)

7. sendEvents(allEvents, industry.id)
   → POST https://insights.algolia.io/1/events
   → On HTTP 200: incrementIndexCounter, appendEventLog, appendSession
```

### Credential Resolution Order

For every Algolia and Anthropic API call, credentials are resolved as:

1. Industry-level credential override (stored encrypted in Couchbase)
2. Global app config (stored encrypted in Couchbase)
3. Environment variable fallback

---

## Couchbase Data Model

**Bucket**: `algolia-insights`  
**Collections**: `industryConfigs`, `personas`, `counters`, `eventLogs`, `schedulerRuns`, `sessions`, `appConfig`

All collections use a key-value model. Indices (manifests) are stored as `_index` documents for each collection.

### Key Documents

| Collection | Key Pattern | Contents |
|---|---|---|
| `industryConfigs` | `{industryId}` | Full `IndustryV2` object |
| `personas` | `{industryId}` | `{ personas: Persona[] }` |
| `counters` | `{industryId}` | `{ date, byIndex: Record<indexId, count> }` |
| `counters` | `{industryId}_dist` | `{ isDistributing, cancelRequested, runId, startedAt }` |
| `eventLogs` | `{industryId}` | `{ events: SentEvent[] }` (last 500) |
| `schedulerRuns` | `{industryId}` | `{ runs: SchedulerRun[] }` (last 50) |
| `sessions` | `{industryId}` | `{ sessions: SessionRecord[] }` (last 200) |
| `appConfig` | `appConfig` | `{ algoliaAppId, algoliaSearchApiKey, anthropicApiKey, updatedAt }` |

---

## Environment Variables (`.env`)

```env
# Required — AES-256-GCM key for encrypting API keys in Couchbase
ENCRYPTION_SECRET=<64-char hex string>

# Couchbase Server (local Docker)
COUCHBASE_URL=couchbase://localhost
COUCHBASE_USERNAME=Administrator
COUCHBASE_PASSWORD=password
COUCHBASE_BUCKET=algolia-insights

# Scheduler
SCHEDULER_TIMEZONE=America/Los_Angeles
SCHEDULER_CRON=0 6 * * *

# Daily event budget per index (default 1000)
DAILY_EVENT_LIMIT_PER_INDEX=1000
NEXT_PUBLIC_DAILY_EVENT_LIMIT=1000
EVENTS_PER_SESSION=7
```

**API credentials (Algolia App ID, Search API Key, Anthropic API Key) are NOT stored in `.env`.**  
They are entered via the **App Configuration** panel in the UI, encrypted with AES-256-GCM, and stored in Couchbase. Per-industry overrides are set in the **Industry Editor**.

---

## Key TypeScript Types (`src/types/index.ts`)

```typescript
// One configurable event within an index
interface IndexEvent {
  eventType: 'view' | 'click' | 'conversion';
  eventSubtype?: 'addToCart' | 'purchase';
  eventName: string;
}

// A configured Algolia index within an industry
interface FlexIndex {
  id: string;           // slug, e.g. "activities" or "itineraries"
  label: string;        // display label
  indexName: string;    // actual Algolia index name
  role: 'primary' | 'secondary';
  events: IndexEvent[];
}

// Full industry definition
interface IndustryV2 {
  id: string;
  name: string;
  icon: string;
  color: string;
  indices: FlexIndex[];
  claudePrompts: {
    generatePrimaryQuery: string;
    selectBestResult: string;
    generateSecondaryQueries: string;
  };
  credentials?: {
    algoliaAppId?: string;
    algoliaSearchApiKey?: string;   // AES-256-GCM encrypted
    anthropicApiKey?: string;       // AES-256-GCM encrypted
  };
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

// Generic persona (flexible extra fields via Record<string, unknown>)
type Persona = {
  id: string;
  name: string;
  userToken: string;
  description: string;
  industry?: string;
  skill?: 'beginner' | 'intermediate' | 'advanced';
  budget?: 'low' | 'medium' | 'high';
  tags?: string[];
  [key: string]: unknown;
}

// Session result stored per-run in Couchbase
interface SessionRecord {
  id: string;
  industryId: string;
  personaId: string;
  personaName: string;
  startedAt: string;
  completedAt: string;
  totalEventsCount: number;
  eventsByIndex: Record<string, number>;  // FlexIndex.id → count
  success: boolean;
  error?: string;
}

// Scheduler distribution run record
interface SchedulerRun {
  id: string;
  industryId: string;
  startedAt: string;
  completedAt?: string;
  sessionsPlanned: number;
  sessionsCompleted: number;
  totalEventsSent: number;
  eventsByIndex: Record<string, number>;
  errors: string[];
}

// Per-industry daily counters
interface IndustryCounters {
  date: string;
  byIndex: Record<string, number>;  // FlexIndex.id → events today
}

// Persisted distribution state (Couchbase — survives hot reloads)
interface DistributionState {
  isDistributing: boolean;
  runId?: string;
  startedAt?: string;
  cancelRequested: boolean;
}
```

---

## Scheduler Architecture

### Per-Industry State

Each industry has an independent `IndustrySchedulerState` held in a module-level Map:

```typescript
interface IndustrySchedulerState {
  task: cron.ScheduledTask | null;   // null = cron stopped
  currentRun: SchedulerRun | null;
  isDistributing: boolean;
  cancelRequested: boolean;
}
```

### Persisted Distribution State

Because Next.js dev mode hot-reloads wipe module-level state, a `{industryId}_dist` document in the `counters` collection mirrors the distribution status. On every status poll the API merges in-memory and persisted state:

```
isDistributing = inMemory.isDistributing || db.isDistributing
cancelRequested = db.cancelRequested
```

**Stale state detection**: If the DB shows `isDistributing: true` but in-memory says no, and the run started more than **10 minutes ago**, the status API auto-clears the stale document. This self-heals any state left behind by crashed or force-killed processes.

### Cancellation Flow

1. User clicks **Stop Run** in the UI
2. `POST /api/scheduler/stop` → calls `cancelDistribution(industryId)`
3. Sets `state.cancelRequested = true` (in-memory) AND writes `cancelRequested: true` to Couchbase
4. Distribution loop checks in-memory flag on **every session**; checks DB flag every **5 sessions** (for cross-hot-reload coverage)
5. Loop breaks after the current session completes
6. Cleanup: `state.isDistributing = false`, `state.cancelRequested = false`, DB `cancelRequested` and `isDistributing` both set to `false`
7. UI transitions button from **"Stopping…"** (grey, disabled) → **"Trigger Now"**

### UI State Feedback

| Distribution State | Button | Header Badge |
|---|---|---|
| Not running | "Trigger Now" (blue) | — |
| Running | "Stop Run" (orange, pulsing dot) | "Distributing" (amber, pulsing) |
| Stop requested | "Stopping…" (grey, disabled) | "Stopping…" (grey, pulsing) |

---

## Credential Management

### Encryption

All sensitive API keys are encrypted with **AES-256-GCM** before writing to Couchbase:

- Key derived from `ENCRYPTION_SECRET` env var via `scryptSync`
- Stored format: `{iv_hex}:{authTag_hex}:{ciphertext_hex}`
- `isEncrypted(value)` utility detects encrypted strings

### App Configuration Panel

Global credentials entered via the gear icon (⚙) in the top-right of the dashboard:

- Algolia App ID
- Algolia Search API Key
- Anthropic API Key

Each field shows a **source badge**: `saved` (in DB) / `env` (from env var) / `not set`.

### Industry Credential Overrides

Each industry in the **Industry Editor** has a collapsible "Credential Overrides" section. If set, these take priority over the global app config. Useful for multi-tenant Algolia account setups.

---

## AI Persona Generation

**Button**: "Generate Personas" on the persona panel  
**Modal**: Enter number of personas to create (1–100)

### Flow

1. `sampleIndex` fetches 20+ records from each configured index using the Algolia browse API
2. Sampled records are passed to `generatePersonasForIndustry` in `anthropic.ts`
3. Claude receives the index samples + existing persona list to avoid duplicates
4. Claude returns N new persona objects as JSON matching the `Persona` schema
5. Generated personas are upserted to the `personas` collection in Couchbase
6. UI refreshes the persona grid

---

## Claude Prompt Configuration

Each industry stores three prompts in Couchbase, editable via the Industry Editor UI:

| Prompt | Purpose | Output Format |
|---|---|---|
| `generatePrimaryQuery` | Generate a search query for the primary index based on the persona | Plain string (2–5 words) |
| `selectBestResult` | Select the best hit from primary search results for the persona | `{ "index": N, "reason": "..." }` |
| `generateSecondaryQueries` | Generate queries for secondary indices based on the selected primary hit | `["query1", "query2", ...]` |

### Travel / Cruise Industry Example

```
generatePrimaryQuery:
  "You are simulating a cruise traveler browsing shore excursion activities.
   The activities catalog covers: Alaska, Asia (Japan, South Korea, Vietnam),
   Australia, and Middle East (Dubai, Jordan, Jerusalem). Activity types:
   Adventure, Cultural, Dining, Entertainment, Food & Wine, Outdoor,
   Photography, Scenic Flight, Sightseeing, Water Activity, Wildlife.
   Generate a SHORT 2-4 word search query using one destination name or
   activity type keyword. Output only the query string."

selectBestResult:
  "You are a cruise shore excursion recommender. Select the result that best
   matches the persona's destination interests, activity preferences, and
   budget. Return JSON only: {\"index\": N, \"reason\": \"...\"}."

generateSecondaryQueries:
  "You are a cruise itinerary matchmaker. Based on the selected activity's
   destination, generate 3-5 short queries to find cruise itineraries that
   visit that destination. Catalog covers: Alaska (Seattle), Asia, Australia,
   Middle East. Return JSON array only."
```

---

## UI Overview

### Dashboard Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ⚙ App Config   [Finance] [Healthcare] [Adventure] [Travel]  │  ← Industry switcher
│                 [Grocery] [+ Add Industry]                    │
├──────────────────────────────────────┬───────────────────────┤
│  Scheduler                           │  Daily Counters        │
│  [Start Scheduler] [Trigger Now]     │  ┌ activities: X/1000 │
│  ● Distributing  or  ○ Stopped       │  └ itineraries: X/1000│
│  Sessions done: N running…           │                        │
│  Last run: N sessions, N events      │                        │
├──────────────────────────────────────┴───────────────────────┤
│  Personas  [Generate Personas]                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐│
│  │ Persona Card     │  │ Persona Card     │  │ ...          ││
│  │ [Run] [Edit]     │  │ [Run] [Edit]     │  │              ││
│  └──────────────────┘  └──────────────────┘  └──────────────┘│
├───────────────────────────────────────────────────────────────┤
│  Session History  🔴 LIVE                                      │
│  Started | Persona | Events | Status (ERR has tooltip)         │
├───────────────────────────────────────────────────────────────┤
│  Event Log  (last 500 · color-coded by type)                  │
└───────────────────────────────────────────────────────────────┘
```

### Key UI Behaviours

- **Industry switcher**: tabs at the top; each tab loads its own scheduler, personas, sessions, event log
- **Adaptive polling**: 60s when idle → 10s when any industry is distributing → 3s for session history/event log during active run
- **Session History**: shows `ERR` badge with `cursor-help` on failed sessions; hovering reveals the full error in a tooltip
- **Live badge**: amber pulsing "LIVE" indicator on Session History header when a run is active
- **Persona Editor Modal**: edit name, description, skill, budget, tags, and arbitrary custom key-value fields; includes delete with confirmation

---

## API Routes Reference

### Industry Management

| Method | Route | Description |
|---|---|---|
| GET | `/api/industries` | List all industries |
| POST | `/api/industries` | Create new industry |
| GET | `/api/industries/[id]` | Get single industry |
| PUT | `/api/industries/[id]` | Update industry config |
| DELETE | `/api/industries/[id]` | Delete industry |
| GET | `/api/industries/[id]/personas` | List personas |
| POST | `/api/industries/[id]/personas` | Bulk replace personas |
| PUT | `/api/industries/[id]/personas` | Upsert single persona |
| DELETE | `/api/industries/[id]/personas?personaId=X` | Delete persona |
| POST | `/api/industries/[id]/generate-personas` | AI-generate personas |

### Scheduler

| Method | Route | Body | Description |
|---|---|---|---|
| POST | `/api/scheduler/start` | `{ industryId, runNow? }` | Start cron; optionally trigger immediately |
| POST | `/api/scheduler/stop` | `{ industryId }` or `{ stopAll: true }` | Stop cron + request cancel |
| GET | `/api/scheduler/status` | `?industryId=X` | Merged status for one or all industries |
| POST | `/api/run-all` | `{ industryId? }` | Fire-and-forget distribution run |

### Data

| Method | Route | Description |
|---|---|---|
| GET | `/api/event-log?industryId=X` | Fetch event log |
| DELETE | `/api/event-log?industryId=X` | Clear event log |
| GET | `/api/sessions?industryId=X&limit=N` | Fetch session history |
| GET | `/api/app-config` | Get masked credential status |
| PUT | `/api/app-config` | Save global credentials (encrypted) |

---

## Local Setup

### 1. Start Couchbase

```bash
docker run -d --name couchbase-algolia \
  -p 8091-8097:8091-8097 \
  -p 11210:11210 \
  couchbase:community
```

Open `http://localhost:8091`, complete the setup wizard, create bucket `algolia-insights`.

### 2. Configure Environment

```bash
cp .env.local.example .env
# Set ENCRYPTION_SECRET to any strong 32+ char string
# Couchbase defaults (url/user/pass/bucket) match Docker setup above
```

### 3. Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### 4. Enter Credentials

Click **⚙** (top-right) → enter Algolia App ID, Search API Key, Anthropic API Key → Save.  
The app bootstraps Couchbase collections and seeds built-in industries on first startup.

---

## Built-In Industries

| Industry | Primary Index | Secondary Indices |
|---|---|---|
| **Grocery** | Recipes | Products |
| **Finance** | Pages / Articles | Calculators |
| **Healthcare** | Pages | Articles |
| **Adventure** | Activities | Gear |
| **Travel (Cruises)** | Activities (`SW_Cruises_*_Activities`) | Itineraries, Articles |

Each has 10 pre-defined personas. All are editable via the UI and stored in Couchbase.

---

## Error Handling & Resilience

- **Claude retries**: `maxRetries: 4`, `timeout: 60s` — handles Anthropic 529 overload errors automatically via exponential backoff
- **Session errors**: each session is fully isolated; one failure does not stop the distribution loop; errors are appended to `SchedulerRun.errors` and surfaced in Session History
- **Zero-result queries**: if a primary search returns no hits, the session is skipped with an error recorded
- **Stale distribution state**: auto-cleared by the status API after 10 minutes if no matching in-memory run exists
- **Hot-reload safety**: all critical state (`isDistributing`, `cancelRequested`) persisted to Couchbase alongside in-memory; both are checked on every status poll and every 5 sessions in the distribution loop
