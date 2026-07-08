# Phase 84-09 — LIVE END-TO-END GATE Evidence

**Run date:** 2026-07-08
**Live task_id:** `ctx-live-84-09--copilot-openai--r0`
**Operator:** sequential executor (main working tree, no worktree)

This file records the honest live proof of the full per-turn-context-revelation pipeline:
proxy redeploy -> one live measured span (raw-body capture ON) -> real gzipped artifacts ->
both read APIs -> redaction of live secrets -> honest explainer render. Nothing here is
inferred from file/DB inspection alone; every artifact was produced by a real measured span
through the redeployed proxy.

---

## 0. Pre-redeploy safety — coordinator location=open (T-84-09-02 mitigation)

Confirmed BEFORE `launchctl kickstart` (Pitfall 6 — a kickstart can mis-detect corporate routing):

```
$ curl -s http://localhost:3034/health/state | (network/proxy fields)
network.location = open | proxy.networkMode = public | consecutive_strong_network_failures = 0
```

Safe to redeploy: location is `open`, no strong-network failures.

## 1. Proxy redeploy (runtime server.mjs, NO build)

Runtime proxy repo `/Users/Q284340/Agentic/_work/rapid-llm-proxy` HEAD = `b1e0a49` (all
84-04/84-06 commits present: `ad6f7f7`, `0b1b012`, `f6b462f`, `a1d0912`, `b1e0a49`). The
running daemon was the stale build `e72666a`.

```
BEFORE:  build=e72666a (2026-07-07)  networkMode=public
         GET /api/context-turns?task_id=nonexistent  ->  {"error":"Not found"}   (route ABSENT)

$ launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy

AFTER:   build=b1e0a49 (2026-07-08)  networkMode=public   (no corporate mis-detect)
         GET /api/context-turns?task_id=nonexistent  ->  {"contextTurns":[]}      (route LIVE, graceful-empty)
         coordinator: network.location=open | proxy.networkMode=public   (still open post-kickstart)
```

server.mjs is runtime JS — **no `npm run build`** was run (correct per D-03 / Runtime Inventory).

## 2. One live measured span with capture_raw_bodies=true

Span opened via `startMeasurement({ task_id, meta:{ capture_raw_bodies:true } })` (D-05
mechanism — the flag rides on `span.meta`, read at the proxy via the single-reader
`getActiveMeasurement()`):

```
SPAN_STARTED    {"task_id":"ctx-live-84-09--copilot-openai--r0","started_at":"2026-07-08T04:32:11.927Z","meta":{"capture_raw_bodies":true}}
ACTIVE_READBACK {"task_id":"ctx-live-84-09--copilot-openai--r0","capture_raw_bodies":true}
```

