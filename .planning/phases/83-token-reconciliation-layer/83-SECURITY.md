---
phase: 83
slug: token-reconciliation-layer
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-07
---

# Phase 83 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (all 9 plans carried `<threat_model>` blocks). Auditor verified each declared mitigation exists in the implementation across both repos (coding + rapid-llm-proxy). 38/38 threats closed; no implementation gaps.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| coding-agent CLI → proxy `/v1/messages` tap | Untrusted `x-task-id` / `x-agent` request headers | task_id (becomes DB key + filename component), agent label |
| proxy HTTP request (`body.agent`) → token_usage write | `/api/complete` shim path stamps `user_hash` via `adapterUserHash(body.agent)` | agent label → sanitized 6-char user_hash |
| upstream provider → shim usage parse | Untrusted `usage` JSON (possibly missing/malformed cache fields) | token/cache counts |
| concurrent writers → SQLite token_usage | Two independent connections allocate `id` for the same `user_hash` | row identity (composite PK) |
| transcript/session file → reconcile matcher | Adapter-parsed transcript rows drive DB SELECT + conditional UPDATE | tool_call_id, model, token counts, task_id |
| HTTP client → `GET .../:taskId/reconciliation` | Untrusted `taskId` path parameter becomes a filesystem path component | task_id → `.data/measurements/` path |
| span close → `.data/measurements` sink | `task_id` becomes a directory name | reconciliation.json contents |
| shell env → copilot process | `COPILOT_PROVIDER_*` exports steer copilot's provider endpoint | BYOK routing config, placeholder key |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-83-01-01 | Denial of Service | tap header `sanitizeTaskId` | mitigate | try/catch → `safeSanitizeTaskId(resolveLiveTaskId())` fallback; malformed header cannot throw out of the async handler (`server.mjs:2030-2046`, `:1608-1612`) | closed |
| T-83-01-02 | Tampering | task_id as DB / `_ctxMaxByTask` key | mitigate | every seam keys on sanitized `taskId` `[A-Za-z0-9._-]`≤80; raw header never reaches a map/DB key (`server.mjs:2019,2032,2068,2078,2221`) | closed |
| T-83-01-03 | Spoofing | header-less request adopting a live span | mitigate | D-08 empty-header no-inherit: `taskId=''`, no ambient adoption (`server.mjs:2037-2046`) | closed |
| T-83-01-SC | Tampering | npm/pip/cargo installs | accept | No new package installs — edits to existing `server.mjs` only | closed |
| T-83-02-01 | Denial of Service | `parseOpenAICache` on malformed usage | mitigate | pure/never-throw/coalesce-to-0; tap parse wrapped try/catch (`usage-cache.ts:42-59,88-100`, `server.mjs:2157-2194`) | closed |
| T-83-02-02 | Tampering | id collision dropping a distinct row | mitigate | D-11 composite `PRIMARY KEY (user_hash, id)`; idempotent migration (`token-usage.ts:433,488,461-468`) | closed |
| T-83-02-03 | Denial of Service | migration throwing on startup | mitigate | PRAGMA-guarded + try/catch → ROLLBACK + non-fatal stderr, never aborts daemon start (`token-usage.ts:460-528`) | closed |
| T-83-02-SC | Tampering | npm/pip/cargo installs | accept | No new package installs — existing proxy source only | closed |
| T-83-03-01 | Tampering (SQLi) | matcher SQL (probe + gap-fill) | mitigate | all values `?`-bound; tool_call_id/model never interpolated (`token-db.mjs:276,301`; `reconcile.mjs:78-81`) | closed |
| T-83-03-02 | Elevation of Privilege | enrich overwriting wire counts | mitigate | gap-fill uses `MAX()`/`COALESCE(NULLIF())`/`CASE WHEN sum=0`; wire counts never decrease (D-04) (`token-db.mjs:301-309`) | closed |
| T-83-03-03 | Denial of Service | matcher throwing mid-span-close | mitigate | never-throw → catch → safe unmatched result + `[reconcile]` stderr (`reconcile.mjs:189-210,296-343`) | closed |
| T-83-03-SC | Tampering | npm/pip/cargo installs | accept | No new package installs — new module + test only | closed |
| T-83-04-01 | Elevation of Privilege | reconcile double-inserting a matched row | mitigate | matched rows enrich in place; zero net new rows on match (`stop-adapter-registry.mjs:560-567`) | closed |
| T-83-04-02 | Repudiation | fallback rows indistinguishable from wire | mitigate | distinct `token-adapter-<agent>-fallback` provenance on `process` (`stop-adapter-registry.mjs:79-80,581-585`) | closed |
| T-83-04-03 | Denial of Service | reconcile throwing during span close | mitigate | per-row try/catch → counted fallback + stderr, never blocks close (`stop-adapter-registry.mjs:550-558`) | closed |
| T-83-04-04 | Tampering | interactive path silently changed | mitigate | reconcile gated on `opts.reconcile`; interactive `insertTokenRowDeduped` unchanged (`stop-adapter-registry.mjs:418,437`) | closed |
| T-83-04-SC | Tampering | npm/pip/cargo installs | accept | No new package installs — existing module + new test | closed |
| T-83-05-01 | Information Disclosure | path traversal via `taskId` (`../`) | mitigate | `_validTaskId` `[A-Za-z0-9._-]`≤80 rejects `/`/`..` BEFORE `path.join` (`api-routes.js:782-785,608,614`) | closed |
| T-83-05-02 | Tampering | sink task_id escaping measurements dir | mitigate | `sanitizeTaskId(span.task_id)` sanitizes sink dir name at write time (`measurement-stop.mjs:471`) | closed |
| T-83-05-03 | Denial of Service | sink write or read throwing | mitigate | write best-effort try/catch; read ENOENT → 200 empty not 500 (`measurement-stop.mjs:474-482`, `api-routes.js:620-622`) | closed |
| T-83-05-04 | Elevation of Privilege | run invalidated by advisory flag | accept | D-06: flagged discrepancy is advisory only; no run-taint marker written — by design | closed |
| T-83-05-SC | Tampering | npm/pip/cargo installs | accept | No new package installs — existing files + new test | closed |
| T-83-06-01 | Tampering | interactive copilot routed through dead proxy | mitigate | interactive/unhealthy path unsets `COPILOT_PROVIDER_*` (WR-05) (`copilot.sh:77`, `launch-agent-common.sh:400-404,467`) | closed |
| T-83-06-02 | Information Disclosure | `COPILOT_PROVIDER_API_KEY` value | accept | literal `rapid-proxy-no-auth-placeholder` (not a real secret), loopback `127.0.0.1` only (`launch-agent-common.sh:460,398`) | closed |
| T-83-06-03 | Repudiation | interactive copilot double-writing wire+transcript | mitigate | BYOK exported only when `TASK_ID` set → copadt-only capture off interactive path (`launch-agent-common.sh:457-468`) | closed |
| T-83-06-SC | Tampering | npm/pip/cargo installs | accept | No new package installs — shell + JS env-wiring edits only | closed |
| T-83-07-01 | Repudiation | double-count masking a matcher bug | mitigate | golden-property 1 comparison vs transcript-only baseline surfaces double-count/loss numerically (`wire-verify-83-reconcile.yaml:11-29`) | closed |
| T-83-07-02 | Denial of Service | proxy-down window losing tokens silently | mitigate | golden-property 2 asserts full transcript fallback with provenance | closed |
| T-83-07-03 | Spoofing | daemon/interactive rows contaminating cell task_ids | mitigate | golden-property 6 confirms D-08 ambient-leak fix under live concurrency | closed |
| T-83-07-SC | Tampering | npm/pip/cargo installs | accept | No new package installs — YAML spec + live run only | closed |
| T-83-08-01 | Tampering (SQLi) | gap-fill task_id backfill + snapshot query | mitigate | all new SQL `?`-bound; `.all(adapterUserHash, taskId ?? '')` (`token-db.mjs:301-309`, `stop-adapter-registry.mjs:662-666`) | closed |
| T-83-08-02 | Denial of Service | reconcile roll-up + snapshot at span close | mitigate | never-throw → empty aggregate/snapshot/0 unmatched (`stop-adapter-registry.mjs:661-678`, `reconcile.mjs:249-263`) | closed |
| T-83-08-03 | Attribution tamper | task_id backfill on wire rows | accept (guarded) | `CASE WHEN task_id='' THEN ? ELSE task_id END` + `WHERE tool_call_id = ?` — span-scoped, never overwrites (D-08) (`token-db.mjs:308`) | closed |
| T-83-08-SC | Tampering | npm/pip/cargo installs | accept (n/a) | No new package installs; no dependency changes | closed |
| T-83-09-01 | Tampering (injection) | fuzzyMatch candidate scoping | mitigate | `candidateWireIds`/`consumedWireIds` in-memory Sets of integer rowid PKs; no new SQL; `FUZZY_CANDIDATES_SQL` keeps model-bound `?` (`reconcile.mjs:141-153`) | closed |
| T-83-09-02 | Spoofing / attribution | `user_hash: adapterUserHash(body.agent)` on `/api/complete` | accept (guarded) | `adapterUserHash` sanitizes to `/^[a-z][a-z0-9]{5}$/` (first char alpha, pad/truncate to 6); spoofed agent only mis-buckets its OWN row, no cross-user escalation (`server.mjs:70-76`) | closed |
| T-83-09-03 | Denial of Service | reconcile loop + `logTokenCall` | mitigate | fuzzyMatch pure Set lookups (never-throw wrapper); proxy stamp is a conditional field on best-effort `logTokenCall` (`reconcile.mjs:134-166`, `server.mjs:2725-2727`) | closed |
| T-83-09-SC | Tampering | npm/pip/cargo installs | accept (n/a) | No new package installs; no dependency changes in either repo | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**CR-fix cross-check (rowid identity):** The 83-REVIEW/83-REVIEW-FIX rowid-identity change is confined to SELECT-column identity (`SELECT rowid AS rid …` + Set membership on `c.rid`). It did NOT weaken any SQL-binding guard (all values still `?`-bound) nor the path-traversal guard (`_validTaskId`/`sanitizeTaskId` unchanged).

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-83-01 | T-83-05-04 | Reconciliation discrepancy is advisory only (D-06) — a flagged mismatch never taints/invalidates a run; by design | phase author (83-CONTEXT D-06) | 2026-07-07 |
| AR-83-02 | T-83-06-02 | `COPILOT_PROVIDER_API_KEY` is the literal placeholder `rapid-proxy-no-auth-placeholder` against loopback only — no real credential exposed | phase author (83-06 threat model) | 2026-07-07 |
| AR-83-03 | T-83-08-03 / T-83-09-02 | Guarded attribution stamps: task_id backfill only on `''` + tool_call_id-matched span-scoped rows; `adapterUserHash` sanitization confines a spoofed `body.agent` to mis-bucketing its own row (no cross-user escalation) | security auditor 2026-07-07 | 2026-07-07 |
| AR-83-SC | T-83-0X-SC (×9) | No package.json change in either repo during the phase-83 window (git log both repos, no dependency commits) — supply-chain rows accept/n-a | security auditor 2026-07-07 | 2026-07-07 |

*Accepted risks do not resurface in future audit runs.*

---

## Advisory Follow-Ups (non-blocking, no absent declared mitigation)

- **F1** (informational): `lib/experiments/experiment-runner.mjs` `configureProxyRoutingEnv` fail-soft branch may leave an inherited `ANTHROPIC_BASE_URL` — a WR-05-*class* latent seam on a DIFFERENT variable than the audited copilot `COPILOT_PROVIDER_*` unset (T-83-06-01, which IS mitigated). Already logged in `83-07-SUMMARY.md:116-120`. Low priority.
- **F2** (informational): a zero-wire-row proxy-down span could let non-primary transcript rows fuzzy-match adjacent interactive task-less wire rows; correctly flagged and the D-08 `''`-arm is excluded from `fuzzyCandidateIds` (`stop-adapter-registry.mjs:670-672`). Documented refinement candidate.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-07 | 38 | 38 | 0 | gsd-security-auditor (opus) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-07
