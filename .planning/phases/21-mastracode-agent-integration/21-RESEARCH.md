# Phase 21: Mastracode Agent Integration - Research

**Researched:** 2026-04-02
**Domain:** Shell scripting (agent adapter/launcher), Node.js (ETM/statusline), mastracode CLI integration
**Confidence:** HIGH

## Summary

Mastracode is a standalone terminal-based coding agent TUI (npm package `mastracode` v0.10.3) built on Mastra framework primitives (`@mastra/core`, `@mastra/memory`, `@mastra/libsql`). It is NOT a fork of opencode -- it is an independent project that happens to share some architectural concepts. The CLI binary is `mastracode`, installed via `npm install -g mastracode`.

The coding project's agent infrastructure is mature and highly standardized. Adding mastracode requires: (1) a `config/agents/mastra.sh` adapter following the opencode.sh pattern, (2) a `scripts/launch-mastra.sh` thin wrapper following the claude/copilot pattern, (3) a `--mastra` flag in `bin/coding`, (4) statusline/health/supervisor registration, and (5) a MastraTranscriptReader for ETM integration.

**Primary recommendation:** Follow the existing agent adapter pattern exactly. The hook-based LSL capture should use mastracode's native hook system (`.mastracode/hooks.json` with `Stop`, `SessionStart`, `SessionEnd` events) to write transcript data to a file that ETM's MastraTranscriptReader watches.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Use launch-agent-common.sh framework. Create config/agents/mastra.sh + scripts/launch-mastra.sh. Add coding --mastra flag.
- D-02: Standard 2-pane tmux layout (left = mastracode TUI, right = services/health).
- D-03: Full coding services startup (Docker containers, health API, dashboard).
- D-04: Launch in user's current working directory.
- D-05: Parallel session capable with separate session IDs.
- D-06: Agent adapter handles first-run setup in agent_pre_launch().
- D-07: All LLM calls route through Phase 20's llm-proxy.mjs only.
- D-08: Mastra lifecycle hooks write to a transcript file. ETM gets a new reader. NOT pipe-pane.
- D-09: Use native mastra format for transcript files.
- D-10: LSL output to .specstory/history/ with standard naming.
- D-11: No filename distinction -- agent identity in file header/metadata.
- D-12: Same combined statusline as all other agents.
- D-13: Unique color + icon for mastracode.
- D-14: Same recovery infrastructure as other agents.
- D-15: If LLM proxy unreachable at startup, warn and continue.
- D-16: Observations written to LibSQL as they happen, not batched.

### Claude's Discretion
- Which binary/CLI mastracode actually uses -- RESOLVED: `mastracode` binary from npm package `mastracode`
- Specific mastra lifecycle hook types and event schema -- RESOLVED: see research below
- Icon/color choice for statusline
- ETM reader implementation details for native mastra format

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MSTR-01 | User can start mastracode via `coding --mastra` with proper tmux session setup | Agent adapter pattern fully documented; bin/coding flag mechanism understood; mastracode binary confirmed as `mastracode` |
| MSTR-02 | Mastracode sessions appear in tmux statusline with LSL indicator and health monitoring | combined-status-line.js, statusline-health-monitor.js, and global-process-supervisor.js patterns documented |
| MSTR-03 | Enhanced-transcript-monitor captures mastracode conversations for LSL logging | Mastracode hook system fully researched (Stop, SessionStart, SessionEnd events); ETM multi-agent architecture documented; MastraTranscriptReader pattern clear |
</phase_requirements>

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mastracode | 0.10.3 | Coding agent TUI binary | The CLI being integrated; standalone npm package |
| @mastra/libsql | 1.7.3 | Conversation storage | Used by mastracode for thread/message persistence |
| @mastra/memory | 1.13.0 | Observational memory | Mastracode's built-in OM system |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| tmux | (system) | Session management | Standard 2-pane layout for all agents |
| llm-proxy.mjs | (project) | LLM routing | All mastra LLM calls route through this |
| enhanced-transcript-monitor.js | (project) | LSL capture | Gets new MastraTranscriptReader |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| mastracode hooks for transcript | pipe-pane capture | D-08 locks hooks approach; pipe-pane conflicts with pi-tui terminal |
| Native mastra format | Force JSONL conversion | D-09 locks native format; ETM reader handles conversion |

**Installation:**
```bash
npm install -g mastracode
```

