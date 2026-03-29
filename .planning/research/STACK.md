# Stack Research

**Domain:** Mastra.ai integration for observational memory, mastracode agent, and LSL-to-observations conversion
**Researched:** 2026-03-28
**Confidence:** MEDIUM (packages verified via npm/docs, but standalone observe() API is new and less documented)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@mastra/memory` | ^1.6.1 | Observational Memory engine (Observer + Reflector agents) | The core OM library. Provides standalone `observe()` API (since v1.4.0), token threshold management, and observation/reflection lifecycle. 95% on LongMemEval, 5-40x context compression vs raw message history. |
| `@mastra/core` | ^1.10.0 | Mastra framework core (Agent class, model routing) | Required peer dependency for `@mastra/memory`. Provides model routing to 1800+ models, lifecycle hooks. |
| `@mastra/libsql` | ^0.16.4 | LibSQL/SQLite storage adapter for observations | Local-first storage (no separate DB server needed). Stores threads, messages, token usage, and observations in SQLite. Already used by mastracode internally. Aligns with existing project preference for local storage (Graphology + LevelDB). |
| `mastracode` | ^0.9.2 | TUI coding agent (built on pi-tui) | The `coding --mastra` agent. Includes built-in OM, LibSQL persistence, MCP server support, project-scoped threads via git remote or path. Install globally. |
| `@mastra/opencode` | latest | OpenCode plugin for OM | Hooks into OpenCode lifecycle for auto-observe, context injection, and message filtering. Provides `memory_status` and `memory_observations` diagnostic tools. Merged in PR #12925 (Feb 2026). May need to be built from mastra monorepo source if not yet published to npm standalone. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `better-sqlite3` | ^11.x | Direct SQLite access for LSL batch converter | For reading OpenCode's SQLite transcript DB during batch conversion. Transitive dependency of libsql -- may already be available. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `mastracode` (global) | TUI coding agent | `npm install -g mastracode`. Requires Node.js >= 22.13.0. Project uses Node 25.x -- compatible. |
| `opencode` (Go binary) | Existing OpenCode agent | ALREADY INSTALLED. Plugin configured via `.opencode/mastra.json`. |

## What Already Exists (DO NOT ADD)

These are already in the project and must NOT be re-added or replaced:

| Existing | Where | Covers |
|----------|-------|--------|
| `graphology` ^0.25.4 | mcp-server-semantic-analysis | Knowledge graph storage -- observations feed INTO this, not replaced by it |
| `level` ^10.0.0 | mcp-server-semantic-analysis | LevelDB persistence for KG entities |
| `@anthropic-ai/sdk` ^0.57.0 | mcp-server-semantic-analysis | LLM calls -- use for batch observation conversion too |
| `openai` ^4.52.0 | mcp-server-semantic-analysis | Alternative LLM provider |
| `zod` ^4.3.6 | mcp-server-semantic-analysis | Runtime validation (already added in v3.0) |
| `enhanced-transcript-monitor.js` | scripts/ | LSL live logging pipeline -- extend with observation stage, don't replace |
| `StreamingTranscriptReader` | src/live-logging/ | Reads Claude JSONL, Copilot events, OpenCode SQLite |
| `AdaptiveExchangeExtractor` | src/live-logging/ | Exchange boundary detection |
| `SemanticAnalyzer` | src/live-logging/ | 5-layer classification |
| Agent adapter scripts | config/agents/*.sh | claude.sh, copilot.sh, opencode.sh -- add mastra.sh |

## Installation

```bash
# Mastra packages (in mcp-server-semantic-analysis or a new observations submodule)
npm install @mastra/memory@^1.6.1 @mastra/core@^1.10.0 @mastra/libsql@^0.16.4

# Mastracode -- install globally (TUI coding agent)
npm install -g mastracode@^0.9.2

# @mastra/opencode plugin -- check npm availability first
npm view @mastra/opencode version 2>/dev/null && npm install @mastra/opencode@latest
# If not on npm, build from mastra monorepo (packages/opencode)
```

## Key API Surface

### Standalone observe() -- for LSL-to-observations converter

This is the critical API for the batch converter and live observation pipeline. It allows feeding external messages into the OM engine without using a Mastra Agent wrapper.

```typescript
import { ObservationalMemory, ModelByInputTokens } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

const storage = new LibSQLStore({ url: 'file:.data/observations.db' });

const om = new ObservationalMemory({
  storage,
  model: 'anthropic/claude-sonnet-4-20250514',
  options: {
    messageTokens: 30_000,      // trigger observation when messages exceed this
    observationTokens: 40_000,  // trigger reflection when observations exceed this
    bufferTokens: 0.2,          // keep 20% buffer ratio
    blockAfter: 1.2,            // safety multiplier
  },
});

