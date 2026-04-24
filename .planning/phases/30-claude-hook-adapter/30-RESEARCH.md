# Phase 30: Claude Hook Adapter - Research

**Researched:** 2026-04-24
**Domain:** Claude Code UserPromptSubmit hook wiring to retrieval service
**Confidence:** HIGH

## Summary

Phase 30 is a straightforward wiring task: create a new Claude Code hook script that reads the user prompt from stdin JSON, calls the existing retrieval endpoint (`POST /api/retrieve` on port 3033), and outputs the returned markdown as `additionalContext` in the hook's JSON stdout. The retrieval service (Phase 29) is complete and tested. The hook infrastructure is well-understood from the existing constraint monitor hook.

The primary technical considerations are: (1) the exact JSON input/output format for Claude Code hooks, (2) prompt filtering to skip short/trivial prompts, (3) fail-open behavior with a tight HTTP timeout, and (4) registering the new hook alongside the existing constraint hook in `settings.local.json`.

**Primary recommendation:** Write a single plain JS file at `src/hooks/knowledge-injection-hook.js` that uses Node.js built-in `http.request` (no dependencies) with a 2-second timeout, outputting the Claude Code hook JSON format on success and exiting cleanly on any failure.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Create a separate hook script (NOT extending the existing constraint hook). Claude Code supports multiple hooks per event -- both run independently. The new script lives at `src/hooks/knowledge-injection-hook.js`.
- **D-02:** Register the new hook in `.claude/settings.local.json` under `hooks.UserPromptSubmit` as a second entry alongside the existing constraint monitor hook.
- **D-03:** Skip knowledge injection for short prompts (<20 tokens). Simple confirmations like "yes", "continue", "ok" don't benefit from knowledge context.
- **D-04:** Skip knowledge injection for slash commands (prompts starting with `/`). These are tool invocations, not knowledge queries.
- **D-05:** Skip knowledge injection for empty or whitespace-only prompts.
- **D-06:** When a prompt is filtered out, exit 0 immediately with no stdout (clean pass-through, no context injection).
- **D-07:** Use Claude Code's native hook output format: write JSON to stdout with `additionalContext` field. This appears as `<system-reminder>` context visible to Claude but not the user.
- **D-08:** The additionalContext content is the pre-formatted markdown from the retrieval service (tier headers, source attribution, relevance scores). No additional wrapping needed -- the retrieval service already formats it.
- **D-09:** If the retrieval service is unreachable, slow (>2s timeout), or returns an error, exit 0 with no stdout. Never block Claude from proceeding. Log errors to stderr only.
- **D-10:** If the retrieval service returns no results (all below threshold), exit 0 with no stdout. Don't inject empty context.

