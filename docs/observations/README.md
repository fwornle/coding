# Observational Memory

Real-time observation capture from live coding sessions across all agents, with LLM-powered summarization and a browsable dashboard. Inspired by the observational memory concepts in the Mastra codebase, adapted to work across all supported coding agents.

## What It Does

Observational Memory captures per-exchange observations during coding sessions. Each user-assistant exchange is summarized by an LLM into a structured observation (Intent, Approach, Artifacts, Result), then stored in a local SQLite database.

- **Real-Time Capture** - Every exchange generates an observation via fire-and-forget (never blocks LSL)
- **LLM Summarization** - Structured summaries via the LLM CLI proxy with automatic provider fallback
- **Multi-Agent Support** - Claude Code, Copilot CLI, OpenCode, and Mastracode all generate observations
- **Browsable Dashboard** - Filter by agent, project, time range, and full-text search
- **Zero-Cost** - Routes through subscription providers (Claude Max, Copilot Enterprise)
- **Backfill Support** - Historical transcripts can be batch-converted into observations

## Architecture

![Observation Pipeline](../images/observation-pipeline.png)

```
ETM (per project)          ObservationWriter          LLM CLI Proxy (12435)
   |                            |                          |
   | _fireObservation()         |                          |
   |  user + assistant msg ---->| summarize() ------------>| claude-code / copilot
   |                            |<---- summary + metadata -|  (auto-fallback)
   |                            | writeObservation()       |
   |                            |  --> SQLite (.observations/observations.db)
   |                            |
Dashboard (3032) <-- API (3033) <-- reads SQLite (readonly)
```

### Components

| Component | Location | Role |
|-----------|----------|------|
| **ObservationWriter** | `src/live-logging/ObservationWriter.js` | Summarizes exchanges via LLM proxy, writes to SQLite |
| **ETM Observation Tap** | `scripts/enhanced-transcript-monitor.js` | Fires observations per exchange (fire-and-forget) |
| **Health API** | `integrations/system-health-dashboard/server.js` | REST endpoints for querying observations |
| **Dashboard UI** | `integrations/system-health-dashboard/src/pages/observations.tsx` | Browsable UI with filters, search, compact view |
| **LLM CLI Proxy** | `integrations/llm-cli-proxy/` | Routes summarization to subscription providers (port 12435) |

## Pipeline

1. **Exchange completed** -- the ETM detects a user-assistant exchange
2. **Fire-and-forget** -- `_fireObservation()` sends messages to ObservationWriter (never awaited, never blocks LSL)
3. **LLM summarization** -- ObservationWriter calls the LLM proxy to generate a structured summary
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

## Dashboard

Access at `http://localhost:3032/observations`.

![Observation Viewer -- list view with filters](../images/observation-viewer.png)

- **Agent filter** -- checkbox per agent (claude, copilot, opencode, mastra)
- **Time range** -- date pickers for from/to
- **Project filter** -- dropdown of projects with observations
- **Full-text search** -- FTS5 search across observation summaries
- **Compact view** -- toggle for single-line rows (high density)
- **Hide low-value** -- filters out "No actionable content" observations
- **LLM metadata** -- each card shows `model@provider` and token counts when expanded
- **Markdown rendering** -- bold, headers, inline code rendered in expanded view

![Observation Viewer -- expanded observation with structured summary](../images/observation-viewer-item.png)

## LLM Provider Routing

Summarization uses the LLM CLI proxy (`localhost:12435`) with **automatic fallback**:

1. **claude-code** (Max subscription, zero cost, ~15s via CLI)
2. **copilot** (Enterprise subscription, zero cost, ~2-5s via HTTP)
3. **groq** (API fallback, fast, low cost)
4. Anthropic, OpenAI, Gemini (paid API fallback)

The proxy tracks provider health and automatically falls back to the next available provider on failure. Providers that fail 3 times consecutively enter a 1-minute cooldown. Per-provider timeouts (30s) prevent a hung provider from burning the entire request budget.

Provider priority is configured in `config/llm-providers.yaml`.

## Transcript Converters

Historical transcripts can be batch-converted into observations:

```bash
# Convert Claude JSONL transcripts
node scripts/convert-transcripts.js claude path/to/transcript.jsonl

# Convert Copilot events
node scripts/convert-transcripts.js copilot path/to/events.jsonl

# Batch convert .specstory files (with manifest idempotency)
node scripts/convert-transcripts.js specstory

# Backfill [Raw] observations that failed LLM summarization
node scripts/backfill-raw-observations.js
```

## Database

SQLite database at `.observations/observations.db` with WAL mode enabled for concurrent access.

**Schema:**
```sql
CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  summary TEXT,
  messages TEXT,      -- JSON array of original messages
  agent TEXT,         -- claude, copilot, opencode, mastra
  session_id TEXT,
  source_file TEXT,
  created_at TEXT,    -- ISO 8601
  metadata TEXT       -- JSON: project, llmModel, llmProvider, llmTokens, etc.
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

### Mastracode built-in OM

Mastracode has its own observational memory system (separate from ours). It can be disabled in `~/Library/Application Support/mastracode/settings.json` by setting `activeOmPackId: "disabled"`.

## Deduplication

- **DB-level**: identical `(agent, summary)` pairs are rejected before insert
- **Trivial filter**: observations containing "trivial exchange" are skipped entirely
- **WAL mode**: SQLite WAL mode prevents corruption from concurrent ETM writes

## Relationship to LSL

Observational Memory and [Live Session Logging (LSL)](../lsl/) are complementary systems that run in parallel:

| Aspect | LSL | Observational Memory |
|--------|-----|---------------------|
| **Granularity** | Full session transcripts | Per-exchange summaries |
| **Storage** | Markdown files in `.specstory/history/` | SQLite database in `.observations/` |
| **Content** | Raw tool calls, messages, outputs | Structured Intent/Approach/Artifacts/Result |
| **Classification** | 5-layer LOCAL vs CODING routing | None (all exchanges captured) |
| **Use case** | Session replay, continuity, debugging | Activity tracking, knowledge extraction feed |
| **Blocking** | Synchronous (writes during session) | Fire-and-forget (never blocks ETM) |

Both systems are driven by the Enhanced Transcript Monitor (ETM). LSL captures the verbatim session log; Observational Memory generates a concise LLM summary of each exchange within that session.