**Version verification:** `mastracode` v0.10.3 confirmed via `npm view mastracode version` on 2026-04-02.

## Architecture Patterns

### Agent Adapter Pattern (MUST FOLLOW)
```
config/agents/mastra.sh          # Agent adapter (AGENT_NAME, AGENT_COMMAND, hooks)
scripts/launch-mastra.sh          # Thin wrapper (3 lines of unique code)
bin/coding                        # Main launcher (--mastra flag)
```

### Existing Agent Adapter Structure (from opencode.sh)
```bash
#!/bin/bash
AGENT_NAME="mastra"
AGENT_DISPLAY_NAME="Mastra"
AGENT_COMMAND="mastracode"
AGENT_SESSION_PREFIX="mastra"
AGENT_SESSION_VAR="MASTRA_SESSION_ID"
AGENT_TRANSCRIPT_FMT="mastra"
AGENT_ENABLE_PIPE_CAPTURE=false    # D-08: hooks, not pipe-pane
AGENT_REQUIRES_COMMANDS="mastracode"

agent_check_requirements() { ... }
agent_pre_launch() { ... }
```

### Existing Thin Wrapper Pattern (from launch-claude.sh)
```bash
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_REPO="$(dirname "$SCRIPT_DIR")"
export CODING_REPO
source "$SCRIPT_DIR/agent-common-setup.sh"
source "$SCRIPT_DIR/launch-agent-common.sh"
launch_agent "$CODING_REPO/config/agents/mastra.sh" "$@"
```

### Main Launcher Flag Pattern (from bin/coding)
```bash
# In the argument parser case block:
--mastra)
  FORCE_AGENT="mastra"
  shift
  ;;
```

### Mastracode Hook-Based Transcript Capture
Mastracode supports lifecycle hooks configured in `.mastracode/hooks.json`:
```json
{
  "Stop": [
    {
      "type": "command",
      "command": "echo '{\"event\":\"stop\",\"session_id\":\"$MASTRACODE_SESSION_ID\",\"message\":\"$MASTRACODE_STOP_MESSAGE\",\"reason\":\"$MASTRACODE_STOP_REASON\",\"cwd\":\"$MASTRACODE_CWD\"}' >> /path/to/transcript.jsonl",
      "timeout": 5000
    }
  ],
  "SessionStart": [...],
  "SessionEnd": [...],
  "UserPromptSubmit": [...]
}
```

Available hook events and their data:
| Event | Data Fields | Blocking | Use for LSL |
|-------|-------------|----------|-------------|
| SessionStart | session_id, cwd | No | Start new LSL file |
| SessionEnd | session_id, cwd | No | Close LSL file |
| UserPromptSubmit | session_id, message | Yes | Capture user turn |
| Stop | session_id, message, reason (complete/aborted/error) | Yes | Capture assistant final response |
| PreToolUse | session_id, tool_name, input | Yes | Optional: tool tracking |
| PostToolUse | session_id, tool_name, input, output, error | No | Optional: tool tracking |
| Notification | session_id, condition, description | No | Not needed for LSL |

All events include base fields: `session_id`, `cwd`, `hook_event_name`.

### ETM Multi-Agent Architecture
The ETM already supports multiple agent types. Adding mastra requires:
1. A `findMastraTranscript()` method (analogous to `findOpenCodeTranscript()`)
2. Registration in `findAllActiveTranscripts()`
3. A `MastraTranscriptReader` class that watches the hook-written transcript file

### Anti-Patterns to Avoid
- **Using pipe-pane for mastracode:** D-08 explicitly prohibits this. Mastracode uses pi-tui which conflicts with tmux pipe-pane capture.
- **Direct API key configuration:** D-07 requires all LLM calls through llm-proxy.mjs. Never set ANTHROPIC_API_KEY or OPENAI_API_KEY directly for mastracode.
- **Custom statusline for mastra:** D-12 requires using the same combined-status-line.js. Only add registration, not a new statusline.
- **Blocking startup on LLM proxy:** D-15 says warn and continue if proxy unreachable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent launch lifecycle | Custom launcher script | launch-agent-common.sh framework | 19-step orchestration already handles Docker, services, monitoring, tmux |
| Session management | Custom tmux setup | tmux-session-wrapper.sh | Handles session naming, status bar, env propagation |
| Process supervision | Custom health checks | global-process-supervisor.js | Already has cooldown, restart limits, heartbeat |
| LSL file management | Custom file creation/naming | LSLFileManager.js | Handles rotation, naming convention, directory creation |
| Network detection | Custom VPN detection | detect-network.sh / agent_pre_launch pattern | Already handles CN/proxy detection for model routing |

