# Phase 30: Claude Hook Adapter - Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 2 (1 new, 1 modified)
**Analogs found:** 2 / 2

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/hooks/knowledge-injection-hook.js` | hook (middleware-like) | request-response | `integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js` | exact |
| `.claude/settings.local.json` | config | N/A | Same file (lines 294-315) | self |

## Pattern Assignments

### `src/hooks/knowledge-injection-hook.js` (hook, request-response)

**Analog:** `integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js`

**Shebang + imports pattern** (lines 1-4):
```javascript
#!/usr/bin/env node

// The existing hook uses ESM imports:
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
```
**Adaptation:** The new hook needs only `import http from 'node:http';` -- no fs/path imports needed. Keep the `#!/usr/bin/env node` shebang and ESM format.

**Stdin parsing pattern** (lines 17-27):
```javascript
async function processPromptHook() {
  try {
    // Read hook data from stdin (Claude Code format)
    let hookData = '';
    if (process.stdin.isTTY === false) {
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      hookData = Buffer.concat(chunks).toString('utf8').trim();
    }
```
**Key detail:** The `process.stdin.isTTY === false` guard and `Buffer.concat` pattern. New hook should use the same stdin collection approach.

**Empty input guard pattern** (lines 29-32):
```javascript
    if (!hookData) {
      // No input data - allow continuation
      process.exit(0);
    }
```

**JSON parse with fallback pattern** (lines 34-40):
```javascript
    let promptData;
    try {
      promptData = JSON.parse(hookData);
    } catch (parseError) {
      // If not JSON, treat as plain text prompt
      promptData = { text: hookData };
    }
```

**Prompt extraction pattern** (line 44):
```javascript
    // Extract the prompt text
    const promptText = promptData.text || promptData.content || promptData.prompt || hookData;
```
**Adaptation:** Per RESEARCH.md, the Claude Code UserPromptSubmit input JSON uses the field `prompt`. The new hook should use `input.prompt` as the primary field.

**Fail-open error handling pattern** (lines 73-83):
```javascript
  } catch (error) {
    if (error.message.includes('CONSTRAINT VIOLATION')) {
      // Log the violation but don't show stack trace
      console.error(error.message);
      process.exit(1);
    } else {
      // Log other errors but allow continuation (fail open)
      console.error('⚠️ Prompt hook error:', error.message);
      process.exit(0);
    }
  }
```
**Adaptation:** The new hook ALWAYS fails open (exit 0). There is no blocking case. Replace `console.error` with `process.stderr.write()` per project constraint.

**Invocation pattern** (line 86):
```javascript
processPromptHook();
```
**Adaptation:** Use `main().then(() => process.exit(0));` as shown in RESEARCH.md to ensure clean exit.

---

### `.claude/settings.local.json` (config, modification)

**Current hook registration** (lines 294-304):
```json
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/Q284340/Agentic/coding/integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js"
          }
        ]
      }
    ],
```
**Modification:** Append a second object to the `UserPromptSubmit` array:
```json
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/Q284340/Agentic/coding/src/hooks/knowledge-injection-hook.js"
          }
        ]
      }
```
The array structure and object shape must match the existing entry exactly.

---

## Shared Patterns

### Stdin JSON Parsing (Hook Protocol)
**Source:** `integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js` lines 20-27
**Apply to:** `src/hooks/knowledge-injection-hook.js`
```javascript
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const hookData = Buffer.concat(chunks).toString('utf8').trim();
```

### Fail-Open Exit Convention
**Source:** `integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js` lines 78-82
**Apply to:** `src/hooks/knowledge-injection-hook.js` -- every catch block and every filter-skip path
```javascript
// Always exit 0 -- never block Claude from proceeding
process.stderr.write(`[knowledge-hook] Error: ${err.message}\n`);
process.exit(0);
```

### Error Logging via stderr (Project Constraint)
**Source:** Project CLAUDE.md + `src/retrieval/retrieval-service.js` line 64
**Apply to:** All logging in the hook script
```javascript
// NEVER use console.log in .js files (constraint monitor will flag it)
// Use process.stderr.write for diagnostics
process.stderr.write('[RetrievalService] Initialized (fastembed warm, Qdrant connected)\n');
```

### Hook JSON Output Format (Claude Code Protocol)
**Source:** RESEARCH.md Pattern 2 (verified via Context7 docs)
**Apply to:** `src/hooks/knowledge-injection-hook.js` -- the single stdout write point
```javascript
const output = {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: markdown,
  },
};
process.stdout.write(JSON.stringify(output));
```

### Retrieval Endpoint Contract
**Source:** `integrations/system-health-dashboard/server.js` lines 4237-4262
**Apply to:** HTTP call in `src/hooks/knowledge-injection-hook.js`
- **Request:** `POST /api/retrieve` with body `{ query: string, budget: number, threshold: number }`
- **Query limit:** 500 characters max (server returns 400 if exceeded)
- **Response:** `{ markdown: string, meta: { query, budget, results_count, latency_ms } }`
- **Empty result:** `markdown` is empty string, `meta.results_count` is 0

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| -- | -- | -- | All files have direct analogs |

## Metadata

**Analog search scope:** `integrations/mcp-constraint-monitor/src/hooks/`, `src/retrieval/`, `.claude/`, `integrations/system-health-dashboard/server.js`
**Files scanned:** 4
**Pattern extraction date:** 2026-04-24