// Standalone observe -- feed transcript messages directly
await om.observe({
  threadId: 'lsl-session-2026-03-28-0600',
  resourceId: 'coding-project',
  messages: convertedMessages,  // MastraDBMessage[] format
  hooks: {
    onObservationStart: () => { /* progress indicator */ },
    onObservationEnd: (obs) => { /* bridge observations to KG */ },
    onReflectionStart: () => { /* log */ },
    onReflectionEnd: (ref) => { /* bridge reflections to KG */ },
  },
});
```

### Cost-Optimized Model Routing for Batch Processing

```typescript
import { ModelByInputTokens } from '@mastra/memory';

const om = new ObservationalMemory({
  storage,
  options: {
    observationalMemory: {
      observation: {
        model: new ModelByInputTokens({
          upTo: {
            5_000: 'anthropic/claude-haiku-3',        // small exchanges
            20_000: 'anthropic/claude-sonnet-4-20250514',     // medium sessions
            100_000: 'google/gemini-2.5-flash',       // large sessions (cost-effective)
          },
        }),
      },
    },
  },
});
```

### OpenCode Plugin Configuration

```json
// .opencode/mastra.json
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "scope": "thread"
}
```

The plugin uses lazy credential resolution from OpenCode's provider store -- no hardcoded API keys needed.

### Mastracode MCP Configuration

```json
// .mastracode/mcp.json
{
  "coding-services": {
    "type": "stdio",
    "command": "node",
    "args": ["integrations/mcp-server-semantic-analysis/dist/index.js"]
  }
}
```

### New Agent Adapter: config/agents/mastra.sh

```bash
AGENT_NAME="mastra"
AGENT_DISPLAY_NAME="Mastra Code"
AGENT_COMMAND="mastracode"
AGENT_SESSION_PREFIX="mastra"
AGENT_SESSION_VAR="MASTRA_SESSION_ID"
AGENT_TRANSCRIPT_FMT="mastra"  # new format -- LibSQL-based
AGENT_ENABLE_PIPE_CAPTURE=true
AGENT_REQUIRES_COMMANDS="mastracode"
```

Key environment variables for mastracode:
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` -- for API key auth
- Or use `/login` in mastracode for OAuth with Claude Max / ChatGPT Plus

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@mastra/libsql` (SQLite local) | `@mastra/pg` (PostgreSQL) | When sharing observations across multiple machines. Not needed for single-developer setup. |
| `@mastra/memory` standalone observe() | Full Mastra Agent wrapper | When you want complete agent lifecycle (generate + observe in one call). We don't -- existing agent infrastructure handles generation. |
| mastracode global install | npx mastracode | For one-off testing. Global install avoids npx startup delay for `coding --mastra`. |
| LibSQL file storage for observations | Direct Graphology/LevelDB writes | When bypassing Mastra storage entirely. NOT recommended -- let Mastra manage observation lifecycle, bridge to KG via hooks. |
| Text-based OM | Vector store RAG for memory | OM outperforms RAG on LongMemEval (95% vs lower). Add vector retrieval later as optional enhancement (`retrieval: { vector: true }`). |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@mastra/pg` | Adds PostgreSQL dependency to a local-first project. Unnecessary complexity for single-developer use. | `@mastra/libsql` -- zero-config SQLite |
| `@mastra/mem0` | Separate memory system, not integrated with OM. Would create two competing memory layers. | `@mastra/memory` OM |
| Vector store as primary memory | OM's text-based compression outperforms RAG on LongMemEval. Vector search is optional enhancement, not primary. | Text-based OM, add `retrieval: { vector: true }` later |
| Custom memory compression | Mastra's Observer/Reflector is battle-tested (95% LongMemEval). Rolling your own would take months for inferior results. | `@mastra/memory` standalone observe() |
| Replacing enhanced-transcript-monitor.js | Working system with 5-layer classification, exchange extraction, 3 transcript sources. Proven reliable. | Extend it: add observation output stage that feeds exchanges into `om.observe()` |
| pi-tui/pi-mono directly | Low-level TUI framework. mastracode wraps it with OM, thread management, MCP support. | `mastracode` package which includes pi-tui |

## Stack Patterns by Variant

**For live observation (coding --opencode with mastra plugin):**
- Install `@mastra/opencode` plugin
- Configure via `.opencode/mastra.json`
- Observations happen automatically during OpenCode sessions
- Existing LSL logging continues in parallel (defense in depth)

**For live observation (coding --mastra):**
- `mastracode` has OM built-in (LibSQL + auto-observe)
- Create `config/agents/mastra.sh` adapter
- MCP servers configured via `.mastracode/mcp.json`
- LSL support via tmux pipe capture (same pattern as other agents)
- Mastracode stores threads locally in LibSQL -- bridge to KG periodically

**For batch conversion (historical LSL to observations):**
- Use `@mastra/memory` standalone observe() API
- Build converter: read LSL markdown files -> parse exchanges -> convert to MastraDBMessage[] -> feed to om.observe()
- Three converter paths needed: Claude JSONL, Copilot events.jsonl, OpenCode SQLite
- Bridge observation results into Graphology KG via onObservationEnd hook
- Use ModelByInputTokens for cost control on large batch runs