**Key insight:** The existing agent infrastructure handles 95% of the work. Mastracode integration is primarily about configuration (adapter + wrapper) and one new reader class (MastraTranscriptReader).

## Common Pitfalls

### Pitfall 1: mastracode Binary Not Found
**What goes wrong:** `mastracode` is not installed globally, agent_check_requirements fails
**Why it happens:** Unlike opencode (installed via `go install`), mastracode is an npm package
**How to avoid:** `agent_check_requirements()` checks `command -v mastracode` and provides install instructions
**Warning signs:** Error on `coding --mastra` startup

### Pitfall 2: Hook Environment Variables Not Available
**What goes wrong:** Hook shell commands reference `$MASTRACODE_SESSION_ID` etc. but they're not set
**Why it happens:** Mastracode passes hook data via environment variables, but the exact variable names need verification at runtime
**How to avoid:** The hook command should use the base fields documented in types.ts: `session_id`, `cwd`, `hook_event_name`
**Warning signs:** Empty values in transcript file

### Pitfall 3: LibSQL Database Locking
**What goes wrong:** ETM tries to read mastracode's LibSQL database while mastracode is writing
**Why it happens:** LibSQL (SQLite-based) has write locking
**How to avoid:** D-08 specifies hook-based file writing, NOT direct database polling. The MastraTranscriptReader watches hook-written files, never reads mastracode's DB directly.
**Warning signs:** SQLITE_BUSY errors

### Pitfall 4: First-Run OAuth in Headless tmux
**What goes wrong:** mastracode needs OAuth setup on first run but is inside a tmux pane
**Why it happens:** OAuth typically opens a browser, which may not work from tmux
**How to avoid:** `agent_pre_launch()` detects first-run state (no auth tokens) and guides user through setup inline. Research flag from STATE.md confirms this is untested.
**Warning signs:** mastracode hangs waiting for OAuth callback

### Pitfall 5: LLM Proxy Configuration
**What goes wrong:** mastracode makes direct API calls instead of routing through llm-proxy.mjs
**Why it happens:** mastracode has its own provider system; need to configure custom provider pointing to localhost:8089
**How to avoid:** Configure mastracode's custom provider to point to `http://localhost:8089/api/complete` as an OpenAI-compatible endpoint
**Warning signs:** API calls going directly to Anthropic/OpenAI, LLM proxy logs show no mastra traffic

### Pitfall 6: Hook Config Path Resolution
**What goes wrong:** `.mastracode/hooks.json` placed in wrong directory
**Why it happens:** Project-level hooks resolve from CWD, which may differ from CODING_REPO
**How to avoid:** Set up hooks in both global `~/.mastracode/hooks.json` and project-level; `agent_pre_launch()` should ensure hooks config exists
**Warning signs:** Hooks not firing, no transcript data

## Code Examples

### Agent Adapter (config/agents/mastra.sh)
```bash
#!/bin/bash
# Agent definition: Mastracode
# Sourced by launch-agent-common.sh

AGENT_NAME="mastra"
AGENT_DISPLAY_NAME="Mastra"
AGENT_COMMAND="mastracode"
AGENT_SESSION_PREFIX="mastra"
AGENT_SESSION_VAR="MASTRA_SESSION_ID"
AGENT_TRANSCRIPT_FMT="mastra"
AGENT_ENABLE_PIPE_CAPTURE=false
AGENT_REQUIRES_COMMANDS="mastracode"

agent_check_requirements() {
  if ! command -v mastracode &>/dev/null; then
    _agent_log "Error: mastracode CLI is not installed"
    _agent_log "Install: npm install -g mastracode"
    exit 1
  fi
  _agent_log "mastracode CLI detected ($(mastracode --version 2>/dev/null || echo 'unknown'))"
}

agent_pre_launch() {
  # Ensure hooks config exists for transcript capture
  local hooks_dir="$TARGET_PROJECT_DIR/.mastracode"
  if [ ! -f "$hooks_dir/hooks.json" ]; then
    mkdir -p "$hooks_dir"
    # Generate hooks config for LSL transcript capture
    _generate_mastra_hooks_config "$hooks_dir/hooks.json"
  fi

  # Validate LLM proxy reachability (warn only per D-15)
  if ! curl -sf http://localhost:8089/health >/dev/null 2>&1; then
    _agent_log "Warning: LLM proxy not reachable at localhost:8089"
    _agent_log "Mastracode will use its own provider config"
  fi

  validate_agent_connectivity "$AGENT_NAME" || true
}
```

