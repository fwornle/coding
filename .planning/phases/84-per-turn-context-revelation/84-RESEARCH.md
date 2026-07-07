# Phase 84: Per-Turn Context Revelation - Research

**Researched:** 2026-07-07
**Domain:** LLM-proxy request instrumentation + JSONL persistence + retention sweeper + redaction reuse + dashboard cache-explainer wiring (two repos: `coding` + `_work/rapid-llm-proxy`)
**Confidence:** HIGH (all code surfaces read directly this session; file:line anchors verified)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01: Age-based retention, dedicated launchd sweeper.** Keep context-turns files for a configurable window (default **14 days**), delete older. Sweeping runs in a **dedicated launchd job** (StartInterval + RunAtLoad, mirroring `com.coding.lsl-lock-sweeper`), **decoupled from span close** so an abandoned/never-closed span still gets cleaned by age.
- **D-02: Configurable + never-throw.** Retention window (and any size knob) live in `.planning/config.json` (or an env var) with the shipped default. The sweep and the per-request write hook are **best-effort**: errors go to stderr and never block span close or crash the proxy daemon — honors the Phase-82 D-06 / Phase-83 D-08 never-throw contract.
- **D-03: Write timing — append plaintext during span, gzip at close (user-confirmed default).** Per-request line appended to plaintext `context-turns.jsonl` in the request hot path (append-only, never-throw); at span close gzipped to `context-turns.jsonl.gz` and plaintext removed. A crashed/never-closed span leaves a still-readable uncompressed `.jsonl` that the age-sweeper (D-01) reclaims.
- **D-04: Co-locate under the measurements dir.** Files live in `.data/measurements/<sanitizeTaskId(task_id)>/` alongside Phase-83's `reconciliation.json`. Files: `context-turns.jsonl(.gz)` always; `raw-bodies.jsonl.gz` only when raw capture is enabled.
- **D-05: Per-experiment flag, default OFF, sibling file.** Full raw request/response bodies gated by a per-experiment/per-span config flag (e.g. `capture_raw_bodies: true`), default OFF. When on, raw bodies go to a separate `raw-bodies.jsonl.gz` sibling file.
- **D-06: Reuse the configured LSL redaction — do NOT reinvent.** Raw-body capture redacts via `.specstory/config/redaction-patterns.json` (27 patterns). **Known gap:** the current applier `scripts/enhanced-redaction-system.js` only applies 4 hardcoded PII regexes and does NOT load the config. Phase 84 MUST consume the full 27-pattern config. Redaction applied before write; a redaction error blocks that body's content (fail-closed on content, never the daemon).
- **D-07: Semantic-first digest with graceful fallback.** Per message record `role`, byte size, and for `tool_use`/`tool_result` the tool name + arg/result size. For the turn's meaning, prefer a reference to the ETM live observation/digest; fallback: short (~120-char) content preview when no observation correlates. Order: ETM observation/digest reference → preview fallback.
- **D-08: Cache-breakpoints as message indices; reuse the existing category taxonomy.** Cache-breakpoint positions encoded as message indices. "Category analysis" reuses the existing context-breakdown taxonomy (system/tools/history/…) at the proxy's `perRunBreakdownPath`.
- **D-09: Cache split stays separate.** `input` (fresh sent) / `cache_read` (cached) / `cache_write` / `output` carried separately per turn, never folded into a total.
- **D-10: Mirror the Phase-83 D-13 read-API pattern.** Proxy serves `/api/context-turns` (gunzip + return the per-turn array for a task); vkb-server adds a thin pass-through mirroring `handleReconciliation` (graceful-empty on ENOENT). Dashboard backend proxy gets a mirror line.
- **D-11: Wire data + honest copy, no new components.** Feed context-turns data into the existing `context-cache-explainer.tsx`, correct estimated/dishonest figures to real wire values, add "how prompt caching actually works" copy. **No new components.** New Redux surface: `fetchContextTurns(taskId)` thunk + `selectContextTurnsFor` selector mirroring the existing `fetchTimeline` pattern.
- **D-12: Honest all-agents cache display — N/A over inference.** OpenAI-wire agents (copilot/opencode) carry `cached_tokens` but no cache-creation counter. The explainer renders cache-write as "N/A (provider reports no cache-creation)" for those agents rather than `0` or an inferred value. Never infer a measurement.

### Claude's Discretion
- Exact JSONL field names/ordering, gzip level, append/flush mechanics (D-03).
- The precise config key names/paths for retention (D-02) and the raw-body flag (D-05).

### Deferred Ideas (OUT OF SCOPE)
- **Richer per-turn UI** (per-turn detail panel, tool-arg drill-down, stacked context band, cache-breakpoint viz) → **Phase 86 (Timeline v2)**.
- **Read-API line-size ceiling / pagination** for very large spans — not decided; revisit if a span's file grows unwieldy.
- 15 low-score VKB/observability/km-core todos surfaced by todo-match — separate workstream, not folded.
- Any change to interactive (non-measured) capture — this phase is **measured-span-only**.
- Reconciliation/discrepancy semantics — owned by Phase 83.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were mapped in ROADMAP for this phase (additional_context: "TBD (none mapped)"). The phase is governed entirely by the D-01..D-12 locked decisions above. The planner should trace tasks to those decisions rather than to REQ-IDs.
</phase_requirements>

## Summary

This phase adds a single new per-request write hook at the proxy and a small persistence/retention/read/UI pipeline around it. Almost everything is **reuse of existing, verified machinery** — there are no new external packages, no new UI components, and no new taxonomy. The two genuinely hard questions were flagged as research hand-offs and are both resolved below with concrete file:line evidence.

The proxy (`_work/rapid-llm-proxy/proxy-bridge/server.mjs`, runtime JS — **no build step**) has two natural write sites, one per wire: the `/v1/messages` tap (right after `logTokenCall` at ~2223) and the `/api/complete` pipeline (right after `logTokenCall` at ~2766). At both sites the full request body, the parsed cache split (`parseUsageCache` / `parseOpenAICache`), the taxonomy analyzer (`analyzeAnthropicRequest` / `analyzeOpenAIRequest`), the sanitized `task_id`, `agent`, and `requestId` are already in scope — the context-turns line is assembled from data that already exists, then appended to a plaintext JSONL under `.data/measurements/<task_id>/`. Span close (`scripts/measurement-stop.mjs` ~471, beside the reconciliation.json write) gzips the plaintext and removes it. A dedicated launchd sweeper (clone of `com.coding.lsl-lock-sweeper`) reclaims by age.

