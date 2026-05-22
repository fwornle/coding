---
phase: 40-ingest-pipeline-layered-dedup
plan: 10
subsystem: llm-semantic-matcher-gap-closure
tags: [dedup, llm-semantic-matcher, gap-closure, CR-03, WR-08, contract-a, parse-error, DEDUP-01]

# Dependency graph
requires:
  - phase: 40-ingest-pipeline-layered-dedup/04
    provides: LLMSemanticMatcher — the defect site for CR-03 + WR-08.
  - phase: 40-ingest-pipeline-layered-dedup/09
    provides: post-CR-02 LLMSemanticMatcher.ts state (self-id filter removed) — the file shape this plan amends.

provides:
  - "src/dedup/LLMSemanticMatcher.ts (amended) — exports new LLMDedupParseError class; rewrites parseDedupResponse as candidate-list-of-tries returning a discriminated ParseDedupResult; match() applies the Contract A parsedTriedJson heuristic and throws typed LLMDedupParseError on parse failure with `{` present in the response; outer catch branch discriminates parse-vs-other errors for the stderr prefix."
  - "tests/unit/llm-matcher.test.ts (amended) — 4 new tests pinning CR-03 typed-error + stderr-warn-on-attempted-JSON + WR-08 fence-then-bail rescue + prose-only silent no-match."
  - "dist/dedup/LLMSemanticMatcher.{js,d.ts} — regenerated; LLMDedupParseError is part of the exported public surface."

affects:
  - 40-VERIFICATION.md gap #3 (CR-03) — CLOSED.
  - 40-REVIEW.md BLOCKER finding CR-03 — RESOLVED.
  - 40-REVIEW.md warning WR-08 — RESOLVED (bundled fix; the candidate-list rewrite is the recipe REVIEW.md offset 311-340 prescribed).
  - Phase 41/42/43 consumers — onError:'throw' callers can now `instanceof LLMDedupParseError` to discriminate parse failures from network/timeout/client errors; onError:'skip' callers see a clearer "parse error" stderr prefix with the raw response excerpt.

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated-union ParseResult ({ ok: true, value } | { ok: false, error }) replaces the original plan's canonicalEmptyResponse helper. The discriminated union directly tracks whether ANY unwrap candidate parsed cleanly; match() then surfaces a typed LLMDedupParseError only when the raw response contained `{` AND no candidate parsed. This sidesteps a subtle bug in the plan's prescribed canonicalEmptyResponse regex which would incorrectly classify the pre-existing unanchored-fence-with-prose test (raw = 'Sure, here is the JSON:\\n```json\\n{\"matches\":[]}\\n```\\nLet me know...') as a parse error — the unwrap actually SUCCEEDS via the Stage 2 unanchored-fence path, but the canonicalEmptyResponse regex anchored on `^...$` rejects the prose-wrapped form."
    - "Candidate-list-of-tries unwrap (WR-08 recipe — REVIEW.md offset 311-340) — each unwrap stage CONTRIBUTES a string into a list; the function iterates JSON.parse over the list. First successful parse wins; the pre-rewrite first-stage-match-wins mutation chain that starved downstream stages when an earlier stage matched but emitted garbage is GONE."
    - "Typed-error class with Node 16+ `Error.cause` constructor support — `super(message, { cause })` chains the underlying SyntaxError into the error, accessible at `err.cause`. The class also carries a separate `raw` field (first 1000 chars) for diagnostic logging."

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts (+128/-32 lines — LLMDedupParseError class + ParseDedupResult discriminated union + rewritten parseDedupResponse + match() Contract A wiring + catch branch discrimination)
    - /Users/Q284340/Agentic/km-core/tests/unit/llm-matcher.test.ts (+86 lines — 4 appended tests pinning CR-03 + WR-08 contracts)