### Main Launcher Flag Addition (bin/coding)
```bash
# Add after --opencode case:
--mastra)
  FORCE_AGENT="mastra"
  shift
  ;;
```

### Hook-Based Transcript Writer (conceptual)
The hook command writes NDJSON lines to a transcript file:
```bash
# In .mastracode/hooks.json, the hook command appends to a predictable path
# Path pattern: $CODING_REPO/.logs/mastra-transcript-${SESSION_ID}.jsonl
```

### MastraTranscriptReader Pattern (following StreamingTranscriptReader)
```javascript
// src/live-logging/MastraTranscriptReader.js
import fs from 'fs';
import { EventEmitter } from 'events';

class MastraTranscriptReader extends EventEmitter {
  constructor(options = {}) {
    super();
    this.transcriptDir = options.transcriptDir;
    this.watcher = null;
  }

  // Watch for new lines in the hook-written transcript file
  async startWatching(transcriptPath) {
    // Use fs.watch + tail-like reading for new NDJSON lines
    // Parse each line as a hook event
    // Emit 'exchange' events for ETM to process
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pipe-pane transcript capture | Lifecycle hook-based capture | D-08 decision | More reliable, no pi-tui conflict |
| opencode SQLite polling | File-watching hook output | D-08/D-09 decisions | Simpler, no DB locking issues |
| Direct API keys | LLM proxy routing | Phase 20 / D-07 | Unified cost tracking, network-adaptive |

## Open Questions

1. **mastracode Hook Environment Variable Names**
   - What we know: Hook events receive session_id, cwd, hook_event_name as base fields. Stop receives message and reason. UserPromptSubmit receives message.
   - What's unclear: The exact environment variable names passed to shell commands (e.g., is it `$MASTRACODE_SESSION_ID` or `$session_id`?). The types.ts shows the data shape but the executor.ts determines how they're exposed to shell commands.
   - Recommendation: Plan should include a verification task that runs mastracode with a test hook to confirm variable names.

2. **mastracode Custom Provider Configuration**
   - What we know: mastracode supports `/custom-providers` command for OpenAI-compatible endpoints. Phase 20 installed `.opencode/mastra.json` config.
   - What's unclear: Whether `.opencode/mastra.json` is the right config file for mastracode (vs `.mastracode/config.json`), and the exact format for pointing to llm-proxy.mjs.
   - Recommendation: The plan should configure custom provider pointing to `http://localhost:8089/api/complete` and verify with a test prompt.

3. **mastracode Database Storage Path**
   - What we know: mastracode uses LibSQL, stores in platform-specific app directory (`~/Library/Application Support/mastracode/` on macOS)
   - What's unclear: Whether the storage path is configurable to use `.observations/observations.db` as Phase 20 intended
   - Recommendation: Check if `storagePath` in config overrides the default. Not critical for Phase 21 (ETM uses hook files, not DB), but affects Phase 23.

4. **UserPromptSubmit Captures Only User Side**
   - What we know: `UserPromptSubmit` provides user message. `Stop` provides assistant's final message.
   - What's unclear: Whether `Stop` fires after every assistant turn or only at session end. If only at session end, we may miss individual assistant responses.
   - Recommendation: Test with a multi-turn conversation. If `Stop` only fires on exit, the plan needs an alternative approach -- possibly polling the LibSQL database alongside hooks, or using `PostToolUse` events to infer assistant activity.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| mastracode | Agent binary (MSTR-01) | Not installed | -- | `npm install -g mastracode` |
| tmux | Session management | Available | (system) | -- |
| Node.js | ETM, statusline, services | Available | >= 22 (Phase 20 gate) | -- |
| Docker | Coding services | Available | (system) | -- |
| llm-proxy.mjs | LLM routing (D-07) | Available | Phase 20 | -- |

**Missing dependencies with no fallback:**
- `mastracode` must be installed before `coding --mastra` can work. `agent_check_requirements()` handles this with a clear error message.

