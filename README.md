# Algolia Insights Agent Dashboard

A **Next.js + TypeScript** application that simulates realistic [Algolia Insights](https://www.algolia.com/doc/guides/sending-events/getting-started/) events using an autonomous multi-agent system. LLM-driven personas browse configured Algolia indices, generate search queries, select results, and fire realistic event sequences (view → click → conversion) — all orchestrated by a supervisor agent with built-in guardrails.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
  - [Agent System](#agent-system)
  - [Session Flow](#session-flow)
  - [Credential Resolution](#credential-resolution)
  - [SSE Real-time Updates](#sse-real-time-updates)
- [Project Structure](#project-structure)
- [Couchbase Data Model](#couchbase-data-model)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Quick Start](#quick-start)
- [Manual Setup](#manual-setup)
- [UI Overview](#ui-overview)
- [Agent Configuration](#agent-configuration)
- [Error Handling & Resilience](#error-handling--resilience)

---

## Overview

Each **agent** represents a simulated web property (e.g. an e-commerce site, a content platform, a travel booking engine). Agents are configured with:

- One or more **Algolia indices** (one primary + optional secondaries)
- **Per-index event definitions** (view / click / conversion / addToCart / purchase)
- **LLM prompts** for query generation, result selection, and secondary query generation
- **Personas** — AI-generated or hand-crafted user profiles with distinct intents, budgets and search behaviours
- Optional **per-agent credential overrides** (Algolia app, LLM provider)

The system supports running multiple agents simultaneously with independent daily event budgets, enforced via Couchbase counters.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 16** (App Router) |
| Language | **TypeScript** (strict) |
| UI | **React 19**, **Tailwind CSS v4** |
| LLM | **Anthropic Claude**, **OpenAI**, **Ollama** (provider-agnostic via `llm.ts`) |
| Search | `algoliasearch` v5 |
| Insights | Algolia Insights REST API (`https://insights.algolia.io/1/events`) |
| Scheduler | `node-cron` |
| Database | **Couchbase Server Community Edition** (Docker) |
| DB SDK | `couchbase` Node.js SDK v4 |
| Encryption | Node.js `crypto` — AES-256-GCM for secrets at rest |
| Realtime | **Server-Sent Events** (SSE) — single multiplexed stream per client |

---

## Architecture

### Agent System

The system uses a three-tier agent hierarchy:

```
┌─────────────────────────────────────────────────────────┐
│                    Supervisor Agent                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Runs on a cron schedule (default: every 10 min)  │  │
│  │  Reads counters + personas for all active agents  │  │
│  │  Computes urgency scores (events needed today)    │  │
│  │  Dispatches batches to Worker Agents              │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │  dispatches batches
          ┌────────────────┼─────────────────┐
          ▼                ▼                 ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │Worker Agent │  │Worker Agent │  │Worker Agent │
   │  (Agent A)  │  │  (Agent B)  │  │  (Agent C)  │
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │                │                 │
          ▼                ▼                 ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │Index Agent  │  │Index Agent  │  │Index Agent  │
   │ (Primary)   │  │ (Primary)   │  │ (Primary)   │
   │Index Agent  │  │Index Agent  │  └─────────────┘
   │ (Secondary) │  │ (Secondary) │
   └─────────────┘  └─────────────┘
          │
          ▼
   ┌─────────────┐
   │ Guardrails  │
   │   Agent     │
   │(validates   │
   │  queries)   │
   └─────────────┘
```

**Supervisor Agent** (`src/lib/agents/SupervisorAgent.ts`)
- Runs on a configurable cron schedule
- Reads all active agent configs, their daily counters, and available personas
- Computes an urgency score per agent (events sent vs daily target)
- Dispatches batches of sessions to Worker Agents
- Persists `SupervisorDecision` records to Couchbase and broadcasts via SSE

**Worker Agent** (`src/lib/agents/WorkerAgent.ts`)
- Executes persona sessions for a specific agent config
- Plans the session, runs guardrail validation, performs primary search
- Selects the best result using LLM, fires primary events
- Generates secondary queries and processes secondary indices
- Sends batched events to Algolia Insights
- Maintains `AgentState` in `globalThis` for status tracking

**Index Agent** (`src/lib/agents/IndexAgent.ts`)
- Handles per-index query generation and guardrail validation
- Maintains per-index query memory to avoid repetition
- Resolves prompts from: index override → agent config → system defaults

**Guardrails Agent** (`src/lib/agents/GuardrailsAgent.ts`)
- LLM-based approve/reject for each generated query
- Validates queries against persona profiles and content relevance
- Logs violations to `agentData` collection in Couchbase
- Fails open (approves) if LLM errors to maintain event flow

### Session Flow

```
                    Worker Agent — Single Persona Session
                    ─────────────────────────────────────

 Persona selected by Supervisor
         │
         ▼
 ┌───────────────────┐
 │ IndexAgent        │   LLM → 2-5 word search query
 │ generateQuery()   │   (uses persona + agent prompt)
 └────────┬──────────┘
          │  query string
          ▼
 ┌───────────────────┐
 │ GuardrailsAgent   │   LLM validates query against
 │ validate()        │   persona profile → approve / reject
 └────────┬──────────┘
          │  approved query
          ▼
 ┌───────────────────┐
 │ algolia.search()  │   clickAnalytics: true → queryID
 │ Primary Index     │   returns hits[]
 └────────┬──────────┘
          │  hits[]
          ▼
 ┌───────────────────┐
 │ LLM selectBest()  │   Returns { index: N, reason: "…" }
 │                   │   Picks the most persona-relevant hit
 └────────┬──────────┘
          │  selectedHit
          ▼
 ┌───────────────────┐
 │ buildEvents()     │   view, click, conversion
 │ Primary Index     │   (per configured index events)
 └────────┬──────────┘
          │
          ▼
 ┌───────────────────┐
 │ LLM generateSec() │   JSON array of secondary queries
 │ SecondaryQueries  │   based on selectedHit context
 └────────┬──────────┘
          │
          ▼  (for each secondary index)
 ┌───────────────────┐
 │ algolia.search()  │   Secondary index search
 │ buildEvents()     │   per-index event definitions
 └────────┬──────────┘
          │  all events
          ▼
 ┌───────────────────┐
 │ insights.send()   │   POST /1/events to Algolia
 │                   │   On success: incrementCounter
 │                   │   appendEventLog, appendSession
 └───────────────────┘
```

### Credential Resolution

For every Algolia and LLM API call, credentials are resolved in this priority order:

```
┌─────────────────────────────────────────────────────────────┐
│  1. Agent-level override (algoliaAppConfigId / llmProviderId)│
│     └─ stored encrypted in Couchbase siteConfigs collection  │
├─────────────────────────────────────────────────────────────┤
│  2. Global app config (default Algolia app / LLM provider)   │
│     └─ stored encrypted in Couchbase appConfig collection    │
├─────────────────────────────────────────────────────────────┤
│  3. Environment variable fallback                            │
│     └─ NEXT_PUBLIC_ALGOLIA_APP_ID, ANTHROPIC_API_KEY, etc.   │
└─────────────────────────────────────────────────────────────┘
```

API keys are **never stored in plaintext**. All secrets are encrypted with AES-256-GCM using a key derived from `ENCRYPTION_SECRET` via `scryptSync`. The stored format is `{iv_hex}:{authTag_hex}:{ciphertext_hex}`.

### SSE Real-time Updates

The dashboard uses a **single multiplexed SSE connection** per client rather than one connection per agent. This avoids hitting the browser's 6-connection-per-origin HTTP/1.1 limit.

```
Browser                                   Server (/api/stream)
  │                                               │
  │  GET /api/stream?agentId=_agents              │
  │  &agentIds=grocery,finance,travel             │
  │  &types=agent-status,guardrail,session,       │
  │          event-log                            │
  │ ─────────────────────────────────────────── ▶ │
  │                                               │
  │ ◀ ─── event: agent-status  data: {...}  ────  │
  │ ◀ ─── event: session       data: {...}  ────  │
  │ ◀ ─── event: guardrail     data: {...}  ────  │
  │ ◀ ─── event: event-log     data: {...}  ────  │
  │                                               │
  │  GET /api/stream?siteId=_supervisor           │
  │  &types=supervisor                            │
  │ ─────────────────────────────────────────── ▶ │
  │                                               │
  │ ◀ ─── event: supervisor    data: {...}  ────  │
```

Each event payload includes an `agentId` field so the client can route updates to the correct agent's state.

---

## Project Structure

```
/
├── scripts/
│   └── setup.sh                    # One-command dev environment bootstrap
├── data/
│   └── aep-grocery-profiles.json   # Sample persona reference data
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── admin/
│   │   │   │   └── migrate/route.ts        # POST: industry → agent migration
│   │   │   ├── agent-configs/
│   │   │   │   ├── route.ts                # GET list / POST create agent
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts            # GET / PUT / DELETE agent
│   │   │   │       ├── personas/route.ts   # GET / PUT / DELETE personas
│   │   │   │       └── generate-personas/route.ts  # POST AI persona gen
│   │   │   ├── agents/
│   │   │   │   ├── config/route.ts         # GET / PUT agent system prompts
│   │   │   │   ├── guardrails/route.ts     # GET guardrail violations
│   │   │   │   ├── start/route.ts          # POST start agent system
│   │   │   │   ├── stop/route.ts           # POST stop agent system
│   │   │   │   ├── status/route.ts         # GET agent system status
│   │   │   │   └── tick/route.ts           # POST force supervisor tick
│   │   │   ├── app-config/route.ts         # GET / PUT global credentials
│   │   │   ├── event-log/route.ts          # GET / DELETE event log
│   │   │   ├── run-all/route.ts            # POST fire-and-forget distribution
│   │   │   ├── run-session/route.ts        # POST run one persona session
│   │   │   ├── scheduler/
│   │   │   │   ├── start/route.ts          # POST start cron scheduler
│   │   │   │   ├── stop/route.ts           # POST stop cron scheduler
│   │   │   │   └── status/route.ts         # GET scheduler + distribution status
│   │   │   ├── sessions/route.ts           # GET / DELETE session history
│   │   │   ├── sites/                      # Legacy alias (maps to agent-configs)
│   │   │   └── stream/route.ts             # GET SSE stream
│   │   ├── components/
│   │   │   ├── AgentDashboard.tsx          # Main dashboard: overview + per-agent tabs
│   │   │   ├── AgentEditor.tsx             # Create / edit agent slide-over panel
│   │   │   ├── AgentStatusCard.tsx         # Agent card: phase, counters, progress
│   │   │   ├── AppConfigPanel.tsx          # Global credentials + Algolia apps + LLM providers
│   │   │   ├── DailyCounter.tsx            # Per-index daily event progress bar
│   │   │   ├── EventLog.tsx                # Real-time scrolling event log
│   │   │   ├── GeneratePersonasModal.tsx   # AI persona generation modal
│   │   │   ├── GuardrailLog.tsx            # Guardrail violations list
│   │   │   ├── PersonaEditorModal.tsx      # Edit / delete persona
│   │   │   ├── PersonaSelector.tsx         # Persona grid + run session
│   │   │   ├── SchedulerControls.tsx       # Cron scheduler start/stop/trigger
│   │   │   ├── SessionCard.tsx             # Latest session result card
│   │   │   ├── SessionHistory.tsx          # Session history table with LIVE badge
│   │   │   └── SupervisorLog.tsx           # Supervisor decision log
│   │   ├── hooks/
│   │   │   └── useSSE.ts                   # SSE client hook
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx                        # Root page — loads agents + app config
│   ├── lib/
│   │   ├── agents/
│   │   │   ├── agentOrchestrator.ts        # start/stop/status for agent system
│   │   │   ├── GuardrailsAgent.ts          # LLM query validation
│   │   │   ├── IndexAgent.ts               # Per-index query gen + memory
│   │   │   ├── SupervisorAgent.ts          # Cron-based session dispatcher
│   │   │   └── WorkerAgent.ts              # Per-agent session executor
│   │   ├── agentConfigs.ts                 # Agent CRUD helpers
│   │   ├── agentDb.ts                      # Agent system prompts + guardrail log
│   │   ├── algolia.ts                      # Search + browse (credential-aware)
│   │   ├── anthropic.ts                    # Higher-level Claude helpers
│   │   ├── appConfig.ts                    # Global encrypted config store
│   │   ├── couchbase.ts                    # Singleton connection + collections bootstrap
│   │   ├── crypto.ts                       # AES-256-GCM encrypt / decrypt
│   │   ├── db.ts                           # All Couchbase CRUD + SSE emission
│   │   ├── insights.ts                     # Build + send Insights events
│   │   ├── llm.ts                          # Provider-agnostic LLM calls
│   │   ├── logger.ts                       # Structured logging
│   │   ├── scheduler.ts                    # Per-agent cron + distribution loop
│   │   ├── sites.ts                        # Legacy alias for agentConfigs
│   │   ├── sse.ts                          # In-process SSE pub/sub
│   │   └── utils.ts                        # IDs, shuffle, sleep, utilities
│   └── types/
│       └── index.ts                        # All shared TypeScript interfaces
├── .env.local.example                      # Environment variable template
├── next.config.mjs                         # couchbase + node-cron as external packages
├── package.json
└── tsconfig.json
```

---

## Couchbase Data Model

**Bucket**: `algolia-insights` (default)  
**Scope**: `_default`

All collections use a key-value model. Index documents (`_index` key) track all document IDs within each collection.

```
Bucket: algolia-insights
└── Scope: _default
    ├── appConfig          Global settings (Algolia apps, LLM providers, encrypted keys)
    ├── siteConfigs        One document per agent config (AgentConfig shape)
    ├── personas           { personas: Persona[] } per agentId
    ├── counters           Daily event counts + distribution state per agentId
    ├── eventLogs          Last 500 sent events per agentId
    ├── schedulerRuns      Last 50 scheduler run records per agentId
    ├── sessions           Last 200 session records per agentId
    └── agentData          Guardrail violations, supervisor decisions,
                           agent system prompts (supervisor/worker/guardrails),
                           per-index query memory
```

### Key Document Shapes

| Collection | Key Pattern | Contents |
|---|---|---|
| `appConfig` | `_config` | `{ algoliaApps[], llmProviders[], defaultAlgoliaAppId, defaultLlmProviderId }` |
| `siteConfigs` | `{agentId}` | Full `AgentConfig` object |
| `siteConfigs` | `_index` | `{ ids: string[] }` — manifest of all agent IDs |
| `personas` | `{agentId}` | `{ personas: Persona[] }` |
| `counters` | `{agentId}` | `{ date, byIndex: Record<indexId, count> }` |
| `counters` | `{agentId}_dist` | `{ isDistributing, cancelRequested, runId, startedAt }` |
| `eventLogs` | `{agentId}` | `{ events: SentEvent[] }` (last 500) |
| `sessions` | `{agentId}` | `{ sessions: SessionRecord[] }` (last 200) |
| `schedulerRuns` | `{agentId}` | `{ runs: SchedulerRun[] }` (last 50) |
| `agentData` | `guardrail_violations_{agentId}` | `{ violations: GuardrailResult[] }` |
| `agentData` | `supervisor_log` | `{ decisions: SupervisorDecision[] }` |
| `agentData` | `agent_configs` | `{ supervisor, workerAgent, guardrails: { systemPrompt, llmProviderId } }` |

---

## API Reference

### Agent Configuration

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/agent-configs` | List all agents (includes `personaCount` + full `personas` array) |
| `POST` | `/api/agent-configs` | Create a new agent |
| `GET` | `/api/agent-configs/[id]` | Get a single agent |
| `PUT` | `/api/agent-configs/[id]` | Update agent config |
| `DELETE` | `/api/agent-configs/[id]` | Delete agent + all associated data |
| `GET` | `/api/agent-configs/[id]/personas` | List personas for agent |
| `PUT` | `/api/agent-configs/[id]/personas` | Upsert a single persona |
| `DELETE` | `/api/agent-configs/[id]/personas?personaId=X` | Delete persona |
| `POST` | `/api/agent-configs/[id]/generate-personas` | AI-generate N new personas |

### Agent System (Supervisor + Workers)

| Method | Route | Body | Description |
|---|---|---|---|
| `POST` | `/api/agents/start` | `{ agentIds: string[] }` | Start the agent system |
| `POST` | `/api/agents/stop` | — | Stop all agents and supervisor |
| `GET` | `/api/agents/status` | — | Full `AgentSystemStatus` (all agent states, recent decisions) |
| `POST` | `/api/agents/tick` | — | Force an immediate supervisor tick |
| `GET` | `/api/agents/config` | — | Get editable system prompts for supervisor / worker / guardrails |
| `PUT` | `/api/agents/config` | `Partial<AgentConfigs>` | Update one or more system prompts |
| `GET` | `/api/agents/guardrails?agentId=X` | — | Get guardrail violations for an agent |

### Classic Scheduler (per-agent cron)

| Method | Route | Body | Description |
|---|---|---|---|
| `POST` | `/api/scheduler/start` | `{ agentId, runNow? }` | Start cron; optionally trigger immediately |
| `POST` | `/api/scheduler/stop` | `{ agentId }` or `{ stopAll: true }` | Stop cron + cancel active run |
| `GET` | `/api/scheduler/status?agentId=X` | — | Merged in-memory + DB distribution status |
| `POST` | `/api/run-all` | `{ agentId? }` | Fire-and-forget distribution run |
| `POST` | `/api/run-session` | `{ agentId, personaId }` | Run a single persona session |

### Data & Streaming

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/event-log?agentId=X` | Fetch event log |
| `DELETE` | `/api/event-log?agentId=X` | Clear event log |
| `GET` | `/api/sessions?agentId=X&limit=N` | Fetch session history |
| `DELETE` | `/api/sessions?agentId=X` | Clear session history |
| `GET` | `/api/stream?agentId=_agents&agentIds=a,b&types=...` | SSE stream (multiplexed) |
| `GET` | `/api/app-config` | Get masked credential status |
| `PUT` | `/api/app-config` | Save global credentials (AES-256-GCM encrypted) |
| `POST` | `/api/admin/migrate` | Migrate legacy `industryConfigs` → `siteConfigs` |

---

## Environment Variables

Copy `.env.local.example` to `.env` (the setup script does this automatically):

```env
# ── Required ──────────────────────────────────────────────────────────────────

# AES-256-GCM key for encrypting API credentials at rest.
# Any strong random string (min 32 chars). Changing this invalidates DB creds.
ENCRYPTION_SECRET=<64-char hex string>

# ── Couchbase ─────────────────────────────────────────────────────────────────
COUCHBASE_URL=couchbase://localhost
COUCHBASE_USERNAME=Administrator
COUCHBASE_PASSWORD=password
COUCHBASE_BUCKET=algolia-insights

# ── Scheduler ─────────────────────────────────────────────────────────────────
SCHEDULER_TIMEZONE=America/Los_Angeles
SCHEDULER_CRON=0 6 * * *
NEXT_PUBLIC_SCHEDULER_CRON=0 6 * * *

# ── Limits ────────────────────────────────────────────────────────────────────
DAILY_EVENT_LIMIT_PER_INDEX=1000    # Max events per index per day
NEXT_PUBLIC_DAILY_EVENT_LIMIT=1000
EVENTS_PER_SESSION=7                # Events sent per persona session

# ── Optional: API credential fallbacks ───────────────────────────────────────
# Preferred: configure these in the in-app ⚙ Settings panel (encrypted in DB).
# These env vars act as a fallback only.
# NEXT_PUBLIC_ALGOLIA_APP_ID=your_app_id
# NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY=your_search_key
# ANTHROPIC_API_KEY=your_anthropic_key
# OPENAI_API_KEY=your_openai_key

# ── External endpoints ────────────────────────────────────────────────────────
ALGOLIA_INSIGHTS_URL=https://insights.algolia.io/1/events
```

> **Important**: API credentials (Algolia App ID, Search API Key, LLM API Key) are **not stored in `.env`**. Enter them via the **⚙ App Settings** panel in the UI, where they are encrypted and saved to Couchbase. Per-agent overrides can be set in the **Agent Editor**.

---

## Quick Start

The setup script handles everything in one command:

```bash
# Clone the repo
git clone <repo-url>
cd algolia-insight-events-generation

# Run the setup script (requires Docker + Node.js 18+)
chmod +x scripts/setup.sh
./scripts/setup.sh
```

The script will:
1. Verify Docker and Node.js are installed
2. Pull and start the Couchbase Community Edition container
3. Wait for Couchbase to be healthy, then initialise the cluster
4. Create the `algolia-insights` bucket
5. Copy `.env.local.example` → `.env` and generate a secure `ENCRYPTION_SECRET`
6. Run `npm install`

Then start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **⚙** (top-right) to enter your Algolia and LLM credentials.

---

## Manual Setup

If you prefer to set up manually:

### 1. Start Couchbase

```bash
docker run -d --name couchbase-algolia \
  -p 8091-8097:8091-8097 \
  -p 11210:11210 \
  couchbase:community
```

Open [http://localhost:8091](http://localhost:8091), complete the Setup Wizard:
- **New Cluster** → set cluster name, username (`Administrator`), password (`password`)
- **Configure** → enable at minimum the **Data** service (Index + Query recommended)
- **Buckets** → Create bucket named `algolia-insights` (256 MB RAM minimum)

### 2. Configure Environment

```bash
cp .env.local.example .env
# Generate a strong ENCRYPTION_SECRET:
openssl rand -hex 32
# Paste the output as the value of ENCRYPTION_SECRET in .env
```

### 3. Install and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Enter Credentials

Click **⚙** (top-right) → **App Settings**:
- Add an **Algolia App** (App ID + Search API Key + optional Insights API Key)
- Add an **LLM Provider** (Anthropic / OpenAI / Ollama)
- Set defaults and save

The app bootstraps all Couchbase collections automatically on first startup.

---

## UI Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⚡ Algolia Insights Generator     Autonomous agent event simulation  │
│                                                                  [⚙] │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Autonomous Agent System                                        │ │
│  │  ① Supervisor Agent  ② Worker Agent  ③ Guardrails Agent         │ │
│  │  [New Agent]  [Run Now]  [Stop Agents / Start Agents]           │ │
│  │  ● algolia-app · claude-3-5-sonnet  ● gpt-4o                   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  [Overview] [🛒 Grocery ●] [💼 Finance] [✈️ Travel ⚠3]  [+ New]      │
│                                                                        │
│  ── Overview Tab ──────────────────────────────────────────────────── │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │ 🛒 Grocery   │  │ 💼 Finance   │  │ ✈️ Travel    │                │
│  │ phase: search│  │ phase: idle  │  │ phase: events│                │
│  │ 342/1000 evt │  │   0/1000 evt │  │ 891/1000 evt │                │
│  │ 10 personas  │  │  8 personas  │  │ 12 personas  │                │
│  │ [Edit][Del]  │  │ [Edit][Del]  │  │ [Edit][Del]  │                │
│  └──────────────┘  └──────────────┘  └──────────────┘                │
│                                                                        │
│  ── Supervisor Decisions ────────────────────────────────────────── │
│  10:32 Dispatched 3 sessions to Grocery (urgency: high)               │
│  10:22 Dispatched 1 session to Travel (urgency: critical)             │
│                                                                        │
│  ── Agent Tab (e.g. 🛒 Grocery) ───────────────────────────────────── │
│  [AgentStatusCard expanded — indices, counters, config]               │
│  [SupervisorLog — decisions for this agent only]                      │
│  [GuardrailLog — violations for this agent]                           │
│  [PersonaSelector — persona grid + Run Session + Generate + Edit]     │
│  [SessionHistory — LIVE badge, table with ERR tooltips]               │
│  [EventLog — last 500 events, colour-coded by type]                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Agent Configuration

Each agent is configured via the **Agent Editor** (click **New Agent** or **Edit** on an agent card):

| Field | Description |
|---|---|
| **Agent Name** | Display name (e.g. "Financial Services") |
| **ID (slug)** | Unique identifier used in API routes and Couchbase keys |
| **Site URL** | Optional URL for context (shown on status card) |
| **Icon + Color** | Visual identity on the dashboard |
| **Indices** | One or more Algolia indices. First `primary` is searched first. Each index has: name, role (primary/secondary), and event definitions |
| **LLM Prompts** | Three prompts for query generation, result selection, secondary queries |
| **LLM Configuration** | Override the global default LLM provider for this agent |
| **Algolia Configuration** | Override the global default Algolia app for this agent |

### AI Persona Generation

1. Open the agent's detail tab → click **Generate Personas**
2. Enter the number of personas to create (1–100)
3. The app samples 20+ records from each configured index via the Algolia Browse API
4. The LLM generates personas with names, descriptions, skills, budgets, and tags — calibrated to the index content
5. Generated personas are stored in Couchbase and immediately available for sessions

### System Prompts

The three global agent system prompts (Supervisor, Worker, Guardrails) are editable from the control panel via the **Edit** button on each agent card. Changes take effect on the next supervisor tick or session.

---

## Error Handling & Resilience

| Scenario | Behaviour |
|---|---|
| LLM API error | `maxRetries: 4` with exponential backoff; Guardrails agent fails open on error |
| Zero search results | Session skipped with error recorded; other sessions continue |
| Session failure | Fully isolated; one failure does not interrupt the distribution loop |
| Hot-reload (Next.js dev) | Distribution state persisted in Couchbase and merged with in-memory state on every status poll |
| Stale distribution state | Auto-cleared by status API after 10 minutes if no matching in-memory run exists |
| SSE connection limit | Single multiplexed stream for all agents avoids the 6-connection browser limit |
| Persona fetch timeout | 15-second abort controller; guard cleared on timeout, allowing retry on next tab click |