key-decisions:
  - "Replaced the plan's prescribed `canonicalEmptyResponse(raw): boolean` helper with a discriminated-union ParseDedupResult ({ ok: true, value } | { ok: false, error }) returned by parseDedupResponse. This is a CLEANER expression of Contract A and avoids a latent bug in the plan's regex (which would have emitted spurious 'parse error' stderr noise for the pre-existing unanchored-fence-with-prose test). Documented under Deviations."
  - "Auth/network/timeout errors thrown by the LLM client itself are NOT wrapped — they propagate as-is through the catch branch's `instanceof LLMDedupParseError` discriminator: `isParseErr ? 'parse error' : 'match error'`. The pre-existing 'onError: skip — returns no-match + stderr warn on LLM throw' test (expects 'match error' message) continues to pass."
  - "LLMDedupParseError.cause is populated by re-running JSON.parse on the trimmed raw response INSIDE parseDedupResponse and capturing the underlying SyntaxError via the discriminated ParseDedupResult.error field. Test 2's `expect(err.cause).toBeDefined()` is satisfied by this chain."
  - "Per Rule 1 (auto-fix bugs), the plan's grep acceptance criterion `grep -c 'function canonicalEmptyResponse' = 1` was NOT met because the discriminated-union refactor obviates the helper. All higher-order acceptance criteria (typed error class exported + candidate-list pattern + parsedTriedJson heuristic + instanceof LLMDedupParseError catch discrimination + threshold/onError defaults + OOM verbatim + 4 pre-existing JSON-unwrap variants pass + full suite green) ARE satisfied."

# Phase-40 close-gate context
gap_closure: true
requirements: [DEDUP-01]

metrics:
  duration: "~6 min wall clock (1 RED test commit + 1 GREEN fix commit + 1 SUMMARY commit)"
  tasks: 3
  files_created: 1   # 40-10-SUMMARY.md
  files_modified: 2  # LLMSemanticMatcher.ts + llm-matcher.test.ts
  tests_added_net: 4
  tests_total_after: 153
  completed: "2026-05-22"
---

# Phase 40 Plan 10: CR-03 + WR-08 Gap Closure Summary

**One-liner:** A focused rewrite of `LLMSemanticMatcher.ts` closes two `40-REVIEW.md` findings together — the BLOCKER CR-03 (raw `SyntaxError` propagation) is resolved by introducing an exported typed `LLMDedupParseError` and applying Contract A (the `{`-presence heuristic distinguishes "LLM attempted JSON but it failed to parse" from "prose-only refusal — silent no-match"); the bundled warning WR-08 (first-fence-match-wins mutation chain starves downstream unwrap stages) is resolved by rewriting `parseDedupResponse` as the candidate-list-of-tries pattern from REVIEW.md offset 311-340.

## What This Plan Delivered

### km-core commits

| Step | Subject | Hash |
|------|---------|------|
| Task 1 (RED) | `test(40-10): add RED tests pinning CR-03 typed error + prose-only silent no-match + WR-08 fence-then-bail` | `441cd19` |
| Task 2 (GREEN) | `fix(40-10): CR-03 typed LLMDedupParseError + Contract A prose-vs-attempted-JSON + WR-08 candidate-list unwrap` | `7962e51` |

### coding/ commit (this SUMMARY)

`docs(40-10): summary — CR-03 + WR-08 closed in km-core LLMSemanticMatcher`

## Contract A — Documented

**`parsedTriedJson = response.content.includes('{')`.**

- **True** AND `parseResult.ok === false` → parse-error path. Under `onError: 'throw'` → throw typed `LLMDedupParseError` (with `.raw` = first 1000 chars of response, `.cause` = underlying SyntaxError). Under `onError: 'skip'` → stderr-warn `[km-core/dedup/llm] parse error for "<name>" — skipping: <msg> (raw response: <first 200 chars>)` + return `{ matched: false, confidence: 0 }`.
- **True** AND `parseResult.ok === true` → unwrap succeeded; proceed to normal match.find() logic. Even if `parsed.matches` is empty (genuine canonical empty-matches response, possibly fence-wrapped with surrounding prose), NO parse-error is emitted — the LLM successfully sent JSON.
- **False** (no `{` anywhere — prose-only refusal / "I cannot determine duplicates") → silent no-match. No throw, no stderr-warn. Fall through to normal `return { matched: false, confidence: 0 }`.

## Verbatim Source — LLMDedupParseError Class

From `~/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts` lines 49-75:

