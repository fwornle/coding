# Architecture Patterns

**Domain:** Mastra.ai integration with existing coding infrastructure
**Researched:** 2026-03-28

## Recommended Architecture

### High-Level Integration Map

```
coding --mastra  ---+
coding --claude  ---+---> launch-agent-common.sh
coding --opencode --+         |
                              v
                    +-------------------+
                    | tmux session mgmt |
                    | PSM registration  |
                    | monitoring verify |
                    +-------------------+
                              |
              +---------------+---------------+
              |               |               |
     mastracode TUI    claude-mcp      opencode CLI
              |               |               |
              |               |         .opencode/plugins/
              |               |         @mastra/opencode (NEW)
              |               |               |
     [built-in OM]      [no OM yet]    [OM via plugin hooks]
              |                               |
              +------+------------------------+
                     |
              +------v------+
              | Observation  |  <-- NEW: shared observation store
              | Store        |      @mastra/libsql (SQLite)
              | (per-agent)  |      .data/observations/
              +--------------+
                     |
              +------v------+
              | Batch        |  <-- NEW: transcript-to-observation converter
              | Converter    |      reads: .specstory/, events.jsonl, opencode.db
              | Pipeline     |      writes: observation store
              +--------------+
                     |
              +------v------+
              | enhanced-    |  <-- MODIFIED: optional observation tap
              | transcript-  |      alongside existing LSL verbatim logging
              | monitor.js   |
              +--------------+
```

### Component Boundaries

| Component | Responsibility | Status | Communicates With |
|-----------|---------------|--------|-------------------|
| `config/agents/mastra.sh` | Agent adapter for mastracode | NEW | launch-agent-common.sh |
| `@mastra/opencode` plugin | Live OM for OpenCode sessions | NEW (install) | OpenCode plugin hooks, observation store |
| Observation Store (LibSQL) | Persist observations across agents | NEW | mastracode (built-in), OpenCode plugin, batch converter |
| `scripts/transcript-to-observations.js` | Batch converter: LSL transcripts to observations | NEW | .specstory files, observation store |
| `scripts/enhanced-transcript-monitor.js` | Verbatim LSL logging (existing) | MODIFY (minor) | Add optional observation tap hook |
| `scripts/launch-agent-common.sh` | Agent-agnostic launcher | NO CHANGE | Already agent-agnostic |
| `bin/coding` | CLI entry point | MODIFY (minor) | Add `--mastra` flag |
| `config/transcript-formats.json` | Transcript format definitions | MODIFY | Add mastracode format |
| mastracode (global npm) | Terminal coding agent with built-in OM | INSTALL | Observation store, tmux session |

## New Components (4)

### 1. Agent Adapter: `config/agents/mastra.sh`

Follows the established pattern from claude.sh, copilot.sh, opencode.sh.

```bash
#!/bin/bash
# Agent definition: Mastra Code
AGENT_NAME="mastra"
AGENT_DISPLAY_NAME="Mastra Code"
AGENT_COMMAND="mastracode"
AGENT_SESSION_PREFIX="mastra"
AGENT_SESSION_VAR="MASTRA_SESSION_ID"
AGENT_TRANSCRIPT_FMT="mastra"
AGENT_ENABLE_PIPE_CAPTURE=true
AGENT_PROMPT_REGEX='>\s+([^\n\r]+)[\n\r]'
AGENT_REQUIRES_COMMANDS="mastracode"

agent_check_requirements() {
  if ! command -v mastracode &>/dev/null; then
    _agent_log "Error: mastracode not installed"
    _agent_log "Install: npm install -g mastracode"
    exit 1
  fi
}

agent_pre_launch() {
  # mastracode uses its own LibSQL for OM storage
  # Ensure observation DB path is consistent with our infra
  export MASTRA_STORAGE_URL="file:${CODING_REPO}/.data/observations/mastra.db"
  validate_agent_connectivity "$AGENT_NAME" || true
}
```

**Complexity:** Low. Follows existing pattern exactly.

### 2. OpenCode Mastra Plugin: `.opencode/plugins/mastra-memory/`

Installs `@mastra/opencode` as an OpenCode plugin for live observational memory during OpenCode sessions.

**Configuration approach:** `.opencode/mastra.json` in the project root:

```json
{
  "model": "anthropic/claude-haiku-4-5",
  "scope": "thread",
  "storage": {
    "provider": "libsql",
    "url": "file:.data/observations/opencode.db"
  },
  "observation": {
    "messageTokens": 30000,
    "bufferTokens": 0.2
  }
}
```