**For live LSL refactoring (observations alongside verbatim):**
- Extend enhanced-transcript-monitor.js with observation output stage
- After exchange extraction + classification, feed to om.observe()
- Keep verbatim LSL output as fallback/audit trail (never remove)
- Observations stored in LibSQL; periodically synced to KG

## Architecture Integration Points

```
                     LIVE PATH                          BATCH PATH
                     --------                           ----------
  coding --opencode                                  .specstory/history/*.md
       |                                                    |
  @mastra/opencode plugin                     LSL batch converter (new script)
       |                                                    |
  auto-observe during session               parse exchanges -> MastraDBMessage[]
       |                                                    |
       v                                                    v
  @mastra/memory observe()  <---------- standalone observe() API
       |                                                    |
  Observer agent (compress)                    Observer agent (compress)
       |                                                    |
  Reflector agent (condense)                   Reflector agent (condense)
       |                                                    |
  LibSQL storage (.data/observations.db)       LibSQL storage
       |                                                    |
  onObservationEnd hook  -----> Bridge to Graphology KG <-----
                                        |
                                  Existing VKB viewer
                                  Existing wave-analysis pipeline
```

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@mastra/memory@^1.6.1` | `@mastra/core@^1.10.0` | Same monorepo, versions move in lockstep. Pin to same minor range. |
| `@mastra/libsql@^0.16.4` | `@mastra/memory@^1.6.1` | Storage adapter interface stable since 1.0. |
| `mastracode@^0.9.2` | Node.js >= 22.13.0 | Project uses Node 25.x -- compatible. Pre-1.0 so expect breaking changes between minor versions. |
| `@mastra/opencode` | OpenCode 0.x (Go binary) | Plugin interface may change. Pin to exact version when available. |
| `@mastra/memory` | Existing `@anthropic-ai/sdk@^0.57.0` | No conflict -- Mastra uses its own model routing layer. The SDK is only used by our existing pipeline. |
| `@mastra/libsql` | Existing `level@^10.0.0` | No conflict -- separate storage for observations (LibSQL) vs KG entities (LevelDB). |

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| @mastra/memory API + versions | HIGH | npm registry verified, official docs comprehensive |
| @mastra/libsql as storage | HIGH | npm verified, default storage for mastracode, well-documented |
| mastracode installation + requirements | HIGH | npm 0.9.2 verified, Node >= 22.13.0 confirmed from code.mastra.ai |
| Standalone observe() API | MEDIUM | Confirmed in PR #12925 + changelog (v1.4.0), but limited standalone documentation |
| @mastra/opencode plugin availability | LOW | PR merged but npm publication status unclear. May need monorepo build. |
| OpenCode plugin config (.opencode/mastra.json) | LOW | Inferred from PR description. Format needs runtime validation. |
| Mastracode MCP config (.mastracode/mcp.json) | MEDIUM | Documented on code.mastra.ai, stdio + HTTP transport confirmed |
| MastraDBMessage format for converter | MEDIUM | Referenced in PR but exact type shape needs Context7 or source inspection |

## Sources

- [Observational Memory Docs](https://mastra.ai/docs/memory/observational-memory) -- API, thresholds, storage backends, code examples (HIGH confidence)
- [Memory Overview](https://mastra.ai/docs/memory/overview) -- Package requirements, quickstart (HIGH confidence)
- [OM Research Paper](https://mastra.ai/research/observational-memory) -- 95% LongMemEval benchmark (HIGH confidence)
- [Announcing Mastra Code](https://mastra.ai/blog/announcing-mastra-code) -- Architecture, pi-tui, LibSQL storage, Node >= 22.13.0 (MEDIUM confidence)
- [PR #12925: @mastra/opencode plugin + standalone observe()](https://github.com/mastra-ai/mastra/pull/12925) -- Plugin API, hooks, observe() standalone (MEDIUM confidence)
- [Mastra Code site](https://code.mastra.ai/) -- Installation, configuration capabilities (MEDIUM confidence)
- [mastracode npm](https://www.npmjs.com/package/mastracode) -- Version 0.9.2 verified (HIGH confidence)
- [@mastra/memory npm](https://www.npmjs.com/package/@mastra/memory) -- Version 1.6.1 verified (HIGH confidence)
- [@mastra/core npm](https://www.npmjs.com/package/@mastra/core) -- Version 1.10.0 verified (HIGH confidence)
- [@mastra/libsql npm](https://www.npmjs.com/package/@mastra/libsql) -- Version 0.16.4 verified (HIGH confidence)
- [Mastra Changelog 2026-03-23](https://mastra.ai/blog/changelog-2026-03-23) -- Recent updates (MEDIUM confidence)

---
*Stack research for: Mastra.ai integration with coding infrastructure (v4.0)*
*Researched: 2026-03-28*