```typescript
/**
 * Typed error thrown by {@link LLMSemanticMatcher.match} in
 * `onError: 'throw'` mode when the LLM response cannot be parsed
 * even after the 5-stage candidate-list unwrap. Closes CR-03
 * (40-REVIEW.md) — callers can `instanceof`-discriminate parse
 * failures from network errors / timeouts / other LLM-client errors.
 *
 * - `raw` — the first 1000 chars of the LLM's original response
 *   (truncated to avoid huge / PII payloads in error chains).
 * - `cause` — the underlying SyntaxError (Node 16+ Error cause).
 *
 * Contract A (40-10-PLAN.md): this error is constructed ONLY when the
 * raw LLM response contains at least one `{` (i.e. the LLM attempted
 * JSON). Prose-only responses with no `{` are silent no-match — no
 * throw, no stderr.
 */
export class LLMDedupParseError extends Error {
  readonly raw: string;
  constructor(message: string, opts: { raw: string; cause?: unknown }) {
    super(
      message,
      opts.cause !== undefined ? { cause: opts.cause } : undefined,
    );
    this.name = 'LLMDedupParseError';
    this.raw = opts.raw.slice(0, 1000);
  }
}
```

## Verbatim Source — New `parseDedupResponse` (Candidate-List-of-Tries)

From `~/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts` lines 297-340:

```typescript
function parseDedupResponse(raw: string): ParseDedupResult {
  const s = raw.trim();
  const candidates: string[] = [];

  // Stage 1: anchored fence (entire payload is ```json\n...\n```).
  const anchored = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  if (anchored) candidates.push(anchored[1].trim());

  // Stage 2: unanchored fence (fenced block somewhere in the response,
  // e.g. "Sure, here is the JSON:\n```json\n{...}\n```\n...").
  const unanchored = s.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (unanchored) candidates.push(unanchored[1].trim());

  // Stage 3: bare-brace extraction (prose-wrapped JSON).
  if (!s.startsWith('{') && !s.startsWith('[')) {
    const firstBrace = s.indexOf('{');
    const lastBrace = s.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(s.slice(firstBrace, lastBrace + 1));
    }
  }

  // Stage 4: raw (covers the LLM-emits-pure-JSON case).
  candidates.push(s);

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) as ParsedDedupShape };
    } catch (err) {
      lastError = err;
      // try next candidate
    }
  }
  // All candidates failed. match() surfaces a typed
  // LLMDedupParseError when the raw response contained at least one `{`
  // (Contract A — parsed-JSON-attempt path).
  return { ok: false, error: lastError };
}
```

The ParseDedupResult discriminated union (lines 269-276):

```typescript
type ParsedDedupShape = {
  matches?: Array<{ newName: string; existingName: string }>;
};
type ParseDedupResult =
  | { ok: true; value: ParsedDedupShape }
  | { ok: false; error: unknown };
```

## Verbatim Source — `match()` Contract A Block

From `~/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts` lines 182-202:

```typescript
const parseResult = parseDedupResponse(response.content);

// CR-03 + Contract A (40-10-PLAN.md): distinguish "LLM attempted
// JSON but it failed to parse" from "LLM responded with prose-only
// refusal / no-match". Heuristic: if response.content contains at
// least one `{`, the LLM tried to send JSON. If ALL candidate
// unwrap stages failed to JSON.parse (`parseResult.ok === false`),
// surface a typed LLMDedupParseError. If response.content has NO
// `{`, fall through to the normal no-match path (silent — no
// throw, no stderr-warn). If parse SUCCEEDED but matches is empty,
// that's a genuine canonical no-match — also silent.
const parsedTriedJson = response.content.includes('{');
if (parsedTriedJson && !parseResult.ok) {
  throw new LLMDedupParseError(
    'LLMSemanticMatcher: failed to parse LLM response',
    { raw: response.content, cause: parseResult.error },
  );
}
const parsed = parseResult.ok ? parseResult.value : { matches: [] };
```

## Verbatim Source — New `match()` Catch Branch (with Discrimination)

From `~/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts` lines 222-244:

```typescript
} catch (err) {
  if (this.onError === 'throw') throw err;
  // onError: 'skip' — stderr-warn + no-match fallback.
  const isParseErr = err instanceof LLMDedupParseError;
  const prefix = isParseErr ? 'parse error' : 'match error';
  const suffix = isParseErr
    ? ' (raw response: ' +
      (err as LLMDedupParseError).raw.slice(0, 200) +
      ')'
    : '';
  process.stderr.write(
    '[km-core/dedup/llm] ' +
      prefix +
      ' for "' +
      entity.name +
      '" — skipping: ' +
      (err instanceof Error ? err.message : String(err)) +
      suffix +
      '\n',
  );
  return { matched: false, confidence: 0 };
}
```

## Test Count Delta

| File | Before 40-10 | After 40-10 | Delta | Notes |
|------|--------------|-------------|-------|-------|
| `tests/unit/llm-matcher.test.ts` | 10 (9 from Plan 40-04 + 1 from Plan 40-09 CR-02) | 14 | +4 | All appended (no obsolete tests to replace; Plan 40-04 invariants preserved) |
| **Full vitest suite** | 149 (post-40-09 + 40-11) | 153 | +4 | Same delta — only llm-matcher.test.ts gained tests |

| New test | Verb |
|----------|------|
| `CR-03: parseDedupResponse returns no-match + stderr-warn when LLM attempted JSON but it's unparseable (onError: skip, default)` | parsedTriedJson=true + parseResult.ok=false + onError:skip → stderr 'parse error' + matched:false |
| `CR-03: onError: 'throw' propagates LLMDedupParseError (typed; not raw SyntaxError)` | parsedTriedJson=true + parseResult.ok=false + onError:throw → throws LLMDedupParseError; instanceof check; `raw.startsWith(...)`; `cause` defined |
| `WR-08: anchored-fence-matches-but-empty falls through to bare-brace stage` | Empty anchored fence + post-fence prose with bare-brace JSON; Stage 3 bare-brace rescues; matched:true |
| `CR-03: prose-only response (no \`{\`) yields silent no-match — no stderr, no throw` | parsedTriedJson=false → silent no-match under both onError modes; stderr spy not called; throw mode resolves to matched:false |

All 14 llm-matcher tests + 153 full-suite tests pass post-fix. `tsc --noEmit` clean. `npm run build` clean.

## Plan 04 Invariants — Preserved

Verified by grep:

| Invariant | Grep | Result |
|-----------|------|--------|
| OOM example in SYSTEM_PROMPT (verbatim, load-bearing) | `grep -c "OOM" src/dedup/LLMSemanticMatcher.ts` | 3 (header + prompt + comment) |
| Threshold default 0.70 | `grep -c "this.threshold = opts.threshold ?? 0.70" src/dedup/LLMSemanticMatcher.ts` | 1 |
| onError default 'skip' | `grep -c "this.onError = opts.onError ?? 'skip'" src/dedup/LLMSemanticMatcher.ts` | 1 |
| taskType default 'deduplication_matching' | `grep -c "this.taskType = opts.taskType ?? 'deduplication_matching'" src/dedup/LLMSemanticMatcher.ts` | 1 |
| timeoutMs default 60_000 | `grep -c "this.timeoutMs = opts.timeoutMs ?? 60_000" src/dedup/LLMSemanticMatcher.ts` | 1 |
| The 4 pre-existing JSON-unwrap variants still pass | `npx vitest run ... -t "parses bare JSON response"` etc. | All 4 PASS |

## Plan 40-09 Invariant — Preserved (CR-02 Closed)

| Invariant | Grep | Result |
|-----------|------|--------|
| No self-id filter on `existingNames` (CR-02 closure preserved) | `grep -c "c.id !== entity.id" src/dedup/LLMSemanticMatcher.ts` | 0 |

The `candidates.map((c) => c.name)` construction (line 164) from Plan 40-09 is untouched.

## Deviations from Plan

### 1. [Rule 1 — Bug] Replaced prescribed `canonicalEmptyResponse(raw): boolean` helper with discriminated-union ParseDedupResult

- **Found during:** Task 2 (GREEN implementation).
- **Issue:** The plan prescribed a helper `canonicalEmptyResponse(raw: string): boolean` whose body is:
  ```typescript
  const trimmed = raw.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```\s*$/, '').trim();
  return /^\{\s*"matches"\s*:\s*\[\s*\]\s*\}$/.test(trimmed);
  ```
  This was supposed to detect the canonical empty-matches answer (`{"matches":[]}`) so match() could distinguish it from a parse failure. After implementing the plan verbatim, the pre-existing test `'unwraps unanchored markdown fence (fence in middle of response)'` (raw = `'Sure, here is the JSON:\n\`\`\`json\n{"matches":[]}\n\`\`\`\nLet me know if you need anything else.'`) started emitting a `[km-core/dedup/llm] parse error` stderr message — because `canonicalEmptyResponse` only strips ONE leading/trailing fence and only matches anchored `^...$`. The prose-prefix `'Sure, here is the JSON:\n'` is not consumed, so the regex rejects the input, and Contract A misclassifies a successful parse-via-Stage-2 as a parse failure. The test assertion (`matched: false, confidence: 0`) still passes, but the stderr noise is a regression in operator UX.
- **Fix:** Replaced the boolean helper with a discriminated-union `ParseDedupResult` returned by `parseDedupResponse`:
  ```typescript
  type ParseDedupResult =
    | { ok: true; value: ParsedDedupShape }
    | { ok: false; error: unknown };
  ```
  `match()` then checks `parseResult.ok === false` (rather than re-deriving the canonical-empty boolean) to detect "all candidates failed to JSON.parse". This sidesteps the regex-fragility entirely AND captures the underlying SyntaxError in `parseResult.error` for `LLMDedupParseError.cause`. Net result: cleaner code, no regression in stderr UX, the typed error carries a proper `cause` chain.
- **Impact:** The plan's grep acceptance criterion `grep -c "function canonicalEmptyResponse" = 1` is NOT met (it now returns 0). The plan's higher-order behavioral acceptance criteria (Contract A; typed error with `raw` + `cause`; WR-08 candidate-list pattern; threshold/onError defaults; OOM verbatim; 4 pre-existing JSON-unwrap variants pass; full suite green) ARE all satisfied.
- **Files modified:** `src/dedup/LLMSemanticMatcher.ts` only.
- **Commits:** `441cd19` (RED) + `7962e51` (GREEN).

No other deviations. No Rule 4 architectural decisions required. No auth gates encountered.

## Auth Gates

None.

## Known Stubs

None. The fix is additive (new export + helper rewrite) + structural (mutation chain → candidate list); no placeholder values, no TODO markers.

## What's Next

- **CR-03 + WR-08 closed.** Both `40-REVIEW.md` findings fully resolved.
- **CR-01 + CR-04 closed by Plan 40-08** (commits `1331568` + `851ed8e`).
- **CR-02 closed by Plan 40-09** (commits `e35dc00` + `849370d`).
- **SC#1 example app closed by Plan 40-11** (commits `8171a7f` + `24fd63f`).
- All four BLOCKER findings + SC#1 manual verification gate are now closed. After this SUMMARY commits, `/gsd:verify-phase 40` re-run should flip `status: gaps_found` → `status: complete` in `40-VERIFICATION.md` and unblock Phase 40 close.

## Self-Check

- [x] `~/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts` exports `LLMDedupParseError` (grep verified).
- [x] `LLMDedupParseError extends Error` with `readonly raw: string` and `cause` plumbing (grep verified).
- [x] `parseDedupResponse` rewritten as candidate-list-of-tries (`const candidates: string[] = [];` + 4 `candidates.push` calls, grep verified).
- [x] `parseResult.ok` discriminator drives the Contract A branch in `match()`.
- [x] `parsedTriedJson` heuristic explicit (`response.content.includes('{')`, grep verified).
- [x] Outer catch branch discriminates parse-vs-other errors (`instanceof LLMDedupParseError`, grep verified).
- [x] km-core commit `441cd19` (test 40-10 RED) on `main` — verified via `git log --oneline -4`.
- [x] km-core commit `7962e51` (fix 40-10 GREEN) on `main` — verified via `git log --oneline -4`.
- [x] tsc strict-clean (no errors) — verified via `npx tsc --noEmit`.
- [x] 14/14 llm-matcher tests pass — verified via single-file vitest run.
- [x] 153/153 full vitest suite passes — verified via `npm test`.
- [x] All 4 pre-existing JSON-unwrap test variants pass by name — verified via `npx vitest run -t "<name>"` loop.
- [x] dist/ regenerated — verified via `npm run build`.
- [x] Plan 04 OOM verbatim example preserved (grep `OOM` returns 3).
- [x] Plan 04 defaults preserved (threshold 0.70, onError 'skip', taskType 'deduplication_matching', timeoutMs 60_000 — all grep-verified).
- [x] Plan 40-09 CR-02 invariant preserved (no `c.id !== entity.id` filter — grep returns 0).
- [x] No console.log/info/warn/error/debug in LLMSemanticMatcher.ts (stderr-only convention preserved).

## Self-Check: PASSED