### Claude's Discretion
- Exact token counting method for the <20 token filter (character-based heuristic vs gpt-tokenizer)
- curl vs native http.request vs fetch for calling the retrieval endpoint
- Whether to pass the full prompt or first N characters to the retrieval service
- Timeout value (research suggests 2s, but could be 1s or 3s)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOOK-01 | Claude Code UserPromptSubmit hook calls retrieval service and injects results as system-reminder context | Hook JSON output format verified via Context7 docs; retrieval endpoint at POST /api/retrieve verified in server.js:4237; `additionalContext` field in `hookSpecificOutput` injects into conversation |
| HOOK-02 | Claude hook fails open -- if retrieval is down or slow, agent proceeds without injection | Exit code 0 with no stdout = clean pass-through; http.request timeout + try/catch around entire flow ensures fail-open |
| HOOK-03 | Short prompts (<20 tokens) skip injection to avoid noise on simple commands | Prompt filtering logic: whitespace split length check or character heuristic; exit 0 with no stdout for filtered prompts |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Prompt filtering (short/slash/empty) | Hook script (client-side) | -- | Must happen before any HTTP call to avoid unnecessary latency |
| Knowledge retrieval | API / Backend (port 3033) | -- | RetrievalService already exists; hook is a thin HTTP client |
| Context injection | Hook script (client-side) | -- | Claude Code hook stdout mechanism; no server involvement |
| Fail-open behavior | Hook script (client-side) | -- | All error handling is in the hook; server errors become silent no-ops |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `http` | (Node v25.8.1) | HTTP client for retrieval endpoint | Zero dependencies; hook must be fast to start; no npm install needed [VERIFIED: node --version] |
| Node.js built-in `process.stdin` | (Node v25.8.1) | Read hook input JSON from stdin | Same pattern as existing pre-prompt-hook-wrapper.js [VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | -- | -- | This phase requires zero npm dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `http.request` | `fetch` (global in Node 25) | fetch is simpler but http.request gives finer timeout control via `socket.setTimeout` |
| `http.request` | `curl` via child_process | Adds process spawn overhead (~50ms); native http avoids this |
| Character heuristic for token count | `gpt-tokenizer` npm package | Adds a dependency; whitespace split is sufficient for a <20 token filter (not precision-critical) |

**Installation:**
```bash
# No installation needed -- zero external dependencies
```

## Architecture Patterns

### System Architecture Diagram

```
User types prompt
       |
       v
  Claude Code
       |
       | (spawns hook process, pipes JSON to stdin)
       v
  knowledge-injection-hook.js
       |
       |-- Parse stdin JSON -> extract `prompt` field
       |-- Filter check: empty? slash command? too short?
       |     |
       |     +-- YES -> exit(0), no stdout
       |     |
       |     +-- NO -> continue
       |
       |-- HTTP POST localhost:3033/api/retrieve
       |     body: { query: prompt, budget: 1000, threshold: 0.75 }
       |     timeout: 2000ms
       |     |
       |     +-- ERROR/TIMEOUT -> stderr log, exit(0), no stdout
       |     |
       |     +-- SUCCESS -> parse response JSON
       |           |
       |           +-- No results / empty markdown -> exit(0), no stdout
       |           |
       |           +-- Has markdown -> write JSON to stdout:
       |                 {
       |                   "hookSpecificOutput": {
       |                     "hookEventName": "UserPromptSubmit",
       |                     "additionalContext": "<markdown>"
       |                   }
       |                 }
       |                 exit(0)
       v
  Claude Code reads stdout, injects as <system-reminder>
```

### Recommended Project Structure
```
src/
  hooks/
    knowledge-injection-hook.js   # NEW: Phase 30 hook script
integrations/
  mcp-constraint-monitor/
    src/hooks/
      pre-prompt-hook-wrapper.js  # EXISTING: constraint hook (unchanged)
.claude/
  settings.local.json             # MODIFIED: add second UserPromptSubmit entry
```

### Pattern 1: Hook Stdin Parsing
**What:** Read and parse the JSON that Claude Code pipes to hook stdin
**When to use:** Every hook invocation
**Example:**
```javascript
// Source: Context7 /ericbuess/claude-code-docs + existing pre-prompt-hook-wrapper.js
// Input format:
// {
//   "session_id": "abc123",
//   "transcript_path": "/Users/.../.claude/projects/.../uuid.jsonl",
//   "cwd": "/Users/...",
//   "permission_mode": "default",
//   "hook_event_name": "UserPromptSubmit",
//   "prompt": "Write a function to calculate factorial"
// }

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const prompt = input.prompt || '';
```

### Pattern 2: Hook JSON Output for Context Injection
**What:** Write JSON to stdout to inject additionalContext into Claude's conversation
**When to use:** When retrieval returns relevant results
**Example:**
```javascript
// Source: Context7 /ericbuess/claude-code-docs -- hooks.md
// Output format for UserPromptSubmit that allows prompt AND injects context:
const output = {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: markdownFromRetrieval,
  },
};
process.stdout.write(JSON.stringify(output));
process.exit(0);
```

### Pattern 3: Fail-Open HTTP Call
**What:** Call retrieval service with strict timeout, silently degrade on any error
**When to use:** Every non-filtered prompt
**Example:**
```javascript
// Source: Node.js http module + D-09 fail-open requirement
import http from 'node:http';

function callRetrieval(query, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ query, budget: 1000, threshold: 0.75 });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 3033,
        path: '/api/retrieve',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            resolve(data);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}
```

### Pattern 4: Settings Registration (Multiple Hooks)
**What:** Register the new hook alongside the existing constraint hook
**When to use:** One-time setup in settings.local.json
**Example:**
```json
// Source: Existing .claude/settings.local.json lines 295-304
// Current: single UserPromptSubmit entry
// Updated: array with two entries (Claude Code supports multiple hooks per event)
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/Q284340/Agentic/coding/src/hooks/knowledge-injection-hook.js"
          }
        ]
      }
    ]
  }
}
```

### Anti-Patterns to Avoid
- **Extending the existing constraint hook:** D-01 explicitly forbids this. Hooks run independently; mixing concerns makes both fragile.
- **Using `console.log` for output:** `console.log` adds a newline and could interfere with JSON parsing. Use `process.stdout.write(JSON.stringify(...))` directly.
- **Blocking on initialization:** The hook process starts fresh each invocation. Do NOT try to warm the fastembed model inside the hook -- the retrieval service on port 3033 handles that.
- **Catching errors and exiting non-zero:** Any non-zero exit code can block the prompt. ALWAYS exit 0, even on error (D-09).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | A precise tokenizer in the hook | Whitespace split heuristic (`prompt.trim().split(/\s+/).length`) | <20 token filter is a coarse gate, not a billing counter; precision is unnecessary |
| HTTP client | A custom fetch wrapper with retries | Node.js built-in `http.request` with timeout | Zero dependencies; retries add latency and complexity; fail-open means one attempt is sufficient |
| Knowledge retrieval | Any retrieval logic in the hook | `POST /api/retrieve` on port 3033 | The entire retrieval pipeline (embedding, Qdrant, RRF, budgeting) exists in the server; hook is a thin client |
| Context formatting | Markdown formatting in the hook | Pre-formatted markdown from retrieval service | D-08: retrieval service already formats with tier headers and attribution |

**Key insight:** The hook script should be as thin as possible -- read stdin, filter, HTTP call, write stdout. All intelligence is in the retrieval service.

## Common Pitfalls

### Pitfall 1: Shell Profile Noise in stdout
**What goes wrong:** Shell startup scripts (.zshrc, .bash_profile) print messages to stdout when the hook process spawns. This corrupts the JSON output that Claude Code expects.
**Why it happens:** Claude Code spawns the hook via a shell command; if the shell prints banners or PATH warnings, they prepend to stdout.
**How to avoid:** The hook runs as `node script.js`, not through a shell pipeline. The `#!/usr/bin/env node` shebang handles this. But ensure no `console.log` calls exist in the hook -- only `process.stdout.write` for the final JSON output.
**Warning signs:** Claude Code logs "Failed to parse hook output" errors.
[VERIFIED: Context7 /ericbuess/claude-code-docs -- "External factors like shell profile startup text can disrupt JSON parsing"]

### Pitfall 2: 10,000 Character Limit on Hook Output
**What goes wrong:** If `additionalContext` exceeds 10,000 characters, Claude Code saves it to a file and replaces the content with a preview + file path. The injected context becomes a file reference, not actual knowledge.
**Why it happens:** The retrieval service's token budget of 1000 tokens (~4000 chars) should stay well under the 10K char limit. But if budget is misconfigured or the service returns verbose output, it can exceed the cap.
**How to avoid:** The default budget of 1000 tokens produces ~4000 chars of markdown, safely under the 10K limit. Add a safety truncation in the hook: if markdown.length > 9500, truncate with a note.
**Warning signs:** Injected context contains file paths instead of knowledge markdown.
[VERIFIED: Context7 /ericbuess/claude-code-docs -- "Hook output injected into the context has a character limit of 10,000"]

### Pitfall 3: Hook Timeout vs HTTP Timeout Mismatch
**What goes wrong:** Claude Code has its own hook execution timeout. If the HTTP request timeout (2s) is close to or exceeds the hook timeout, the hook process gets killed before it can exit cleanly.
**Why it happens:** The hook timeout is configurable but may default to a low value. If HTTP timeout is 2s and hook timeout is 3s, there is only 1s for process startup + stdin parsing + stdout writing.
**How to avoid:** Use a 2s HTTP timeout (D-09). Claude Code's default hook timeout is generous (10s+), but add a process-level safety: `setTimeout(() => process.exit(0), 5000)` as an absolute ceiling.
**Warning signs:** Hook process killed by Claude Code with no stderr output.
[ASSUMED]

### Pitfall 4: Empty Markdown from Retrieval Service
**What goes wrong:** The retrieval service returns `{ markdown: "", meta: { results_count: 0 } }` when no results meet the threshold. If the hook outputs `additionalContext: ""`, Claude Code may inject an empty system-reminder block, wasting context window space.
**How to avoid:** Check both `markdown` truthiness and `meta.results_count > 0` before outputting. If either is falsy, exit 0 with no stdout (D-10).
**Warning signs:** Empty `<system-reminder>` blocks appearing in conversation context.
[VERIFIED: retrieval-service.js returns empty markdown when no results pass threshold]

## Code Examples

### Complete Hook Script Skeleton
```javascript
// Source: Patterns derived from pre-prompt-hook-wrapper.js + Context7 Claude Code hooks docs
#!/usr/bin/env node

import http from 'node:http';

// Absolute safety ceiling -- never let the hook hang
const SAFETY_TIMEOUT = setTimeout(() => process.exit(0), 5000);
SAFETY_TIMEOUT.unref();

const MIN_TOKENS = 20;
const HTTP_TIMEOUT_MS = 2000;
const RETRIEVAL_PORT = 3033;
const MAX_OUTPUT_CHARS = 9500; // Safety margin under 10K limit

async function main() {
  try {
    // 1. Read stdin
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return;

    const input = JSON.parse(raw);
    const prompt = (input.prompt || '').trim();

    // 2. Filter: empty
    if (!prompt) return;

    // 3. Filter: slash commands
    if (prompt.startsWith('/')) return;

    // 4. Filter: short prompts (<20 tokens)
    const tokenEstimate = prompt.split(/\s+/).length;
    if (tokenEstimate < MIN_TOKENS) return;

    // 5. Call retrieval service
    const result = await callRetrieval(prompt);
    if (!result || !result.markdown || result.meta?.results_count === 0) return;

    // 6. Safety truncation
    let markdown = result.markdown;
    if (markdown.length > MAX_OUTPUT_CHARS) {
      markdown = markdown.slice(0, MAX_OUTPUT_CHARS) + '\n\n[truncated]';
    }

    // 7. Output JSON to stdout
    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: markdown,
      },
    };
    process.stdout.write(JSON.stringify(output));
  } catch (err) {
    process.stderr.write(`[knowledge-hook] Error: ${err.message}\n`);
  }
}

function callRetrieval(query) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ query, budget: 1000, threshold: 0.75 });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: RETRIEVAL_PORT,
        path: '/api/retrieve',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: HTTP_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { resolve(null); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

main().then(() => process.exit(0));
```

### Settings.local.json Registration
```json
// Add second entry to hooks.UserPromptSubmit array
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/Q284340/Agentic/coding/src/hooks/knowledge-injection-hook.js"
          }
        ]
      }
    ]
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain text stdout from hooks | JSON with `hookSpecificOutput.additionalContext` | Claude Code hooks v2 (2025) | Discrete injection as system-reminder vs visible hook output |
| Single hook per event | Array of hook entries per event | Claude Code hooks v2 (2025) | Multiple independent hooks can run for same event |

**Deprecated/outdated:**
- Plain text stdout for context injection: Still works but appears as visible "hook output" to the user. JSON `additionalContext` is the discrete injection method. [VERIFIED: Context7]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Claude Code default hook timeout is 10s+ (generous enough for 2s HTTP + overhead) | Pitfall 3 | Hook could be killed before HTTP response; mitigated by safety setTimeout |
| A2 | Multiple UserPromptSubmit hook entries run independently (not sequentially blocking) | Architecture | If sequential, total latency = constraint hook + knowledge hook; user may notice delay |
| A3 | `hookSpecificOutput` without `decision: "block"` defaults to allowing the prompt | Pattern 2 | If Claude Code requires explicit `decision: "approve"`, hook would silently fail to inject |

## Open Questions

1. **Hook execution order and parallelism**
   - What we know: Claude Code supports arrays of hooks per event
   - What's unclear: Whether multiple hook entries run in parallel or sequentially
   - Recommendation: Test empirically after implementation; if sequential, measure cumulative latency

2. **Prompt truncation for retrieval query**
   - What we know: Retrieval endpoint caps query at 500 chars (server.js:4246)
   - What's unclear: Whether sending a long prompt (>500 chars) should be truncated client-side or let the server reject it
   - Recommendation: Truncate to first 500 chars in the hook before sending; avoids a 400 error that wastes round-trip time

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Hook script execution | Yes | v25.8.1 | -- |
| Retrieval service (port 3033) | Knowledge retrieval | Yes (when Docker running) | Phase 29 | Fail-open: exit 0 with no context |
| curl | Not required (using Node http) | Yes | 8.7.1 | -- |

**Missing dependencies with no fallback:**
- None

**Missing dependencies with fallback:**
- Retrieval service may be down -- hook fails open silently (D-09)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A -- localhost-only communication |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A -- single-user system, no access control needed |
| V5 Input Validation | Yes | Prompt length check (<500 chars to retrieval), JSON parse in try/catch |
| V6 Cryptography | No | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via stdin | Tampering | Hook passes prompt as-is to retrieval; retrieval service validates query length (500 char cap) |
| Stdout pollution | Tampering | Single `process.stdout.write` call with JSON.stringify; no console.log |
| Service availability | Denial of Service | 2s HTTP timeout + fail-open ensures hook never blocks Claude |

## Project Constraints (from CLAUDE.md)

- **TypeScript:** NOT required for this hook. CONTEXT.md D-01 specifies `knowledge-injection-hook.js` (plain JS). This matches the established pattern of plain JS for hooks and the STATE.md decision: "Plain JS for src/retrieval/ modules to match server.js consumer and avoid TS compilation step."
- **No console.log in .js files:** Use `process.stderr.write()` for error logging, `process.stdout.write()` for hook output. Hooks are noted as exempt in CONTEXT.md but the constraint checker may still flag them.
- **Serena MCP:** Not applicable (no code reading/searching needed at implementation time).
- **API design:** Not modifying any existing API; only consuming the existing retrieve endpoint.

## Sources

### Primary (HIGH confidence)
- Context7 `/ericbuess/claude-code-docs` -- Hook input/output JSON format, 10K char limit, additionalContext injection, UserPromptSubmit schema
- Codebase: `integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js` -- Existing hook pattern (stdin parsing, exit codes, error handling)
- Codebase: `integrations/system-health-dashboard/server.js:4237-4267` -- Retrieval endpoint implementation (POST /api/retrieve)
- Codebase: `src/retrieval/retrieval-service.js` -- RetrievalService.retrieve() method signature and response shape
- Codebase: `.claude/settings.local.json:295-314` -- Current hook registration format

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` -- Hook latency constraints, fail-open requirements, 10K char cap
- `.planning/research/FEATURES.md` -- UserPromptSubmit hook details, multi-agent adapter architecture

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - zero dependencies, all Node.js built-ins verified
- Architecture: HIGH - both hook format (Context7) and retrieval endpoint (codebase) fully verified
- Pitfalls: HIGH - documented in research + verified against Claude Code docs

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable domain, Claude Code hooks API unlikely to change rapidly)