**Integration mechanism:** OpenCode's plugin system provides hooks for:
- `session.created` -- initialize OM for new sessions
- `message.updated` -- feed messages to Observer
- `session.compacted` -- trigger observation before compaction (critical: this is where OM prevents information loss)
- `experimental.session.compacting` -- inject observations into system prompt pre-compaction

**Key hook:** `experimental.session.compacting` is the most important -- it fires before OpenCode discards old messages, giving the Observer a chance to compress them into observations first. Without this, compaction destroys context that OM could have preserved.

**Complexity:** Medium. Plugin structure is straightforward, but coordinating OM timing with OpenCode's compaction lifecycle requires careful testing.

### 3. Batch Transcript-to-Observation Converter: `scripts/transcript-to-observations.js`

Converts historical LSL transcripts (verbatim .specstory markdown, Claude JSONL, Copilot events.jsonl, OpenCode SQLite) into mastra-style observations using the standalone `observe()` API.

**Architecture:**

```
transcript-to-observations.js
  |
  +-- TranscriptReader (per-format adapter)
  |     |-- ClaudeJSONLReader     (.specstory JSONL files)
  |     |-- CopilotEventsReader   (events.jsonl from Copilot)
  |     |-- OpenCodeSQLiteReader  (opencode.db message tables)
  |     +-- SpecstoryMarkdownReader (.specstory .md files)
  |
  +-- MessageNormalizer
  |     Converts all formats to mastra Message[] shape:
  |     { role: 'user'|'assistant', content: string, createdAt: Date }
  |
  +-- ObservationWriter
        Uses @mastra/memory standalone observe() API:
        observe({ threadId, resourceId, messages })
        Writes to shared LibSQL observation store
```

**Data flow for batch conversion:**

1. Scan `.specstory/history/` for unprocessed transcripts (track processed files in a manifest)
2. Read transcript, detect format (claude-code-v2, claude-legacy-v1, copilot, opencode)
3. Normalize messages to mastra Message[] shape
4. Call `observe()` with normalized messages -- this triggers the Observer agent which compresses into observations
5. Store observations in LibSQL
6. Mark transcript as processed in manifest

