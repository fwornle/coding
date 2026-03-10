# Stack Research: v3.0 Workflow State Machine

**Domain:** Typed state machine for multi-agent workflow orchestration
**Researched:** 2026-03-10
**Confidence:** HIGH — based on codebase inspection, npm registry, official docs

---

## What This Milestone Adds

Replace ad-hoc workflow state management (untyped JSON progress file, boolean flags, fallback inference in dashboard) with a typed state machine. This document covers ONLY the net-new stack decisions for v3.0. The existing stack (TypeScript 5.8.3, React 18, Redux Toolkit 2.9, Express 4.21, Graphology, etc.) is unchanged and documented in prior versions of this file below.

---

## Key Decision: Hand-Rolled Discriminated Union State Machine

**Recommendation: Do NOT use XState or robot3. Hand-roll a discriminated union state machine.**

### Rationale

| Factor | XState v5 | robot3 | Hand-rolled DU |
|--------|-----------|--------|----------------|
| Bundle size | ~17KB min+gz | ~1KB | 0KB (it's your code) |
| TypeScript DX | Good with `setup()` API, but state-specific context not supported until v6 | Functional API, weaker TS inference | Perfect — discriminated unions ARE TypeScript's type system |
| Learning curve | Significant — actors, services, guards, invoke patterns | Moderate — functional but different paradigm | Zero — team already knows TS unions |
| State-specific data | NOT supported (confirmed: XState v6 feature) | Not supported | Native — each state variant carries its own data |
| Visualization | Stately.ai visualizer | None | None needed — states are explicit in code |
| Dependencies added | 1 (xstate) + 1 (@xstate/react) for dashboard | 1 (robot3) + 1 (react-robot) | 0 |
| Fits this codebase | Over-engineered for 6 workflow states | Too small community (2K stars vs 29K) | Matches existing TypeScript-first, zero-dep approach |

**The decisive factor:** XState v5 cannot associate different context shapes with different states. The workflow needs `idle` (no data), `running` (currentStep, substepIndex), `paused` (pausedAt, resumeToken), `failed` (error, failedStep). Discriminated unions do this natively:

```typescript
type WorkflowState =
  | { status: 'idle' }
  | { status: 'running'; currentStep: string; substepIndex: number; startedAt: Date }
  | { status: 'paused'; pausedAt: Date; pausedStep: string; resumeToken: string }
  | { status: 'completed'; completedAt: Date; summary: WorkflowSummary }
  | { status: 'failed'; error: string; failedStep: string; failedAt: Date };
```

TypeScript's `switch (state.status)` gives exhaustive checking. XState would add complexity without adding value for a workflow with ~6 states and ~10 transitions.

**When XState WOULD be right:** If the workflow had 20+ states, nested parallel regions, or needed the Stately.ai visual editor for non-developer stakeholders. This workflow does not.

---

## New Stack Additions

### 1. Shared Type Package — No New Library

**What:** A shared TypeScript types file defining `WorkflowState`, `WorkflowEvent`, and `WorkflowTransition` types, consumed by both the backend (MCP server) and frontend (dashboard).

**Pattern:** Single `.ts` file with type-only exports, copied or symlinked to both packages at build time. NOT a separate npm package — the overhead of publishing/versioning a private package for ~100 lines of types is not justified.

**Location:** `integrations/mcp-server-semantic-analysis/src/types/workflow-state.ts` (source of truth)
**Consumer:** `integrations/system-health-dashboard/src/types/workflow-state.ts` (copy, kept in sync by build script)

**Why not a shared package:** This project already manages 3 submodules with build+Docker rebuild cycles. Adding a 4th package with its own package.json, tsconfig, and build step would slow iteration. A copied types file with a header comment `// GENERATED — source: mcp-server-semantic-analysis/src/types/workflow-state.ts` is simpler and the team already uses this pattern (the dashboard manually defines types that mirror backend shapes).

**Why not path aliases / tsconfig paths:** The backend runs in Docker (compiled to dist/), the dashboard is a Vite app. Cross-submodule path resolution across these build systems is fragile. A simple copy is robust.

```bash
# Sync script (add to dashboard package.json scripts)
cp ../mcp-server-semantic-analysis/src/types/workflow-state.ts src/types/workflow-state.ts
```

---

### 2. SSE Event Typing — No New Library

**What:** Typed SSE events using the same discriminated union pattern. No library needed.

**Why not better-sse or ts-sse:** The backend already has a working Express SSE implementation on port 3848. The problem is not SSE transport — it works. The problem is that events are untyped strings with ad-hoc JSON payloads. The fix is TypeScript types on existing code, not a new SSE library.

**Pattern:**

```typescript
// Shared type (in workflow-state.ts)
type SSEEvent =
  | { type: 'workflow:state-change'; payload: WorkflowState }
  | { type: 'workflow:step-progress'; payload: { step: string; substep: string; progress: number } }
  | { type: 'workflow:heartbeat'; payload: { timestamp: number } }
  | { type: 'workflow:error'; payload: { message: string; step?: string } };

// Backend: type-safe emit
function emitSSE(res: Response, event: SSEEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
}

// Frontend: type-safe parse
function parseSSE(eventType: string, data: string): SSEEvent | null {
  // parse + validate against discriminated union
}
```

**What this replaces:** The current system where the dashboard receives raw SSE events and guesses meaning via fallback inference logic. With typed events, the dashboard becomes a pure consumer — no inference needed.

---

### 3. Zod for Runtime Validation — New Dependency

**Package:** `zod` ^3.24
**Install in:** Both `integrations/mcp-server-semantic-analysis/` and `integrations/system-health-dashboard/`

**Why:** TypeScript types are compile-time only. The workflow-progress.json file is read from disk, SSE events arrive as strings, and the dashboard receives JSON over HTTP. Runtime validation is needed at these boundaries:

1. **Reading workflow-progress.json** — currently untyped `JSON.parse()`, source of stuck boolean flags
2. **Parsing SSE events in dashboard** — currently untyped, source of fallback inference bugs
3. **API responses from health endpoint** — currently trust-and-cast

Zod is the right choice because:
- Zero dependencies
- TypeScript-first — `z.infer<typeof schema>` derives types from schemas (single source of truth)
- Already the community standard (30M+ weekly downloads)
- Works in both Node.js and browser (Vite) environments
- Small: ~14KB min+gz

**What NOT to use:** io-ts (functional programming style mismatch), yup (less TypeScript integration), ajv (JSON Schema based, more verbose for this use case).

```bash
# In both submodules
cd integrations/mcp-server-semantic-analysis && npm install zod@^3.24
cd integrations/system-health-dashboard && npm install zod@^3.24
```

**Usage:**

```typescript
import { z } from 'zod';

const WorkflowStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({ status: z.literal('running'), currentStep: z.string(), substepIndex: z.number() }),
  z.object({ status: z.literal('paused'), pausedAt: z.string(), pausedStep: z.string() }),
  z.object({ status: z.literal('completed'), completedAt: z.string() }),
  z.object({ status: z.literal('failed'), error: z.string(), failedStep: z.string() }),
]);

type WorkflowState = z.infer<typeof WorkflowStateSchema>;

// Runtime-safe read from disk
function loadProgress(filePath: string): WorkflowState {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return WorkflowStateSchema.parse(raw); // throws ZodError if invalid
}
```

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| XState v5 | Over-engineered for ~6 states; no state-specific context until v6; adds 17KB + learning curve | Discriminated union with exhaustive switch |
| robot3 | Small community (2K GitHub stars), less TypeScript inference than raw unions | Discriminated union |
| @xstate/react | Unnecessary if not using XState | Redux dispatch of typed state changes |
| better-sse / ts-sse | SSE transport already works; problem is typing, not transport | Type the existing Express SSE code |
| Redux Saga / redux-observable | Workflow runs on backend, not in Redux; dashboard just displays state | SSE event listener dispatching to Redux |
| Socket.io | Bidirectional not needed; SSE is sufficient for server-to-client state push | Existing Express SSE |
| Separate shared npm package | Overhead of package management for ~100 lines of types | Copy types file with sync script |
| io-ts | FP style (Either/fold) clashes with imperative codebase style | Zod (imperative throw/catch) |

---

## Installation Summary

```bash
# Step 1: Backend — add Zod
cd /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis
npm install zod@^3.24

# Step 2: Rebuild submodule (CRITICAL)
npm run build

# Step 3: Docker rebuild (CRITICAL)
cd /Users/Q284340/Agentic/coding/docker
docker-compose build coding-services && docker-compose up -d coding-services

# Step 4: Dashboard — add Zod
cd /Users/Q284340/Agentic/coding/integrations/system-health-dashboard
npm install zod@^3.24
npm run build
```

**Total new dependencies: 1 (Zod).** Everything else is TypeScript types on existing code.

---

## Version Compatibility Matrix

| Package | Version | Compatible With | Verified |
|---------|---------|----------------|----------|
| zod | ^3.24 | TypeScript ^5.8.3, Node.js 20, Vite 5 | YES — zero deps, pure TS |
| typescript | ^5.8.3 (installed) | Discriminated unions, exhaustive checks | YES — native since TS 2.0 |
| @reduxjs/toolkit | ^2.9.0 (installed) | Typed action payloads from WorkflowState | YES — createSlice handles DU types |
| express | ^4.21.0 (installed) | Typed SSE emit wrapper | YES — Response type accepts write() |

---

## Existing Stack (Unchanged from v2.0)

All entries from the v2.0 STACK.md remain valid. Key components for reference:

- **Backend:** TypeScript 5.8.3, Express 4.21, Node.js 20, Graphology 0.25.4, Level 10.0
- **Frontend (Dashboard):** React 18.3.1, Redux Toolkit 2.9.0, Vite 5.3.1, Radix UI
- **Frontend (VKB):** React 18.2.0, D3 7.8.5, Redux Toolkit, Tailwind CSS
- **Infrastructure:** Docker, SSE on port 3848, Health API on port 3033
- **LLM:** Custom provider chain (Copilot/Claude/Groq/Anthropic/OpenAI/Gemini/DMR)

---

## Sources

**Codebase inspection (HIGH confidence):**
- `integrations/mcp-server-semantic-analysis/package.json` — confirmed TS ^5.8.3, Express ^4.21.0, no existing state machine libs
- `integrations/system-health-dashboard/package.json` — confirmed React ^18.3.1, Redux Toolkit ^2.9.0, Vite ^5.3.1
- `integrations/mcp-server-semantic-analysis/src/workflow-runner.ts` — confirmed ad-hoc state via cleanupState object, untyped progress file writes
- `.planning/PROJECT.md` — confirmed v3.0 scope: typed state machine, SSE event typing

**Web research (MEDIUM confidence):**
- [XState v5 TypeScript improvements](https://github.com/statelyai/xstate/discussions/2323) — confirmed state-specific context NOT supported in v5
- [XState v5 release blog](https://stately.ai/blog/2023-12-01-xstate-v5) — confirmed ~17KB bundle, setup() API
- [XState different context per state discussion](https://github.com/statelyai/xstate/discussions/1975) — confirmed "likely v6 feature"
- [robot3 npm](https://www.npmjs.com/package/robot3) — confirmed 148K weekly downloads, 2K stars
- [xstate npm](https://www.npmjs.com/package/xstate) — confirmed 2.4M weekly downloads, 29K stars
- [XState vs Robot comparison](https://blog.logrocket.com/comparing-state-machines-xstate-vs-robot/) — functional vs object API differences
- [better-sse](https://github.com/MatthewWid/better-sse) — confirmed spec-compliant but unnecessary when SSE transport already works
- [npm trends: state machine comparison](https://npmtrends.com/machina-vs-robot3-vs-state-machine-vs-stately.js-vs-ts-fsm-vs-typescript-fsm-vs-xstate) — download trend data

---
*Stack research for: v3.0 Workflow State Machine*
*Researched: 2026-03-10*