Three REAL `POST http://localhost:12435/api/complete` requests fired with `task_id` bound
(request #2 embedded synthetic fake secrets to exercise redaction on live traffic):

```
REQ_1 turn-1-clean             status=200 ms=4677 provider=claude-code model=claude-haiku-4-5-20251001 tokens={input:508,output:11,total:519} content="OK"
REQ_2 turn-2-with-fake-secrets status=200 ms=4948 provider=claude-code model=claude-haiku-4-5-20251001 tokens={input:508,output:11,total:519} content="OK"
REQ_3 turn-3-clean             status=200 ms=2362 provider=claude-code model=claude-haiku-4-5-20251001 tokens={input:508,output:11,total:519} content="DONE"
```

(The `/api/complete` endpoint emits `wire:'openai'` lines regardless of which backend
provider the proxy auto-routes to — so all three turns are OpenAI-wire with `cache_write:null`,
exactly the N/A path this gate must demonstrate.)

Plaintext artifacts written while the span was open (`.data/measurements/<task_id>/`):
`context-turns.jsonl` (3 lines) + `raw-bodies.jsonl` (3 lines).

### Span close -> gzip-at-close (84-05)

`node scripts/measurement-stop.mjs --headless` ran the real close pipeline. Post-close:

```
$ ls .data/measurements/ctx-live-84-09--copilot-openai--r0/
context-turns.jsonl.gz   (540 bytes — real .gz, plaintext removed)
raw-bodies.jsonl.gz      (473 bytes — capture flag honored, plaintext removed)
active-measurement.json  ->  gone (span closed)
archived span            ->  .data/measurements/ctx-live-84-09--copilot-openai--r0.json
```

**Acceptance (Task 1): PASS** — both `.gz` artifacts exist after close (real gzip, not plaintext);
redeploy was preceded by a confirmed `location=open`.

## 3. Both read APIs return the live per-turn array

### (1) Proxy read surface — `GET :12435/api/context-turns?task_id=<tid>`  ->  count=3
```
wire=openai usage={input:508,output:11,cache_read:0,cache_write:null} req=live8409-call-1 preview="Reply with exactly the single word: OK"
wire=openai usage={input:508,output:11,cache_read:0,cache_write:null} req=live8409-call-2 preview="Here is a config dump to summarize in one word. ap"
wire=openai usage={input:508,output:11,cache_read:0,cache_write:null} req=live8409-call-3 preview="Reply with exactly the single word: DONE"
```
Separate `usage.{input,output,cache_read,cache_write}` split (D-09), `wire` discriminator,
`cache_write:null` (OpenAI-wire -> N/A, D-12), `messages[].preview`.

### (2) vkb via dashboard — `GET :3032/api/experiments/runs/<tid>/context-turns`  ->  count=3
All 3 turns, `wire=openai`, `cache_write=null`. (This is the surface the explainer's
`fetchContextTurns` thunk consumes.) Direct vkb `:8080` returns the same. Graceful-empty
`{"contextTurns":[]}` on a nonexistent task_id.

### (3) Dashboard mirror — `GET :3032/api/context-turns?task_id=<tid>`  ->  count=3
Activated by `docker-compose restart coding-services` (the container restart 84-07 explicitly
deferred to this plan; Pitfall 5 — full restart to invalidate the VirtioFS cache). Returns 3
openai-wire turns; graceful-empty on nonexistent.

**Acceptance (Task 2, read APIs): PASS** — proxy + vkb-via-dashboard both serve the live turns.

## 4. Redaction verified on LIVE raw bodies (T-84-09-01 — security assertion, fail-closed)

Request #2 embedded three synthetic fake secrets. After the span closed, the gzipped
`raw-bodies.jsonl.gz` was gunzipped and grepped:

```
$ grep -Eic 'sk-ant-api03-FAKELEAK|ghp_FAKELEAK|eyJhbGci...FAKELEAK'  raw-bodies.jsonl   ->  0
$ grep -Eio 'sk-ant-api03-[A-Za-z0-9]{6,}|ghp_[A-Za-z0-9]{6,}|eyJ[...]|Bearer [A-Za-z0-9_-]{6,}' | grep -v REDACT   ->  (empty — NO unredacted secrets)
```

What the redactor actually produced in the persisted request body:
```
... one word. api_key=<SECRET_REDACTED> authorization=Bearer <TOKEN_REDACTED> jwt=<JWT_REDACTED> . Reply with the single word: OK
```
Redaction markers present (proves the shared 27-pattern set ran): `<SECRET_REDACTED>` ×1,
`<TOKEN_REDACTED>` ×1, `<JWT_REDACTED>` ×1.

**Acceptance (Task 2, redaction): PASS** — zero unredacted secrets survive on live traffic;
fail-closed security assertion holds.

## 5. Honest explainer renders the LIVE data with N/A (Task 3 — human-verify)

Explainer opened for the REAL live task_id (`performance/setExplainTaskId` dispatched via the
Redux store; the runs KB has 0 rows for this ad-hoc span, so there is no "Explain" button —
same programmatic-open as 84-08, but the DATA is pulled live by `fetchContextTurns(taskId)`
through the read route, not a fixture). Live DOM assertions:

```
dialogPresent=true  hasNA=true  hasCachingCopy=true  mentionsOpenAIwire=true  taskIdShown=true
naCount=5   (per-turn table + stat card)
per-turn table:
  T1 openai | cache read 0 | cache write "N/A (provider reports no cache-creation)" | fresh input 508 | output 11
  T2 openai | cache read 0 | cache write "N/A (provider reports no cache-creation)" | fresh input 508 | output 11
  T3 openai | cache read 0 | cache write "N/A (provider reports no cache-creation)" | fresh input 508 | output 11
verdict banner: "This run does not reuse a prompt cache. Across 3 turns, 0% of prompt tokens
                 came from cache — every turn re-sent the full context as fresh input (1,524 tokens)."
stat cards: Cache read 0 | Cache write N/A (provider reports no cache-creation) | Fresh input 1,524 | Output 33
```

All numbers are real live wire values (508×3=1,524 fresh input; 11×3=33 output).

**gsd-browser screenshots** (project mandate — not a hand-rolled Playwright script):
- `.planning/phases/84-per-turn-context-revelation/evidence/84-09-live-explainer.png` — header (live task_id) + real-data verdict banner + anatomy band.
- `.planning/phases/84-per-turn-context-revelation/evidence/84-09-live-perturn-table.png` — per-turn bar chart + stat cards (N/A cache-write) + per-turn table (3 openai turns, N/A) + "How prompt caching actually works — and why cache-write is sometimes 'N/A'" copy.

**Acceptance (Task 3): AWAITING HUMAN CONFIRMATION** — this is the phase-gate human-verify
checkpoint. The executor does NOT self-approve.

---

## Summary of the four verification conditions

| # | Condition | Result | Evidence |
|---|-----------|--------|----------|
| 1 | `context-turns.jsonl.gz` produced at span close | PASS | 540-byte `.gz`, plaintext removed |
| 2 | Both read APIs return the turns | PASS | proxy count=3 + vkb-via-dashboard count=3 (+ mirror count=3) |
| 3 | `raw-bodies.jsonl.gz` gunzips with NO unredacted secrets | PASS | 0 secret substrings; `<SECRET/TOKEN/JWT_REDACTED>` markers present |
| 4 | Explainer renders live data with N/A for OpenAI-wire | PASS (pending human sign-off) | 2 gsd-browser screenshots; T1-T3 openai N/A; verdict on real 1,524 fresh input |

## Runtime state left behind
- Proxy daemon now on build `b1e0a49` (the 84-04/06 hooks live). `networkMode=public`.
- `coding-services` container restarted (dashboard `/api/context-turns` mirror + vkb route live).
- Live evidence artifacts retained under `.data/measurements/ctx-live-84-09--copilot-openai--r0/`
  (age-swept in 14 days by `com.coding.context-turns-sweeper`, D-01).
