---
phase: 82
slug: wire-measurement-foundation
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-06
---

# Phase 82 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| caller → token_usage DB | TokenUsageRow values (including cache counts) written to SQLite | token/cache counters, task ids |
| HTTP client → /v1/messages tap | x-task-id / x-agent request headers (untrusted) drive row attribution | attribution headers |
| Anthropic upstream → tap | SSE/JSON usage object parsed into DB counters | usage counters |
| shim client → /v1/copilot + /v1/chat/completions | arbitrary tools[] function schemas + tool_choice forwarded to a provider | tool schemas, tool_calls |
| proxy → upstream provider | tools payload sent to Copilot HTTP; tool_calls echoed to client | tool schemas, tool_calls |
| token adapters → token_usage DB | tap rows + cladpt/copadt transcript rows converge on (user_hash, tool_call_id) | token/cache rows |
| launcher env → agent process | ANTHROPIC_CUSTOM_HEADERS / COPILOT_PROVIDER_* env values drive proxy routing + task binding | routing env, task ids |
| operator deploy → live proxy | build + launchctl kickstart swaps running proxy code | deploy artifacts |
| BYOK agent → /v1/copilot | tool schemas forwarded; agent executes file-write tools with --allow-all | tool schemas, file writes |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-82-01-01 | Tampering | migration ALTER on legacy DBs | mitigate | PRAGMA table_info existence guard + try/catch non-fatal stderr; DDL `DEFAULT 0` (`src/token-usage.ts:609-622`) | closed |
| T-82-01-02 | Denial of Service | logCall on malformed row | mitigate | cache fields `?? 0` coalesced inside logCall try/catch (`src/token-usage.ts:887-888`, :852) | closed |
| T-82-01-03 | Information disclosure | export JSON gains cache columns | accept | integer-only cache counts, no PII; exports already git-tracked (`token-usage.ts:797`) | closed |
| T-82-01-SC | Tampering | npm install of dependencies | accept | no package.json/lockfile change in `491b2ff`/`9edd7e0` | closed |
| T-82-02-01 | Spoofing | x-agent header can claim any agent | mitigate | adapterUserHash enforces `/^[a-z][a-z0-9]{5}$/` (`server.mjs:70-76`); process forced `token-adapter-<agent>` (:2003); localhost-bound proxy (residual accepted, see AR-82-02) | closed |
| T-82-02-02 | Tampering | x-task-id path/injection into DB or filenames | mitigate | sanitizeTaskId (path.basename + charset whitelist + length cap) before use (`server.mjs:1999`; `src/measurement-span.ts:83-102`) | closed |
| T-82-02-03 | Information disclosure | wrong-task attribution leaks one span's tokens into another | mitigate | header precedence (`server.mjs:1994-1999`) + captureBelongsToRun secondary guard (:2030, def :1626-1637); live 2-cell regression in Plan 06 | closed |
| T-82-02-04 | Denial of Service | malformed usage object crashes the tap | mitigate | parseUsageCache never throws (numeric coalesce, `src/usage-cache.ts`); write in non-fatal try/catch (`server.mjs:2153,2177-2179`) | closed |
| T-82-02-SC | Tampering | npm install of dependencies | accept | no manifest change in `c53af2c`/`742189d`/`073d4c6` | closed |
| T-82-03-01 | Tampering | arbitrary function schemas forwarded to providers | accept | schemas opaque to proxy, executed only by downstream agent runtime that owns tool execution + user gating; localhost bind (AR-82-03) | closed |
| T-82-03-02 | Elevation of privilege | tools silently dropped onto claude-code CLI | mitigate | gateToolCapableChain → 400 NO_TOOL_CAPABLE_PROVIDER fail-loud, never silent-strip (`server.mjs:2530-2543`; `shim-tools.mjs:82-95`) | closed |
| T-82-03-03 | Spoofing | /v1/copilot path lets any caller stamp agent='copilot' | mitigate | SHIM_PATH_AGENTS path-derived default only (`server.mjs:2226-2235`); X-Agent wins (:2267); sanitizeTaskId on `/t/<id>` (:2243-2244) | closed |
| T-82-03-04 | Denial of Service | malformed tools array crashes the envelope | mitigate | Array.isArray guards on tools/toolCalls (`shim-tools.mjs:16,40`; `server.mjs:2331,2532,773,897`) | closed |
| T-82-03-SC | Tampering | npm install of dependencies | accept | no manifest change in `7d948f9`/`f8bc1e6`/`790d435`/`fa7763c` | closed |
| T-82-04-01 | Tampering | in-place UPDATE could double-count on already-enriched row | mitigate | UPDATE gated on cache-less row (sum===0); already-cached → return-false drop; overwrite-once (`lib/lsl/token/token-db.mjs:236-253`) | closed |
| T-82-04-02 | Tampering | SQL injection via row values | mitigate | MERGE_ON_CACHE_SQL parameterized `?` binds only; all values num()-coalesced (`token-db.mjs:193-194`, :242-245) | closed |
| T-82-04-03 | Denial of Service | merge SELECT/UPDATE throws on write path | mitigate | merge inside never-throw try/catch with `[token-adapter]` stderr (`token-db.mjs:257-260`) | closed |
| T-82-04-SC | Tampering | npm install of dependencies | accept | no manifest change in `453e40d9f`/`cf4559c2a` | closed |
| T-82-05-01 | Information disclosure | placeholder API key in launcher env/logs | accept | literal non-secret `rapid-proxy-no-auth-placeholder` against localhost no-auth proxy (`config/agents/copilot.sh:79`, `scripts/launch-agent-common.sh:453`) (AR-82-05) | closed |
| T-82-05-02 | Spoofing | x-task-id header value could be attacker-chosen | mitigate | value is launcher-owned TASK_ID (`lib/experiments/experiment-runner.mjs:177`, `launch-agent-common.sh:418`); tap sanitizes per T-82-02-02 | closed |
| T-82-05-03 | Tampering | re-routing claude cells could regress cache accounting | mitigate | Plans 02+04 landed first (verified); CODING_PROXY_ROUTE opt-out + /health gate unchanged (`experiment-runner.mjs:144-158`, `launch-agent-common.sh:390-404`) | closed |
| T-82-05-04 | Elevation of privilege | flag-gated opencode provider becomes default prematurely | mitigate | OFF-by-default `${OPENCODE_ANTHROPIC_NATIVE:-0}` (`config/agents/opencode.sh:58`); default config byte-identical | closed |
| T-82-05-SC | Tampering | npm install of dependencies | accept | no manifest change in `93274259e`/`b8f7f1203`/`eed2e426a` | closed |
| T-82-06-01 | Denial of Service | proxy restart mis-detects corporate network and flaps | mitigate | coordinator :3034 confirmed `location=open` BEFORE kickstart (82-06-SUMMARY Task 1); launchd-managed restart | closed |
| T-82-06-02 | Elevation of privilege | --allow-all file-creation task writes outside intended path | mitigate | writes scoped to timestamped `/tmp/byok-proof-1783274148.txt` + `/tmp/opencode-proof-1783274148.txt`, path reviewed (82-VERIFICATION.md:32) | closed |
| T-82-06-03 | Information disclosure | concurrent run cross-contaminates spans | mitigate | gate caught 86% v1 contamination; fixed via isBackgroundProcess denylist (`src/background-process.ts`, consumed `server.mjs:2673-2675`, proxy `d3f3869`); v2 re-run zero daemon rows, human-approved | closed |
| T-82-06-SC | Tampering | npm run build pulls new/changed dependencies | mitigate | locked dependency set — git shows no package.json/lockfile change in `d3f3869` or coding commits | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-82-01 | T-82-01-03 | Cache-count export columns are integers with no PII; exports already git-tracked per Phase 36 convention | user (secure-phase run) | 2026-07-06 |
| AR-82-02 | T-82-02-01 (residual) | x-agent header source is a trusted local process — proxy is localhost-bound (127.0.0.1/host.docker.internal); hash/process constraints bound the blast radius | user (secure-phase run) | 2026-07-06 |
| AR-82-03 | T-82-03-01 | Function schemas are opaque passthrough; tool execution + user gating owned by the downstream agent runtime on a localhost bind | user (secure-phase run) | 2026-07-06 |
| AR-82-05 | T-82-05-01 | `rapid-proxy-no-auth-placeholder` is a literal non-secret against a localhost no-auth proxy; no real credential exposed | user (secure-phase run) | 2026-07-06 |
| AR-82-SC | T-82-01-SC, T-82-02-SC, T-82-03-SC, T-82-04-SC, T-82-05-SC | No new packages added anywhere in Phase 82; verified via git (no package.json/lockfile deltas across all plan commits) | user (secure-phase run) | 2026-07-06 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-06 | 27 | 27 | 0 | gsd-security-auditor (opus) via /gsd-secure-phase |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-06