**Critical architectural finding (resolves hand-off #1):** ETM observations carry **no `task_id`** and are written **asynchronously by ETM after a prompt-set completes** — they do not exist at proxy-request time and the proxy cannot reach the observation store. Therefore the observation reference in D-07 **cannot** be resolved in the proxy hot path. The proxy writes the **preview fallback + timestamp + task_id + agent always**; the observation correlation (time-window + agent + project, the exact join the existing `fetchRunNarrative` thunk already performs) is resolved **at span close (measurement-stop.mjs) or at read time**, never in the request path. This matches CONTEXT's own note ("the store is queried at span close by task_id + timestamp window").

**Primary recommendation:** Add one `logContextTurn(...)` helper called best-effort at both proxy write sites (preview + tools + cache split + breakpoint indices + category snapshot); gzip+enrich at span close; clone the lsl-lock-sweeper launchd trio for retention; rewire the redaction applier to load the 27-pattern config as a shared module; mirror `handleReconciliation` for the read API; wire a `fetchContextTurns` thunk into the existing explainer with honest N/A rendering for OpenAI-wire agents.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-request turn line write | Proxy daemon (`server.mjs`) | — | Only the proxy has request+response bodies, cache split, and taxonomy in scope at request time |
| Preview fallback (~120 chars) | Proxy daemon | — | Raw message content is present at request time regardless of correlation success |
| ETM observation correlation | Coding repo (span close / read time) | vkb-server (read time) | Observations have no task_id, are written async post-prompt-set, and the store is unreachable from the proxy |
| gzip-at-close + plaintext removal | Coding repo (`measurement-stop.mjs`) | — | Span close is the one-time event; co-located beside reconciliation.json write |
| Age-based retention sweep | launchd job (bash) | — | Must run decoupled from span close so abandoned spans still get reclaimed (D-01) |
| Raw-body redaction | Coding repo (shared module) | — | Reuse the configured LSL redaction; one source of truth for LSL + raw-body writer |
| `/api/context-turns` read | Proxy daemon (gunzip+serve) | vkb-server pass-through | Mirrors the Phase-83 D-13 split: file owner serves, vkb proxies |
| Cache-explainer render | Dashboard frontend (React/Redux) | Dashboard backend (proxy line) | Existing explainer + performanceSlice; no new components (D-11) |

## Standard Stack

**No new external packages.** This phase is built entirely on Node stdlib + already-present project modules.

### Core (all already present / verified in-repo this session)
| Module | Location | Purpose | Why Standard |
|--------|----------|---------|--------------|
| `node:zlib` (gzip) | stdlib | gzip-at-close (D-03) | Already used by `scripts/lsl-file-manager.js` (`const zlib = require('zlib')`) and `live-logging-coordinator.js` — reuse the same helpers [VERIFIED: read lsl-file-manager.js:12] |
| `node:fs` append | stdlib | hot-path plaintext append (D-03) | `fs.appendFile` / `fs.createWriteStream({flags:'a'})` — never-throw wrap |
| `parseUsageCache` / `parseOpenAICache` | `_work/rapid-llm-proxy/src/usage-cache.ts` | sent/cached/fresh split per turn | Pure, never-throw; Phase-82 already flows these at both write sites [VERIFIED: read usage-cache.ts + server.mjs:2164,2190,2693] |
| `analyzeAnthropicRequest` / `analyzeOpenAIRequest` | `server.mjs:1659,1769` | category taxonomy (D-08) + cache-breakpoint detection | The single taxonomy the explainer already renders; returns `categories[]`, `cache_breakpoints`, per-category bytes [VERIFIED: read server.mjs:1659-1827] |
| `safeSanitizeTaskId` / `perRunBreakdownPath` | `server.mjs:1599,1608` | per-task file path + never-throw id guard | Exact naming pattern to reuse for the context-turns file path [VERIFIED: read server.mjs:1591-1612] |
| `handleReconciliation` | `lib/vkb-server/api-routes.js:605` | verbatim-serve + graceful-ENOENT read API | The template to clone for the vkb `/api/context-turns` pass-through [VERIFIED: read api-routes.js:605-633] |
| `fetchTimeline` thunk + `selectTimelineFor` | `performanceSlice.ts:345,881` | Redux data-fetch template | Mirror for `fetchContextTurns` / `selectContextTurnsFor` [VERIFIED: read performanceSlice.ts:345-360] |
| redaction applier (rewired) | `scripts/enhanced-redaction-system.js` | redaction (D-06) | Preserve the `redact(content) -> {content, redactionCount, securityLevel}` interface; load the 27-pattern config [VERIFIED: read enhanced-redaction-system.js full] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Age-based launchd sweep (D-01, locked) | Count-based inline prune at close | Rejected in discuss-phase — inline prune leaves abandoned spans forever |
| Semantic observation ref (D-07, locked) | content hash / full content | Rejected — operator explicitly wants semantic "what is this turn doing" |
| Reuse configured redaction (D-06, locked) | hardcoded key masking | Rejected — "don't reinvent the wheel"; the configured set already keeps LSLs clean |

**Installation:** none — no `npm install`. Proxy edits deploy via `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` (server.mjs is runtime JS, **no `npm run build`** for server.mjs; only `src/*.ts` changes need build). [VERIFIED: 82-CONTEXT specifics + CLAUDE.md]

## Package Legitimacy Audit

**N/A — this phase installs no external packages.** All code is Node stdlib (`zlib`, `fs`, `path`, `crypto`) plus existing in-repo modules verified by direct read this session. slopcheck/registry verification is not applicable. If the planner discovers a need for a new dependency (none anticipated), run the Package Legitimacy Gate before adding it.

## Architecture Patterns

### System Architecture Diagram

```
                          MEASURED SPAN (task_id bound via x-task-id header, Phase 82)
                                              │
    ┌─────────────────────────────────────────┼──────────────────────────────────────────┐
    │  PROXY DAEMON  _work/rapid-llm-proxy/proxy-bridge/server.mjs  (runtime JS, no build) │
    │                                          │                                           │
    │   claude ──► POST /v1/messages ──────────┤                                           │
    │   (Anthropic wire, ~1992)                │                                           │
    │        reqJson, model, taskId, agent,    │        copilot/opencode/mastra            │
    │        toolNames, parseUsageCache,       │   ──► POST /api/complete (~2410)          │
    │        analyzeAnthropicRequest           │        body(messages/tools), result,      │
    │             │                            │        parseOpenAICache,                  │
    │             ▼ after logTokenCall (~2223) │        analyzeOpenAIRequest               │
    │      ┌──────────────────┐                │             │ after logTokenCall (~2766)  │
    │      │ logContextTurn() │◄───────────────┴─────────────┘                             │
    │      │ (NEW, best-effort│                                                            │
    │      │  never-throw)    │  builds ONE line:                                          │
    │      └────────┬─────────┘  { ts, task_id, agent, requestId, model,                   │
    │               │              usage:{input,cache_read,cache_write,output},            │
    │               │              cache_breakpoints:[msgIdx…], categories:[…],            │
    │               │              messages:[{role,bytes,tool?{name,size},preview}],       │
    │               │              observation_ref: null  ← resolved LATER }               │
    │               │            + (if span.meta.capture_raw_bodies) redacted raw body     │
    │               ▼                                                                       │
    │   append plaintext (D-03)                                                            │
    │   .data/measurements/<sanitizeTaskId>/context-turns.jsonl                            │
    │   (+ raw-bodies.jsonl  when flag on, redacted first)                                 │
    └───────────────────────────────────────────┬───────────────────────────────────────┘
                                                 │
                    ┌────────────────────────────┴─────────────────────────────┐
                    │ SPAN CLOSE  coding/scripts/measurement-stop.mjs (~471)     │
                    │  1. correlate each turn → ETM observation                  │
                    │     (time-window + agent + project; obs has NO task_id)    │
                    │  2. gzip context-turns.jsonl → .gz, rm plaintext (D-03)    │
                    │  3. gzip raw-bodies.jsonl → .gz when present               │
                    └────────────────────────────┬─────────────────────────────┘
                                                 │
         ┌───────────────────────┬───────────────┴───────────────┬─────────────────────────┐
         │ launchd sweeper (D-01) │ Proxy /api/context-turns      │ vkb-server pass-through  │
         │ com.coding.context-    │ (gunzip + return array)       │ (mirror handleReconcil-  │
         │ turns-sweeper (age 14d)│                               │  iation, graceful-empty) │
         └───────────────────────┘                               └───────────┬─────────────┘
                                                                              │
                                             dashboard server.js proxy line ──┘
                                                          │
                                          performanceSlice fetchContextTurns thunk
                                                          │
                                        context-cache-explainer.tsx (EXISTING, D-11)
                                        honest sent/cached/fresh; N/A for OpenAI-wire
```

### Pattern 1: Best-effort never-throw write hook (the load-bearing contract)
**What:** Every new write is wrapped `try { … } catch (err) { logErr(…); }` so a failure lands on stderr and never touches request forwarding or span close.
**When to use:** Both proxy write sites, span-close gzip, and the sweeper.
**Example (the exact house pattern already at both sites):**
```javascript
// Source: server.mjs:2224-2226 (VERIFIED this session) — clone this shape for logContextTurn
} catch (err) {
  logErr(`/v1/messages token log failed (non-fatal): ${err?.message || err}`);
}
```

### Pattern 2: Span-close artifact write co-located with reconciliation.json
**What:** measurement-stop.mjs already writes `.data/measurements/<sanitizeTaskId(task_id)>/reconciliation.json` inside a `try/catch + stderr` block (~471-482). The gzip-at-close and observation-enrichment steps slot in beside it, using the **same** `sanitizeTaskId(span.task_id)` + `path.join(REPO_ROOT,'.data','measurements',id)` path build.
**Example:**
```javascript
// Source: measurement-stop.mjs:471-477 (VERIFIED) — the co-location anchor
const reconcileDirId = sanitizeTaskId(span.task_id);
const reconcileDir = path.join(REPO_ROOT, '.data', 'measurements', reconcileDirId);
// NEW beside this: gzip context-turns.jsonl → .gz, rm plaintext; enrich observation_ref
```

### Pattern 3: Thin verbatim read API (D-10)
**What:** vkb `handleReconciliation` reads a file, validates taskId (`_validTaskId`: `[A-Za-z0-9._-]`, ≤80), returns 200 verbatim, ENOENT → 200 graceful-empty, 500 only on unexpected error. Register at `api-routes.js:90`.
**Example:** clone `handleReconciliation` (api-routes.js:605-633) → `handleContextTurns`, but the proxy owns gunzip (the file is `.gz`), so vkb either proxies to `http://…:12435/api/context-turns?task_id=…` OR reads+gunzips the local `.gz`. **Recommendation:** vkb reads the local `.gz` and gunzips (simplest, same-host, matches the reconciliation "read a FILE only" contract). The proxy `/api/context-turns` is the independent surface for same-origin dashboard fetch.

### Pattern 4: launchd sweeper trio (D-01)
**What:** Three files, cloned verbatim from the lsl-lock-sweeper:
- `launchd/com.coding.context-turns-sweeper.plist` (RunAtLoad + StartInterval; suggest 3600s not 60s — age-based, not lock-race) [template: `launchd/com.coding.lsl-lock-sweeper.plist` VERIFIED]
- `scripts/context-turns-sweeper-job.sh` (bash; walk `.data/measurements/*/context-turns.jsonl(.gz)` + `raw-bodies.jsonl.gz`, delete files older than `CONTEXT_TURNS_RETENTION_DAYS` default 14; portable `file_mtime` helper) [template: `scripts/lsl-lock-sweeper-job.sh` VERIFIED]
- `scripts/install-context-turns-sweeper-launchd.sh` (plutil-lint → copy → bootout → bootstrap → verify) [template: `scripts/install-lsl-lock-sweeper-launchd.sh` VERIFIED]

### Anti-Patterns to Avoid
- **Resolving the observation ref in the proxy hot path** — the observation does not exist yet and the store is unreachable. Correlate at span close / read time only.
- **Folding cache_read/cache_write into a total** — violates D-09 and the pure-helper contract in usage-cache.ts.
- **Adding a second redaction implementation** — D-06 mandates one source of truth; make the config-loading applier a shared module both LSL and the raw-body writer import.
- **Calling `resolveLiveTaskId()` at span close** — it is gone at close (project memory `reference_claude_proxy_capture_routes`); scope rows to `span.task_id`.
- **Blocking the request on redaction failure** — fail-closed on the *content* (drop that body), never on the daemon (D-06).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cache split extraction | New usage parser | `parseUsageCache` / `parseOpenAICache` (usage-cache.ts) | Pure, never-throw, handles flat + `cache_creation`-object forms; already flows at both sites |
| Category taxonomy | New per-turn categorizer | `analyzeAnthropicRequest` / `analyzeOpenAIRequest` | D-08 mandates ONE taxonomy; these already emit `categories[]` + `cache_breakpoints` |
| Per-task file path | New path builder | `perRunBreakdownPath` / `safeSanitizeTaskId` | Same per-task isolation + traversal guard as reconciliation.json |
| Retention sweeper | New scheduler | Clone `com.coding.lsl-lock-sweeper` trio | Proven install/plist/job convention with portable mtime + graceful skip |
| gzip helpers | New compression code | `node:zlib` via lsl-file-manager.js helpers | Already used for LSL rotation/compression |
| Read API | New endpoint framework | Clone `handleReconciliation` | Verbatim-serve + graceful-ENOENT + `_validTaskId` traversal guard |
| Redaction | New regex set | Load `.specstory/config/redaction-patterns.json` (27 patterns) | The configured set already covers Anthropic/sk-/XAI/AWS keys, Bearer, JWT, env-var secrets, PII |
| Observation correlation | New join engine | The `fetchRunNarrative` time-window+agent join | The exact best-effort correlation already exists and is battle-tested |

**Key insight:** This phase is ~90% wiring of verified existing parts. The only genuinely new logic is (a) the one-line assembly + append, (b) the redaction config loader rewire, and (c) the observation-correlation-at-close step.

## Research Hand-off #1 — turn → ETM observation correlation (D-07/D-08) — RESOLVED

**Where observations live and how they are keyed:**
- Store: `observations.db` (SQLite), owned by the host Observations API (obs-api) on **:12436**; dashboard proxies via `handleGetObservations` → `http://host.docker.internal:12436` [VERIFIED: server.js:350, MEMORY obs-api routing]. Exported snapshots at `.data/observation-export/{observations,digests,insights,metadata}.json`.
- **Observation record keys (VERIFIED this session):** `["id","summary","agent","project","quality","createdAt","digestedAt","llm","modifiedFiles"]`. **There is NO `task_id`, NO `request_id`, NO `tool_call_id`, NO prompt-set id on the exported record.** Timestamp = `createdAt` (ISO). `summary` is the Intent/Approach/Artifacts/Result prose.
- **Digest record keys (VERIFIED):** `id`, `date`, `theme`, `summary`, and `observationIds` (a digest references the observations it consolidates).
- Current export counts: 6297 observations, 2097 digests [VERIFIED: metadata.json].

**Identifiers available at each side:**
- **Proxy request side (at write time):** `task_id` (sanitized), `agent`, `requestId` (Anthropic `request-id` header) / `shim-<uuid>` (OpenAI shim), ISO timestamp, `model`, `process`.
- **Observation side (at read time, async):** `id`, `agent`, `project`, `createdAt`, `quality`, `modifiedFiles`. **No id shared with the proxy request.**

**The realistic correlation join (authoritative — this is the existing production pattern):**
The dashboard already solves exactly this in `fetchRunNarrative` (performanceSlice.ts:366): *"Observations have no task_id, so the join is by [from,to] window + agent (best-effort). The caller computes the window from the run (started/ended or timeline min/max)."* It calls `GET /api/observations?from=&to=&agent=&limit=200`. [VERIFIED: read performanceSlice.ts:362-400]

Therefore the D-07 rule:
1. **Granularity achievable:** coarse. Observations are per-prompt-set (keyed by time + agent + project), so **many context-turns map to ONE observation** — the observation whose `createdAt` falls nearest to (or whose prompt-set window contains) the turn's timestamp, filtered by matching `agent` (and `project` when available). This is a *reference/annotation*, not a hard 1:1 join, exactly as CONTEXT states.
2. **When does it run:** **at span close (measurement-stop.mjs) or at read time — NOT in the proxy hot path.** Rationale (HIGH confidence): observations do not exist at request time (ETM writes them asynchronously after the prompt-set completes) and the proxy cannot reach obs-api's SQLite (single-owner store boundary). CONTEXT confirms: "the store is queried at span close by task_id + timestamp window."
3. **Fallback when task_id absent / no observation correlates:** the **~120-char preview is always written by the proxy at request time** because the raw message content is in scope there regardless of correlation success. This guarantees "always something rather than nothing" (D-07). `observation_ref` is simply left `null` in the line and populated later if a match is found.
4. **Foreground vs background attribution nuance:** turns whose `task_id=''` (neutral/interactive tap rows, per Phase-82 D-08) will have no measured span to correlate against — the preview fallback covers them. Do not attempt ambient task_id inheritance (that is the leak Phase 82/83 closed).

**Recommended implementation:** proxy writes `observation_ref: null` + `preview` + `ts` + `agent` always; at span close, read the span window (`span.started_at`..`span.ended_at`), fetch observations for that window+agent (via obs-api :12436 or the exported JSON), and for each turn set `observation_ref = {id, theme|intentSnippet}` of the nearest-by-`createdAt` observation. Best-effort — a correlation failure leaves `observation_ref: null` and the preview stands.

## Research Hand-off #2 — redaction applier rewire (D-05/D-06) — RESOLVED

**Current interface (VERIFIED — full file read this session):**
- `scripts/enhanced-redaction-system.js` is a CommonJS module exporting one class with the method `redact(content, options) -> { content, redactionCount, securityLevel }` plus `getStats()` / `resetStats()`.
- It applies **only 4 hardcoded regexes** (email, creditCard, ssn, phone) built inline in `redact()` — it never reads any config file.
- On redaction error it returns `{ content: '[REDACTION_ERROR_CONTENT_BLOCKED]', redactionCount: 1, securityLevel: 'MAXIMUM' }` — **fail-closed on content**, exactly the D-06 contract.
- **Caller (VERIFIED):** `scripts/lsl-file-manager.js:14,31,125` constructs the applier then calls `.redact(value, {...})`, consuming `result.content`, `result.redactionCount`, `result.securityLevel` (and optionally `result.redactionLog` at line 133, currently never produced). **The rewire MUST preserve this return shape** or it breaks the LSL path.

**Shape of redaction-patterns.json (VERIFIED — 27 patterns, all enabled):**
Each pattern object has fields: `id`, `name`, `description`, `pattern` (string regex), `flags` (e.g. `"gi"`), `replacementType`, `replacement` (supports `$1`-style capture-group refs, e.g. `"$1=<SECRET_REDACTED>"`), `enabled`, `severity`. Top-level: `version`, `description`, `enabled` (global flag), `patterns[]`. Schema at `.specstory/config/redaction-schema.json` (draft-07). Categories include: `env_vars` (giant KEY=value alternation), `json_api_keys`, `sk_ant_admin_keys`, `sk_ant_keys`, `sk_keys`, plus XAI/Groq/AWS/Bearer/JWT/Authorization/PII (the remaining patterns).

**How to load + compile without breaking callers:**
```javascript
// Compile once at construction; new RegExp(p.pattern, p.flags) for each enabled pattern.
// Apply in order; replacement string passes through to String.replace (honors $1..$n).
const cfg = JSON.parse(fs.readFileSync('.specstory/config/redaction-patterns.json','utf8'));
this.patterns = (cfg.enabled === false ? [] : cfg.patterns)
  .filter(p => p.enabled)
  .map(p => ({ id: p.id, re: new RegExp(p.pattern, p.flags), replacement: p.replacement }));
// redact(content): for each {re, replacement} → content = content.replace(re, replacement)
// keep the SAME return shape { content, redactionCount, securityLevel } + fail-closed catch
```
Guard the compile step (a bad regex in config must not crash the daemon — skip that pattern, log to stderr). Optionally keep the 4 hardcoded PII regexes as an appended safety net so the rewire is strictly additive (no regression risk to LSL).

**One source of truth (D-06 recommendation):** the config-loading applier should be a **shared module** both `lsl-file-manager.js` and the new raw-body writer import. Since the raw-body writer lives at the proxy (a *different repo*, `_work/rapid-llm-proxy`), and the redaction module + config live in `coding`, the cleanest split is:
- **Redact at the proxy write site** using a small self-contained applier that reads `<CODING_ROOT>/.specstory/config/redaction-patterns.json` at proxy startup (the proxy already resolves `CODING_ROOT` — see `CTX_BREAKDOWN_DIR` at server.mjs:1591). This avoids a cross-repo runtime import while keeping ONE config file as the source of truth.
- Refactor the coding-side applier to export the config-loading logic (a `loadRedactionPatterns(configPath)` helper) so both the LSL applier and the proxy applier consume the identical compiled pattern list from the identical config path. **The config JSON is the single source of truth; the compile helper is shared code.**

⚠ CLAUDE.md `no-console-log`: the current file uses `console.error`/`console.log` (pre-existing, in the `require.main === module` CLI-test block). If the planner touches those lines, replace with `process.stderr.write` per the constraint — but do not *dodge* the constraint, fix legitimately (MEMORY). Leaving the CLI-test block untouched is safest.

## Additional Investigation Findings (A–F)

### A. Proxy write-hook site
- `/v1/messages` tap: handler at `server.mjs:1992`; `logTokenCall` at **~2201**; the natural `logContextTurn` site is **immediately after, ~2223** (inside the same `if (_tokenDb && isCompletion && sawUsage)` block or a sibling best-effort block). In scope: `reqJson` (full request body), `model`, `taskId`, `agent`, `proc`, `requestId`, `uIn/uOut`, `cacheRead/cacheWrite`, `toolNames`, and `analyzeAnthropicRequest(reqJson)` (already computed for the snapshot at ~2069). [VERIFIED: read server.mjs:1990-2229]
- `/api/complete` pipeline: `logTokenCall` at **~2676**; the site is **~2766** (right after the `if (_tokenDb) logTokenCall(...)` block, before the `_shimOpenAI` envelope wrap at 2772). In scope: `body` (= internalBody, carries `messages`/`tools`/`agent`/`task_id`/`tool_call_id`), `result` (`.content`, `.tokens` with `cache_read_tokens`/`cache_write_tokens`), `providerName`, `latencyMs`. **Note:** the ORIGINAL `oaBody` (with the raw OpenAI messages/tools) is only in scope inside the shim block (~2300-2408); at the logTokenCall site use `body.messages`/`body.tools` (internalBody carries them through). For `analyzeOpenAIRequest`, it is computed in the shim block at ~2344 — if the plan needs the category snapshot at the write site, either recompute from `body` or stash it on `req._ctxSnapshot` in the shim block. [VERIFIED: read server.mjs:2300-2408, 2620-2780]
- `perRunBreakdownPath` (server.mjs:1599) is the taxonomy source of truth for D-08; the breakdown files are already written per-run at ~2080 (/v1/messages) and ~2348 (/api/complete). The context-turns line should carry the SAME `categories[]` shape.

### B. Cache token parsing (Phase 82 fields already present)
- Claude wire: `parseUsageCache` returns `{cacheRead, cacheWrite}` from `cache_read_input_tokens` + `cache_creation_input_tokens` (flat) or summed `cache_creation` object. Logged as `cache_read_tokens`/`cache_write_tokens` at server.mjs:2211-2212. [VERIFIED]
- OpenAI wire: `parseOpenAICache` returns `{cache_read_tokens, cache_write_tokens: 0}` — **`cache_write_tokens` is ALWAYS 0 by design** ("OpenAI has no cache-creation/write counter" — usage-cache.ts:98). This is the wire fact behind D-11/D-12: the explainer must render **N/A**, not 0, for OpenAI-wire cache-write. The turn line must distinguish "genuinely 0" (claude, no cache write this turn) from "provider reports none" (OpenAI-wire) — recommend a per-line `wire: 'anthropic' | 'openai'` field so the explainer can branch. [VERIFIED: usage-cache.ts:88-100, server.mjs:2693]

### C. Span close + gzip + retention
- `measurement-stop.mjs:471-477` writes `reconciliation.json` under `.data/measurements/<sanitizeTaskId(span.task_id)>/` inside best-effort try/catch. The gzip-at-close + observation-enrichment slots in here. [VERIFIED]
- `captureForegroundTokens` reconcile-mode dispatch is at `lib/lsl/token/stop-adapter-registry.mjs` (invoked at measurement-stop.mjs:421). [VERIFIED: 83-CONTEXT + measurement-stop read]
- Launchd sweeper convention (all three files VERIFIED): `launchd/com.coding.lsl-lock-sweeper.plist` (RunAtLoad + StartInterval=60 + ThrottleInterval=30 + StandardErr/OutPath to `.data/*.log` + PATH env), `scripts/lsl-lock-sweeper-job.sh` (portable `file_mtime` BSD/GNU dual-form, age gate, best-effort), `scripts/install-lsl-lock-sweeper-launchd.sh` (plutil-lint → copy-with-backup → bootout → bootstrap → `launchctl list | grep` verify). Clone all three; for retention use StartInterval **3600** (hourly is ample for a 14-day age policy) and walk `.data/measurements/*/`.

### D. vkb-server read API
- `handleReconciliation` at `api-routes.js:605`, registered at `:90` (`app.get('/api/experiments/runs/:taskId/reconciliation', …)`). Reads `<dataDir>/measurements/<taskId>/reconciliation.json`, `_validTaskId` guard (`[A-Za-z0-9._-]`, ≤80), verbatim JSON, ENOENT→200 graceful-empty, 500 only unexpected. [VERIFIED]
- Route naming for context-turns: recommend `GET /api/experiments/runs/:taskId/context-turns` (parallel to reconciliation) in vkb, reading + gunzipping the local `.gz`. The proxy's own `/api/context-turns?task_id=` is the same-origin surface the dashboard fetches.
- Dashboard backend proxy: `server.js:294` proxies `/api/context-breakdown` → `http://host.docker.internal:12435/api/context-breakdown`; `server.js:307` proxies `/api/token-usage/:endpoint` → :12435; experiment routes proxy to vkb :8080. Add a mirror line: `/api/context-turns` → :12435 (proxy surface) OR `/api/experiments/runs/:taskId/context-turns` → vkb :8080. **Note the VirtioFS bind-mount caveat (CLAUDE.md):** server.js edits need a full `docker-compose restart coding-services`, not a supervisor-only restart. [VERIFIED: server.js:290-318]

### E. Cache-explainer UI
- `context-cache-explainer.tsx` (642 lines) already: reads `selectTimelineFor(taskId)` + `fetchTimeline` (lines 294,303), `summarize(timeline)` flattens per-turn `cache_read_tokens`/`cache_write_tokens` (lines 117-127), renders a context-window anatomy band, and has explicit "estimate" copy at line 526 ("token figures are a ~bytes/4 estimate"). [VERIFIED: grep + reads]
- D-11 seam: add `fetchContextTurns(taskId)` thunk + `selectContextTurnsFor(taskId)` selector to `performanceSlice.ts` mirroring `fetchTimeline` (345-360) / `selectTimelineFor` (881); dispatch it alongside `fetchTimeline` in the explainer's effect (line 303); feed the honest per-turn sent/cached/fresh from context-turns (real wire values) and correct the ~bytes/4 estimate copy where real token counts now exist.
- Honest N/A path (D-12): where the explainer renders cache-write for a turn, branch on the line's wire/agent — OpenAI-wire (copilot/opencode) → render `"N/A (provider reports no cache-creation)"`; Anthropic-wire → the real number. Add the "how prompt caching actually works" copy explaining the Anthropic-vs-OpenAI counter asymmetry.
- Frontend deploy: `system-health-dashboard` is bind-mounted; `npm run build` in the submodule then `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend` (frontend bundle) — no docker-compose build (CLAUDE.md).

### F. Never-throw + ambient-leak contracts
- Both proxy write sites already stamp `task_id` correctly (D-08/WR-01): `/v1/messages` uses the header-bound `taskId` or `''` (never ambient inheritance, server.mjs:2037-2046); `/api/complete` uses `body.task_id` or background-gated `resolveLiveTaskId()` (server.mjs:2763-2765). The new `logContextTurn` MUST reuse the SAME already-resolved `taskId`/`agent` variables in scope — do NOT re-resolve, do NOT call `resolveLiveTaskId()` afresh. [VERIFIED]
- At span close, scope to `span.task_id` (`resolveLiveTaskId` is gone at close — MEMORY `reference_claude_proxy_capture_routes`). [VERIFIED via memory + measurement-stop pattern]
- Every new write wrapped best-effort → stderr (Pattern 1).

## Runtime State Inventory

> This phase adds new persisted files + a new OS-registered launchd job, so an inventory of new runtime state to register is warranted.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (new) | `.data/measurements/<task_id>/context-turns.jsonl(.gz)` and `raw-bodies.jsonl.gz` (new per-span artifacts) | New writes; retention sweeper reclaims by age (D-01). No migration of existing data. |
| Live service config | Proxy daemon (`com.coding.llm-cli-proxy`) gains new write behavior — server.mjs is runtime JS, redeploy via `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` (NO build for server.mjs) | Kickstart proxy after edit; confirm coordinator :3034 location=open first (MEMORY `reference_llm_proxy_override_fallback`) |
| OS-registered state (NEW) | New launchd job `com.coding.context-turns-sweeper` must be **registered** via `scripts/install-context-turns-sweeper-launchd.sh` (bootstrap into `gui/$(id -u)`) | Plan MUST include an install-script run task; a plist in `launchd/` alone does not register the job |
| Secrets/env vars | New config keys: retention window (`.planning/config.json` or env, default 14d, D-02) + raw-body flag (`capture_raw_bodies` on experiment YAML / span.meta, D-05). No secret keys renamed. | Add config surface + document defaults; flag rides on `span.meta` (read at proxy via `getActiveMeasurement()`, precedent `meta.record`) |
| Build artifacts | `system-health-dashboard` frontend bundle (`npm run build`) after explainer edit; the redaction applier is CommonJS (no build). Proxy `src/*.ts` untouched (server.mjs only) → **no proxy `npm run build`** | Rebuild dashboard frontend + restart frontend supervisor after UI edit (VirtioFS caveat) |

**Nothing found in category "data migration":** None — all context-turns files are net-new; no existing store keys the new artifact. Verified by inspection of the co-location dir (`.data/measurements/<task_id>/` currently holds only reconciliation.json).

## Common Pitfalls

### Pitfall 1: Trying to correlate observations in the proxy hot path
**What goes wrong:** No observation exists at request time; the proxy can't reach obs-api's SQLite → correlation always returns null and adds latency.
**Why it happens:** ETM writes observations asynchronously after the prompt-set; the store is single-owner.
**How to avoid:** Proxy writes preview + `observation_ref: null` always; correlate at span close/read time (hand-off #1).
**Warning signs:** `logContextTurn` importing an obs-api client or reading observations.db.

### Pitfall 2: OpenAI-wire cache-write rendered as 0 instead of N/A
**What goes wrong:** `parseOpenAICache` returns `cache_write_tokens: 0` by design; a naive explainer shows "0 cache write" which reads as "caching failed" — dishonest (D-12).
**How to avoid:** Carry a `wire` discriminator per line; render N/A for OpenAI-wire.
**Warning signs:** copilot/opencode turns showing `write: 0` in the chart with no N/A label.

### Pitfall 3: Redaction rewire breaks the LSL caller
**What goes wrong:** Changing `redact()`'s return shape breaks `lsl-file-manager.js` which reads `result.content`/`redactionCount`/`securityLevel`.
**How to avoid:** Preserve the exact return shape; make the change additive (append config patterns, keep the fail-closed catch).
**Warning signs:** LSL files suddenly unredacted or `[REDACTION_ERROR_CONTENT_BLOCKED]` everywhere.

### Pitfall 4: launchd job written but never bootstrapped
**What goes wrong:** A plist in `launchd/` does nothing until `launchctl bootstrap` runs. Retention silently never fires.
**How to avoid:** Include an explicit install-script task; verify with `launchctl list | grep com.coding.context-turns-sweeper`.

### Pitfall 5: server.js edit not picked up (VirtioFS cache)
**What goes wrong:** Dashboard backend proxy line edited but a supervisor-only restart re-reads the STALE cached file → truncated-file `SyntaxError` or old behavior.
**How to avoid:** Full `cd docker && docker-compose restart coding-services` after any server.js edit (CLAUDE.md).

### Pitfall 6: Proxy redeploy mis-detects corporate network
**What goes wrong:** `launchctl kickstart` of the proxy can flip provider routing to corporate mode.
**How to avoid:** Confirm coordinator :3034 `location=open` BEFORE kickstart (MEMORY `reference_llm_proxy_override_fallback`).

## Code Examples

### logContextTurn line shape (illustrative — field names are Claude's Discretion per D-03)
```javascript
// Source: assembled from VERIFIED in-scope vars at server.mjs:2198-2223 (/v1/messages)
// Best-effort; never throws into the request path.
function logContextTurn(dir, line) {
  try {
    fs.mkdir(dir, { recursive: true }, () => {
      fs.appendFile(path.join(dir, 'context-turns.jsonl'), JSON.stringify(line) + '\n', () => {});
    });
  } catch (err) { logErr(`context-turn write failed (non-fatal): ${err?.message || err}`); }
}
// line example (anthropic wire):
// { ts, task_id: taskId, agent, wire:'anthropic', request_id: requestId, model,
//   usage: { input: uIn, output: uOut, cache_read: cacheRead, cache_write: cacheWrite },
//   cache_breakpoints: [ /* message indices carrying cache_control */ ],
//   categories: analyzeAnthropicRequest(reqJson).categories,   // D-08 reuse
//   messages: reqJson.messages.map((m,i) => ({ i, role: m.role, bytes: enc(m),
//              tool: toolMeta(m) /* {name,size} for tool_use/tool_result */,
//              preview: shortPreview(m, 120) })),               // D-07 fallback
//   observation_ref: null }                                     // enriched at close
```

### Redaction config loader (rewire core)
```javascript
// Source: VERIFIED field shape from .specstory/config/redaction-patterns.json (27 patterns)
function loadRedactionPatterns(configPath) {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (cfg.enabled === false) return [];
  return cfg.patterns.filter(p => p.enabled).map(p => {
    try { return { id: p.id, re: new RegExp(p.pattern, p.flags), replacement: p.replacement }; }
    catch (e) { process.stderr.write(`[redaction] bad pattern ${p.id}: ${e.message}\n`); return null; }
  }).filter(Boolean);
}
// redact(content): compiled.forEach(({re, replacement}) => content = content.replace(re, replacement));
// preserve { content, redactionCount, securityLevel } return + fail-closed catch
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cache accounting "corrupted by proxy" belief | Wire genuinely carries cache usage; tap now parses it | Phase 82 | Phase 84 inherits real cache split, no new parsing |
| First-writer-wins dedup shadows richer rows | UPDATE-in-place on cache-bearing incoming rows | Phase 82 | Turn lines can trust the logged cache split |
| Redaction = 4 hardcoded PII regexes | 27-pattern configured set (this phase rewires the applier) | Phase 84 (this) | Raw bodies get full credential+PII coverage |
| Observations joined by task_id (assumed) | Observations have NO task_id; join by time-window+agent | verified Phase 84 | Correlation is a best-effort reference, resolved at close |

**Deprecated/outdated:**
- The 4-regex behavior of the current redaction applier — superseded by the config-loading rewire (D-06).

## Validation Architecture

> `workflow.nyquist_validation` is ABSENT from `.planning/config.json` → treated as ENABLED. `workflow.verifier: true` and `plan_check: true` are set.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node --test` (node stdlib test runner) — the Phase-82/83 house style (`token-usage.test.ts` in proxy `src/`; coding-side `tests/` node --test) |
| Config file | none — node --test discovers `*.test.mjs` / `*.test.js`; proxy uses `src/*.test.ts` |
| Quick run command | `node --test tests/context-turns/*.test.mjs` (per-module) |
| Full suite command | project test runner (node --test recursive) + LIVE golden-comparison run (Phase-82/83 house style: real 1-2 cell experiment span) |

### Phase Requirements → Test Map
| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|-------------------|-------------|
| logContextTurn writes one valid JSONL line per request | unit | `node --test tests/context-turns/write-line.test.mjs` | ❌ Wave 0 |
| Cache split carried separately (input/read/write/output), never folded | unit | `node --test tests/context-turns/cache-split.test.mjs` | ❌ Wave 0 |
| OpenAI-wire line marks cache_write as provider-none (N/A discriminator) | unit | `node --test tests/context-turns/openai-wire.test.mjs` | ❌ Wave 0 |
| Preview fallback always present (~120 char cap) + tool name/size captured | unit | `node --test tests/context-turns/digest.test.mjs` | ❌ Wave 0 |
| Redaction applier loads all 27 patterns; masks sk-/Bearer/JWT/env-var; preserves return shape; fail-closed | unit | `node --test tests/redaction/config-load.test.mjs` | ❌ Wave 0 |
| gzip-at-close produces `.gz`, removes plaintext; crash leaves readable `.jsonl` | unit | `node --test tests/context-turns/close-gzip.test.mjs` | ❌ Wave 0 |
| Age sweeper deletes >retention, keeps ≤retention; never-throw on bad dir | unit | `node --test tests/context-turns/sweeper.test.mjs` (drive `context-turns-sweeper-job.sh` via env `CONTEXT_TURNS_RETENTION_DAYS`) | ❌ Wave 0 |
| Read API: verbatim gunzip, ENOENT→graceful-empty, traversal rejected | unit | `node --test tests/vkb/context-turns-route.test.mjs` | ❌ Wave 0 |
| Observation correlation: nearest-by-createdAt within span window+agent; null when none | unit | `node --test tests/context-turns/correlate.test.mjs` (fixture observations) | ❌ Wave 0 |
| Explainer renders honest sent/cached/fresh + N/A for OpenAI-wire | e2e (gsd-browser) | `gsd-browser` screenshot of Performance tab at :3032 (CLAUDE.md: visual verify, never DB-only) | ❌ Wave 0 |
| End-to-end: measured span produces a context-turns.jsonl.gz readable via the API | live golden | manual measured 1-cell run + `curl :12435/api/context-turns?task_id=…` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant `node --test tests/<module>/*.test.mjs`
- **Per wave merge:** full `node --test` recursive + redaction + sweeper suites
- **Phase gate:** full suite green + one LIVE measured span producing a real `.gz` + a gsd-browser screenshot of the honest explainer (feedback: never claim UI works from DB queries alone)

### Wave 0 Gaps
- [ ] `tests/context-turns/` suite (all unit files above) — none exist yet
- [ ] `tests/redaction/config-load.test.mjs` — redaction rewire coverage
- [ ] Fixture: a recorded Anthropic `/v1/messages` request body + an OpenAI `/api/complete` body (for offline write-line + taxonomy tests)
- [ ] Fixture: a small observations JSON slice (for correlation tests)
- [ ] Sweeper shell test harness (env-driven `CONTEXT_TURNS_RETENTION_DAYS` + temp `.data/measurements/`)

## Security Domain

> `security_enforcement` not explicitly false → included. Redaction of raw bodies is the primary security surface.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | phase adds no auth surface |
| V3 Session Management | no | — |
| V4 Access Control | yes (light) | read APIs are local/same-origin; `_validTaskId` traversal guard on the read route (path stays under `.data/measurements/`) |
| V5 Input Validation | yes | `safeSanitizeTaskId` on the untrusted `x-task-id` header (already enforced); `_validTaskId` on the read route; regex-compile guard on config patterns |
| V6 Cryptography / Secrets | **yes (primary)** | Raw-body capture MUST redact via the 27-pattern configured set BEFORE write (D-06); fail-closed on the content when redaction errors; default OFF (D-05) |
| V7 Error handling / logging | yes | best-effort never-throw; redaction errors → stderr + content blocked, never the daemon |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leakage into raw-bodies.jsonl (API keys, Bearer, JWT) | Information Disclosure | 27-pattern redaction applied pre-write; fail-closed content block on redaction error; capture default OFF |
| Path traversal via `x-task-id` / `:taskId` | Tampering | `safeSanitizeTaskId` (proxy) + `_validTaskId` (vkb) — both already enforced, reuse |
| Malformed request body crashes the tap | DoS (Tampering) | pure never-throw parsers + best-effort write wrap |
| Raw body persisted for a non-consenting span | Information Disclosure | per-experiment flag default OFF; sibling file so retention drops raw bodies independently |
| Bad regex in redaction config crashes daemon | DoS | compile-guard each pattern, skip + stderr on error |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `span.meta.capture_raw_bodies` is the right vehicle for the D-05 flag (mirrors `meta.record`/`meta.replay_from`, read via `getActiveMeasurement()`) | D-05 / A | Low — the meta+getActiveMeasurement precedent is verified; the exact key name is Claude's Discretion anyway |
| A2 | Observation correlation runs best at span close (not read time) | Hand-off #1 | Low — both valid; CONTEXT says "queried at span close"; read-time is a fallback if close-time proves too slow |
| A3 | vkb read route should gunzip the local `.gz` (vs proxying to :12435) | D / D-10 | Low — either works; local-file read matches the reconciliation "read a FILE only" contract |
| A4 | node --test is the test framework (no explicit config file found this session) | Validation | Low — matches Phase 82/83 house style; planner should confirm the exact runner invocation in Wave 0 |
| A5 | Retention config lives in `.planning/config.json` under a new key (D-02 says "or an env var") | D-02 | Low — Claude's Discretion; env var (`CONTEXT_TURNS_RETENTION_DAYS`) is the simplest for the bash sweeper |
| A6 | `/api/complete` write site should use `body.messages`/`body.tools` (internalBody) since `oaBody` is out of scope there | A | Low — verified internalBody carries messages+tools; alternatively stash `req._ctxSnapshot` in the shim block |

## Open Questions

1. **Where exactly does the observation correlation run — span close vs read time?**
   - What we know: obs have no task_id, joined by time+agent (fetchRunNarrative pattern); CONTEXT says "queried at span close."
   - What's unclear: whether close-time obs-api reachability is reliable (obs-api can be mid-restart on SIGTERM per MEMORY). Read-time correlation in the vkb pass-through is a robust fallback.
   - Recommendation: implement close-time enrichment best-effort; if `observation_ref` is null at read time, the vkb route MAY re-attempt correlation. Either way the preview never fails.

2. **Should the proxy compute cache-breakpoint message indices, or derive from `analyzeAnthropicRequest`?**
   - What we know: `analyzeAnthropicRequest` already detects `cache_control` per block and counts `cache_breakpoints` (server.mjs:1674,1748) but returns a COUNT, not indices.
   - Recommendation: extend the analyzer (or a small sibling) to also emit the message indices carrying `cache_control` — a few lines, same traversal. OpenAI-wire has no cache_control → indices `[]`.

3. **Retention units — per-file age or per-span-dir age?**
   - Recommendation: per-file mtime (matches the sweeper's `file_mtime` helper); delete `context-turns.jsonl(.gz)` and `raw-bodies.jsonl.gz` older than N days independently, so a raw-body file can be dropped while a digest survives (D-05 intent).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (proxy + coding) | all code | ✓ (project runs on it) | project-pinned | — |
| `node:zlib` / `fs` / `crypto` | gzip, append, redaction | ✓ (stdlib) | — | — |
| launchd (macOS) | retention sweeper (D-01) | ✓ (darwin, other com.coding.* jobs registered) | — | — |
| llm-cli-proxy daemon (:12435) | write hook + read API | ✓ (`com.coding.llm-cli-proxy` launchd) | — | — |
| obs-api (:12436) | observation correlation | ✓ (`com.coding.obs-api`) — but can be mid-restart | — | Exported `.data/observation-export/*.json` snapshots; else `observation_ref: null` + preview |
| Docker (dashboard container) | explainer + backend proxy | ✓ (coding-services) | — | — |
| gsd-browser | UI visual verify | ✓ (CLAUDE.md mandated) | — | playwright-cli |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** obs-api at correlation time → fall back to exported JSON snapshot or null ref (preview always covers it).

## Sources

### Primary (HIGH confidence — read directly this session)
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — write sites (1992, 2201, 2223 / 2410, 2676, 2766), taxonomy (1659-1827), `perRunBreakdownPath`/`safeSanitizeTaskId` (1591-1612), context-breakdown route (1880), task-binding/never-throw (2037-2046, 2763-2765)
- `_work/rapid-llm-proxy/src/usage-cache.ts` — `parseUsageCache` / `parseOpenAICache` (cache-write always 0 for OpenAI)
- `coding/scripts/measurement-stop.mjs` — span-close + reconciliation.json write (400-483)
- `coding/scripts/enhanced-redaction-system.js` — current 4-regex applier + return shape (full read)
- `coding/scripts/lsl-file-manager.js` — redaction caller interface (12, 31, 125-164)
- `coding/.specstory/config/redaction-patterns.json` + schema — 27 patterns, field shape (verified via node)
- `coding/lib/vkb-server/api-routes.js` — `handleReconciliation` + registration (90, 605-633)
- `coding/scripts/{install-,}lsl-lock-sweeper*.sh` + `launchd/com.coding.lsl-lock-sweeper.plist` — sweeper trio convention
- `coding/integrations/system-health-dashboard/server.js` — proxy lines (294, 307, 350), VirtioFS caveat
- `coding/integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — `fetchTimeline` (345), `fetchRunNarrative` correlation (362-400), `selectTimelineFor` (881)
- `coding/integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx` — existing explainer + estimate copy (117-127, 294-303, 526)
- `.data/observation-export/{observations,digests,metadata}.json` — observation record keys (no task_id; createdAt), digest observationIds, counts

### Secondary (from CONTEXT/prior phases, MEDIUM-HIGH)
- `84-CONTEXT.md`, `83-CONTEXT.md`, `82-CONTEXT.md` — locked decisions and inherited contracts
- Project MEMORY: `reference_llm_proxy_override_fallback`, `reference_claude_proxy_capture_routes`, obs-api routing, VirtioFS build caveats

## Metadata

**Confidence breakdown:**
- Write-hook sites + in-scope variables: HIGH — read the exact handlers this session
- Cache parsing + OpenAI-wire N/A fact: HIGH — read usage-cache.ts + logCall bindings
- Observation correlation rule: HIGH — verified observation keys (no task_id) + the existing fetchRunNarrative join is the authoritative pattern
- Redaction rewire: HIGH — full applier + config field shape read, caller interface confirmed
- Sweeper/read-API/UI wiring: HIGH — all templates read directly
- Exact test-runner invocation: MEDIUM — inferred from house style (A4)

**Research date:** 2026-07-07
**Valid until:** 2026-08-06 (stable in-repo surfaces; re-verify server.mjs line anchors if the proxy is edited by Phase 82/83 follow-ups before planning)