**Standalone observe() API** (from PR #12925):
```typescript
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

const memory = new Memory({
  storage: new LibSQLStore({ url: 'file:.data/observations/batch.db' }),
  options: { observationalMemory: true }
});

await memory.observe({
  threadId: `lsl-${transcriptHash}`,
  resourceId: 'coding-project',
  messages: normalizedMessages,
  hooks: {
    onObservationStart: () => { /* progress logging */ },
    onObservationEnd: (obs) => { /* store observation metadata */ }
  }
});
```

**Complexity:** High. Multiple transcript formats, LLM calls for observation generation (cost consideration), idempotency tracking.

### 4. Observation Store Configuration

A shared directory for per-agent observation storage. Each agent gets its own database file to avoid contention, with a unified query layer.

```
.data/observations/
  mastra.db      -- mastracode's built-in OM storage
  opencode.db    -- OpenCode plugin's OM storage
  batch.db       -- batch converter output
  manifest.json  -- tracks which transcripts have been converted
```

**Why separate DBs:** Mastracode manages its own LibSQL internally. We cannot share a single DB file between mastracode's built-in storage and our external writers without risking lock contention. Separate files, unified query interface.

**Complexity:** Low for storage setup. Medium for unified query layer if needed later.

## Modified Components (3)

### 1. `bin/coding` -- Add `--mastra` flag

Add one case to the argument parser:

```bash
--mastra)
  FORCE_AGENT="mastra"
  shift
  ;;
```

**Impact:** Trivial. One line in the case statement, follows existing `--claude`, `--copilot`, `--opencode` pattern.

### 2. `scripts/enhanced-transcript-monitor.js` -- Optional observation tap

The existing transcript monitor does verbatim LSL logging. For the v4.0 milestone, it could optionally feed messages to the observation pipeline in real-time (online mode).

**Approach:** Add an optional `ObservationTap` that:
- Receives the same exchange data the LSL pipeline processes
- Buffers exchanges until token threshold is reached
- Calls `observe()` to generate observations
- Runs asynchronously -- never blocks LSL logging

```
[Exchange Extracted] --> LSLFileManager (existing, unchanged)
                    \--> ObservationTap (new, optional)
                           |
                           v
                         observe() --> observations.db
```

**IMPORTANT:** This is additive. The existing LSL verbatim logging continues unchanged. Observations are a parallel output stream.

**Complexity:** Medium. The tap itself is simple, but managing the token budget and async observe() calls alongside the existing pipeline needs care.

### 3. `config/transcript-formats.json` -- Add mastracode format

Mastracode stores conversations in LibSQL (SQLite). The format adapter needs to read from SQLite tables rather than JSONL files.

```json
{
  "mastra-v1": {
    "id": "mastra-v1",
    "name": "Mastra Code V1 Format",
    "description": "SQLite-backed conversation threads from mastracode",
    "version": "1.0",
    "storage": "libsql",
    "patterns": {
      "threadTable": "threads",
      "messageTable": "messages",
      "observationTable": "observations"
    }
  }
}
```

**Complexity:** Medium. New adapter type (SQLite reader vs JSONL reader).

## Data Flow: Live Observations vs Batch Conversion

### Live Observation Flow (Online Mode)

```
Agent Session (running)
  |
  |-- [mastracode path]
  |     mastracode has built-in OM
  |     Observer runs automatically after 30k tokens
  |     Observations stored in mastra.db
  |     No external integration needed
  |
  |-- [opencode path]
  |     @mastra/opencode plugin active
  |     Hooks into message.updated events
  |     Observer triggers at token threshold
  |     Observations stored in opencode.db
  |     System prompt enriched with compressed observations
  |
  |-- [claude path]
  |     enhanced-transcript-monitor.js running
  |     ObservationTap (optional) feeds exchanges to observe()
  |     Observations stored in batch.db (or claude.db)
  |     Claude Code itself unaware of observations
  |     (Claude has its own context management via MCP)
  |
  v
Observation Store (.data/observations/*.db)
```

### Batch Conversion Flow (Offline Mode)

```
Historical Transcripts
  |
  |-- .specstory/history/*.md     (Claude sessions)
  |-- .specstory/history/*.jsonl  (Claude JSONL)
  |-- copilot/events.jsonl        (Copilot sessions)
  |-- opencode.db                 (OpenCode sessions)
  |
  v
transcript-to-observations.js
  |
  |-- 1. Scan for unprocessed files (check manifest.json)
  |-- 2. Detect format (auto-detect from file extension + content)
  |-- 3. Read & normalize to Message[]
  |-- 4. Call observe() with LLM (Gemini Flash recommended for cost)
  |-- 5. Store observations in batch.db
  |-- 6. Update manifest.json (mark as processed)
  |
  v
.data/observations/batch.db
```

### Observation-to-Knowledge-Graph Flow (Future)

```
Observation Store
  |
  v
UKB Pipeline (existing wave-analysis)
  |-- New observation source adapter
  |-- Reads observations instead of/alongside raw transcripts
  |-- Feeds into existing entity extraction
  |
  v
Knowledge Graph (Graphology + LevelDB)
```

This is a v4.1+ concern. For v4.0, observations are a parallel output alongside LSL -- the UKB pipeline continues reading raw transcripts.

## Patterns to Follow

### Pattern 1: Agent Adapter Convention
**What:** Every coding agent gets a `config/agents/<name>.sh` file with standardized variables and hook functions.
**When:** Adding any new agent.
**Why:** The infrastructure is already agent-agnostic. Following the convention means zero launcher changes.

### Pattern 2: Parallel Output Streams (Not Replacement)
**What:** Observations run alongside LSL verbatim logging, not instead of it.
**When:** Integrating OM into existing LSL pipeline.
**Why:** LSL verbatim logs are the source of truth for session replay, debugging, and compliance. Observations are a compressed derivative. Losing the original data is unacceptable. Phase later: once OM is proven reliable, verbatim logging could become optional.

### Pattern 3: Per-Agent Storage Isolation
**What:** Each agent's observation DB is a separate LibSQL file.
**When:** Setting up observation storage.
**Why:** Mastracode manages its own LibSQL internally and cannot share a DB file with external writers. Separate files avoid lock contention and simplify debugging. A unified query layer can be added later.

### Pattern 4: OpenCode Plugin for External Memory
**What:** Use OpenCode's plugin system (`.opencode/plugins/`) to inject OM via lifecycle hooks.
**When:** Adding memory capabilities to OpenCode sessions.
**Why:** OpenCode does not natively support mastra memory. The plugin system provides the necessary hooks (`session.compacting`, `message.updated`) to intercept conversations and run the Observer.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Replacing LSL Before OM Is Proven
**What:** Removing verbatim transcript logging in favor of observation-only logging.
**Why bad:** Observations are lossy by design (5-40x compression). If the Observer misses something, it is gone forever. LSL verbatim logs are the safety net.
**Instead:** Run both in parallel. Evaluate observation quality over weeks. Only then consider making verbatim logging optional.

### Anti-Pattern 2: Sharing a Single LibSQL DB Across Agents
**What:** Pointing mastracode, OpenCode plugin, and batch converter at the same .db file.
**Why bad:** LibSQL/SQLite has write-lock contention. Mastracode holds its DB connection open continuously. External writers would block or fail.
**Instead:** Per-agent DB files with a unified read-only query layer if cross-agent queries are needed.

### Anti-Pattern 3: Running Batch Conversion with Expensive Models
**What:** Using claude-opus-4 or gpt-5 for batch transcript-to-observation conversion.
**Why bad:** Historical transcripts may total millions of tokens. At $15/MTok input, converting 100 sessions could cost $50+.
**Instead:** Use gemini-2.5-flash (default OM model) or deepseek for batch conversion. Reserve expensive models for live observation where quality matters most.

### Anti-Pattern 4: Modifying Mastracode Internals
**What:** Forking or patching mastracode to change its storage or memory behavior.
**Why bad:** Mastracode is an npm package under active development. Patches break on updates.
**Instead:** Configure via environment variables (`MASTRA_STORAGE_URL`) and project-level settings. Use mastracode as-is.

## Scalability Considerations

| Concern | Now (3 agents) | At 10+ projects | At 1000+ sessions |
|---------|----------------|-----------------|-------------------|
| Storage | Separate .db per agent, ~10MB each | Same pattern, trivial | Batch.db may grow large; add date-partitioned DBs |
| LLM cost | Live OM: included in session cost | Same | Batch conversion: budget gemini-flash at ~$0.10/session |
| Process count | +0 for mastra (built-in), +0 for OpenCode (plugin), +0 for Claude (tap in existing monitor) | Same per-project | Global LSL coordinator already handles multi-project |
| Query latency | SQLite reads are fast | Still fast per-DB | Need index on threadId + timestamp if querying across DBs |

## Integration Dependency Graph (Build Order)

```
Phase 1 (Independent, no dependencies):
  config/agents/mastra.sh          -- agent adapter
  bin/coding --mastra flag         -- CLI entry
  npm install -g mastracode        -- install agent

Phase 2 (Depends on Phase 1 for testing):
  .opencode/plugins/mastra-memory/ -- OpenCode OM plugin
  @mastra/opencode + @mastra/memory + @mastra/libsql install

Phase 3 (Depends on Phase 2 for shared libraries):
  scripts/transcript-to-observations.js  -- batch converter
  .data/observations/ directory setup
  manifest.json tracking

Phase 4 (Depends on Phase 3):
  ObservationTap in enhanced-transcript-monitor.js -- live Claude OM
  Integration testing across all agents
```

**Critical path:** Phase 1 (mastracode agent) and Phase 2 (OpenCode plugin) can be built in parallel after the mastracode npm install. Phase 3 (batch converter) depends on @mastra/memory and @mastra/libsql packages being available (installed in Phase 2). Phase 4 (live Claude OM tap) is the riskiest because it modifies the existing LSL pipeline.

## Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| LibSQL (SQLite) for observation storage | Mastracode uses LibSQL natively; no external DB server needed; consistent with local-first philosophy |
| Per-agent DB files | Avoids write contention; mastracode manages its own DB internally |
| gemini-2.5-flash for Observer model | Mastra's default; 128K context; fast; cheap ($0.15/MTok input); good enough for observation compression |
| Plugin-based OpenCode OM | OpenCode has a mature plugin API with lifecycle hooks; no forking needed |
| Observations parallel to (not replacing) LSL | Safety net; LSL is proven; OM is new; both can coexist with zero conflict |
| Batch converter uses standalone observe() API | PR #12925 added this exact capability; avoids needing a full Mastra agent instance |

## Sources

- [Mastra GitHub Repository](https://github.com/mastra-ai/mastra) -- HIGH confidence (primary source)
- [Observational Memory Documentation](https://mastra.ai/docs/memory/observational-memory) -- HIGH confidence (official docs)
- [PR #12925: @mastra/opencode plugin](https://github.com/mastra-ai/mastra/pull/12925) -- HIGH confidence (merged PR)
- [OpenCode Plugin API](https://opencode.ai/docs/plugins/) -- HIGH confidence (official docs)
- [Mastra Code Announcement](https://mastra.ai/blog/announcing-mastra-code) -- HIGH confidence (official blog)
- [mastracode npm](https://www.npmjs.com/package/mastracode) -- HIGH confidence (published package)
- [Mastra Memory Storage Docs](https://mastra.ai/docs/memory/storage) -- HIGH confidence (official docs)
- [pi-mono/coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) -- MEDIUM confidence (upstream of mastracode TUI)
