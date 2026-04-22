# Observational Memory

Real-time observation capture from live coding sessions across all agents, with LLM-powered summarization, consolidation into daily digests, and synthesis into persistent project insights. Inspired by Mastra's Observer/Reflector memory hierarchy, adapted for cross-agent project knowledge management.

## Overview

Observational Memory implements a three-tier memory hierarchy:

| Tier | What | Trigger | Volume |
|------|------|---------|--------|
| **Observations** | Per-exchange structured summaries (Intent/Approach/Artifacts/Result) | Real-time, per prompt-set | ~30/day |
| **Digests** | Daily thematic work session summaries | End of day (cron or manual) | ~7/day |
| **Insights** | Persistent project knowledge | Weekly or >= 5 new digests | ~10 total |

The system stores everything in a single SQLite database (`.observations/observations.db`) and exposes all three tiers through the health dashboard at `http://localhost:3032`.

![NavBar with all memory tiers](../images/memory-hierarchy-navbar.png)

## Architecture

![Memory Hierarchy Architecture](../images/observation-memory-hierarchy.png)

### Components

| Component | Location | Role |
|-----------|----------|------|
| **ObservationWriter** | `src/live-logging/ObservationWriter.js` | Summarizes exchanges via LLM proxy, writes to SQLite with dedup |
| **ObservationConsolidator** | `src/live-logging/ObservationConsolidator.js` | Consolidates observations into digests and insights via LLM |
| **ETM Observation Tap** | `scripts/enhanced-transcript-monitor.js` | Fires observations per exchange (fire-and-forget) |
| **Consolidation CLI** | `scripts/consolidate-observations.js` | CLI/daemon for running the consolidation pipeline |
| **Health API** | `integrations/system-health-dashboard/server.js` | REST endpoints for observations, digests, insights |
| **Dashboard UI** | `integrations/system-health-dashboard/src/pages/` | Browsable views: observations, digests, insights |
| **LLM Proxy Bridge** | [`@rapid/llm-proxy`](https://bmw.ghe.com/adpnext-apps/rapid-llm-proxy) | Routes summarization to subscription providers (port 12435) |

## Observation Pipeline

1. **Exchange completed** -- the ETM detects a user-assistant exchange
2. **Fire-and-forget** -- `_fireObservation()` sends messages to ObservationWriter (never awaited, never blocks LSL)
3. **LLM summarization** -- ObservationWriter calls the LLM proxy to generate a 1-3 sentence summary
4. **Dedup check** -- DB-level dedup prevents storing duplicate summaries per agent
5. **Storage** -- observation written to SQLite with metadata (agent, project, LLM model/provider, tokens)
6. **Dashboard** -- REST API serves observations; dashboard polls every 30s

## Supported Agents

All four agents generate observations:

| Agent | Method | Project Detection |
|-------|--------|-------------------|
| **Claude Code** | ETM transcript monitoring | `path.basename(projectPath)` |
| **GitHub Copilot** | ETM pipe-pane capture | `path.basename(projectPath)` |
| **OpenCode** | ETM pipe-pane capture | `path.basename(projectPath)` |
| **Mastracode** | ETM lifecycle hook transcripts | `path.basename(projectPath)` |

## Dashboard Features

Access at `http://localhost:3032/observations`.

![Observation Viewer — list view with filters](../images/observation-viewer.png)

- **Agent filter** -- checkbox per agent (claude, copilot, opencode, mastra)
- **Time range** -- date pickers for from/to
- **Project filter** -- dropdown of projects with observations
- **Full-text search** -- FTS5 search across observation summaries
- **Compact view** -- toggle for single-line rows (high density)
- **Hide low-value** -- filters out "No actionable content" observations
- **LLM metadata** -- each card shows `model@provider` and token counts when expanded
- **Markdown rendering** -- bold, headers, inline code rendered in expanded view
- **ESC / click-outside** -- closes expanded observation cards

![Observation Viewer — expanded observation with structured summary](../images/observation-viewer-item.png)

## LLM Provider Routing

Summarization uses the LLM CLI proxy (`localhost:12435`) which routes through subscription providers with **automatic fallback**:

1. **claude-code** (Max subscription, zero cost, ~15s via CLI)
2. **copilot** (Enterprise subscription, zero cost, ~2-5s via HTTP)
3. **groq** (API fallback, fast, low cost)
4. Anthropic, OpenAI, Gemini (paid API fallback)

The proxy tracks provider health and automatically falls back to the next available provider on failure. Providers that fail 3 times consecutively enter a 1-minute cooldown. Per-provider timeouts (30s) prevent a hung provider from burning the entire request budget.

The provider priority is configured in `config/llm-providers.yaml`.

## Transcript Converters

Historical transcripts can be batch-converted into observations:

```bash
# Convert Claude JSONL transcripts
node scripts/convert-transcripts.js claude path/to/transcript.jsonl

# Convert Copilot events
node scripts/convert-transcripts.js copilot path/to/events.jsonl

# Batch convert .specstory files (with manifest idempotency)
node scripts/convert-transcripts.js specstory
```

## Database

SQLite database at `.observations/observations.db` with WAL mode enabled for concurrent access.

**Observations table:**
```sql
CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  summary TEXT,
  messages TEXT,        -- JSON array of original messages
  agent TEXT,           -- claude, copilot, opencode, mastra
  session_id TEXT,
  source_file TEXT,
  created_at TEXT,      -- ISO 8601
  metadata TEXT,        -- JSON: project, llmModel, llmProvider, llmTokens, etc.
  content_hash TEXT,    -- MD5 for dedup
  quality TEXT,         -- high, normal, low
  digested_at TEXT      -- set when consolidated into a digest
);
```

**Digests table:**
```sql
CREATE TABLE digests (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  theme TEXT NOT NULL,             -- e.g. "Dashboard observations frontend fix"
  summary TEXT NOT NULL,           -- consolidated narrative
  observation_ids TEXT NOT NULL,   -- JSON array of source observation IDs
  agents TEXT,                     -- JSON array of agents involved
  files_touched TEXT,              -- JSON array of files modified
  quality TEXT DEFAULT 'normal',
  created_at TEXT NOT NULL,
  metadata TEXT
);
```

**Insights table:**
```sql
CREATE TABLE insights (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,             -- e.g. "ETM Architecture"
  summary TEXT NOT NULL,           -- living knowledge document
  confidence REAL DEFAULT 0.8,    -- decays -0.05/week, floor 0.3
  digest_ids TEXT NOT NULL,        -- JSON array of source digest IDs
  last_updated TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata TEXT
);
```

## Configuration

### ObservationWriter config

`.observations/config.json`:

```json
{
  "defaults": {
    "model": "anthropic/claude-haiku-4-5",
    "observation": { "messageTokens": 20000, "bufferTokens": 0.2 }
  },
  "agents": {
    "claude": { "model": "groq/llama-3.3-70b-versatile" },
    "opencode": { "model": "anthropic/claude-haiku-4-5" },
    "mastra": { "model": "anthropic/claude-haiku-4-5" }
  }
}
```

### LLM provider priority

`config/llm-providers.yaml` -- `provider_priority` section controls which provider handles summarization.

### Mastracode built-in OM

Mastracode has its own observational memory system (separate from ours). It can be disabled in `~/Library/Application Support/mastracode/settings.json` by setting `activeOmPackId: "disabled"`.

## Deduplication

Observations are deduplicated at two levels before storage:

- **Content hash**: MD5 of `sessionId|userContent|assistantContent` -- identical exchanges are rejected
- **Semantic dedup**: Stemmed keyword similarity (Jaccard + containment) against a 4-hour sliding window of the last 50 observations per agent. Synonymous verbs are canonicalized (debug/diagnose/investigate -> `debug`, showing/displaying/appearing -> `show`) and stop words stripped before comparison
- **Trivial filter**: observations containing "trivial exchange" or "no actionable content" are skipped entirely
- **WAL mode**: SQLite WAL mode prevents corruption from concurrent ETM writes

## Consolidation Pipeline

The consolidation pipeline aggregates fine-grained observations into two higher-level memory tiers: **digests** (daily thematic summaries) and **insights** (persistent project knowledge).

### Digests (Tier 2)

Digests group same-day observations by cognitive topic and produce consolidated narratives.

**Trigger**: End of day via cron (`--daemon` mode at 02:00) or manual run. Today's observations are never consolidated (still being written).

**Process**:

1. Query undigested observations for a given date (excluding low-quality)
2. Chunk into batches of 35 (avoids LLM timeouts on large days)
3. LLM groups by theme, merges narratives, extracts files touched
4. Write digest entries and mark source observations as `digested_at`

**Output**: Thematic summaries like "ETM pollCount Hardening and Dead Code Removal" or "Frontend Dashboard Observations Display Debugging", each linking back to their source observation IDs.

![Digests page grouped by date](../images/digests-page.png)

### Insights (Tier 3)

Insights extract persistent project knowledge from accumulated digests.

**Trigger**: When >= 5 unsynthesized digests exist.

**Process**:

1. Load all unsynthesized digests + existing insights for context
2. Chunk into batches of 30 digests per LLM call
3. LLM produces topic-keyed knowledge entries with confidence scores
4. Existing insights with matching topics are updated (merged), new topics create new entries
5. Confidence decay: -0.05 per week of inactivity, floor at 0.3

**Output**: Living knowledge entries like "Enhanced Transcript Monitor (ETM) Architecture and Known Failure Modes" (confidence: 0.95) or "LLM CLI Proxy and Provider Health Tracking" (confidence: 0.92).

![Insights page with confidence bars](../images/insights-page.png)

### Running Consolidation

```bash
# One-shot: consolidate all past days + synthesize insights
node scripts/consolidate-observations.js

# Consolidate a specific day
node scripts/consolidate-observations.js --date 2026-04-21

# Synthesize insights only (from existing digests)
node scripts/consolidate-observations.js --insights

# Check status
node scripts/consolidate-observations.js --status

# Daemon mode: run immediately, then daily at 02:00
node scripts/consolidate-observations.js --daemon
```

## API Endpoints

### Observations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/observations` | GET | Paginated observations with agent/date/project/quality/FTS filters |
| `/api/observations/projects` | GET | Distinct project names for filter dropdown |

### Digests

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/digests` | GET | Paginated digests with date range and text search |

### Insights

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/insights` | GET | All insights, filterable by topic or text search |

### Consolidation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/consolidation/status` | GET | Counts: total obs, undigested, digests, insights |
| `/api/consolidation/run` | POST | Trigger consolidation (optional `{ date }` body) |