**Missing dependencies with fallback:**
- None -- all other dependencies are already available from Phase 20 and existing infrastructure.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bash integration tests + Node.js unit tests |
| Config file | tests/integration/launcher-e2e.sh (existing) |
| Quick run command | `bash tests/integration/launcher-e2e.sh` |
| Full suite command | `bash tests/run-e2e.sh` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MSTR-01 | `coding --mastra` launches mastracode in tmux | integration | `bash tests/integration/launcher-e2e.sh` (add mastra test) | Partial -- file exists, mastra test needed |
| MSTR-01 | Agent adapter config/agents/mastra.sh is valid | unit | `bash -n config/agents/mastra.sh` (syntax check) | Wave 0 |
| MSTR-02 | Statusline shows mastra session status | manual | Visual verification in tmux | -- |
| MSTR-02 | Process supervisor includes mastra | unit | `node -e "..."` (check registration) | Wave 0 |
| MSTR-03 | ETM discovers mastra transcript | integration | `node tests/unit/test-mastra-reader.js` | Wave 0 |
| MSTR-03 | LSL files created in .specstory/history/ | integration | Verify file creation after hook event | Wave 0 |

### Sampling Rate
- **Per task commit:** `bash -n config/agents/mastra.sh && bash tests/integration/launcher-e2e.sh`
- **Per wave merge:** `bash tests/run-e2e.sh`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/integration/launcher-e2e.sh` -- add `test_mastra_flag` test case (pattern: `test_claude_flag`)
- [ ] `tests/unit/test-mastra-reader.js` -- test MastraTranscriptReader parses hook NDJSON
- [ ] Verify mastracode hook variable names empirically

## Project Constraints (from CLAUDE.md)

- **TypeScript mandatory with strict type checking** -- MastraTranscriptReader should be .js (matches existing pattern in src/live-logging/) but follow strict conventions
- **Serena MCP ONLY for reading/searching code** -- Use Edit/Write for file operations
- **API design: never modify working APIs** -- Do not change existing ETM API; add mastra support additively
- **Submodule build requirement** -- ETM and statusline are NOT submodules (they're in scripts/), so no Docker rebuild needed
- **PlantUML via `plantuml` CLI only** -- If documentation diagrams needed

## Sources

### Primary (HIGH confidence)
- `config/agents/opencode.sh` -- Agent adapter template (read directly)
- `config/agents/claude.sh` -- Second adapter reference (read directly)
- `scripts/launch-agent-common.sh` -- Full 19-step orchestration framework (read directly)
- `scripts/launch-claude.sh` -- Thin wrapper pattern (read directly)
- `bin/coding` -- Main launcher with flag parsing (read directly)
- `scripts/enhanced-transcript-monitor.js` -- ETM multi-agent architecture (read directly)
- `scripts/combined-status-line.js` -- Statusline integration (read directly)
- `scripts/global-process-supervisor.js` -- Process supervision (read directly)
- GitHub raw: `mastracode/src/hooks/types.ts` -- Hook event types and data shapes
- GitHub raw: `mastracode/src/hooks/config.ts` -- Hook config loading paths

### Secondary (MEDIUM confidence)
- [OpenCode Plugins Guide](https://gist.github.com/johnlindquist/0adf1032b4e84942f3e1050aba3c5e4a) -- Plugin hook system reference
- [OpenCode Plugin Docs](https://opencode.ai/docs/plugins/) -- Event types catalog
- [Mastra Code README](https://github.com/mastra-ai/mastra/blob/main/mastracode/README.md) -- CLI binary, install, features
- [Mastra Code announcement](https://mastra.ai/blog/announcing-mastra-code) -- Architecture overview
- npm registry: `mastracode` v0.10.3 -- Version and dependencies confirmed

### Tertiary (LOW confidence)
- Exact environment variable names passed to hook shell commands -- inferred from types.ts, needs runtime verification
- mastracode custom provider config format for llm-proxy routing -- documented abstractly, needs testing
- `Stop` event firing frequency (per-turn vs per-session) -- needs empirical verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- mastracode binary and version confirmed via npm registry; existing agent infrastructure read from source
- Architecture: HIGH -- all patterns read directly from existing code; hook system verified from mastracode source
- Pitfalls: MEDIUM -- hook variable names and Stop event frequency need runtime verification; OAuth in tmux is an untested scenario

**Research date:** 2026-04-02
**Valid until:** 2026-04-16 (mastracode is fast-moving; v0.10.3 may change hooks)
