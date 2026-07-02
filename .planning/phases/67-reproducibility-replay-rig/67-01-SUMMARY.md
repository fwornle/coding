---
phase: 67-reproducibility-replay-rig
plan: 01
subsystem: repro-llm-channel
tags: [reproducibility, replay, llm, match-key, fixtures, tdd]
requires: []
provides:
  - "lib/repro/fixtures/match-key.mjs (normalizeReq/matchKey/resetOrdinals — D-07 single hash impl)"
  - "lib/repro/fixtures/llm-record.mjs (recordFixture — best-effort fixture writer)"
  - "lib/repro/fixtures/llm-replay.mjs (replayLookup — hard-fail-on-miss, D-06)"
  - "tests/repro/_fixtures/ (shared synthetic /api/complete req+resp + redacted transcript fragment)"
affects:
  - "Plan 06 (proxy tap) consumes matchKey/recordFixture/replayLookup"
  - "Plan 07 (integration flow) consumes the same record/replay core"
  - "Plan 02 (harness-record) consumes tests/repro/_fixtures/transcript-fragment.jsonl"
tech-stack:
  added: []
  patterns:
    - "sha256 content hash via node:crypto (measurement-stop.mjs idiom)"
    - "best-effort side-write wrapped in try/catch (server.mjs _tokenDb contract)"
    - "node:test + node:assert/strict with mkdtemp-isolated temp dirs"
key-files:
  created:
    - lib/repro/fixtures/match-key.mjs
    - lib/repro/fixtures/llm-record.mjs
    - lib/repro/fixtures/llm-replay.mjs
    - tests/repro/_fixtures/llm-complete.req.json
    - tests/repro/_fixtures/llm-complete.resp.json
    - tests/repro/_fixtures/transcript-fragment.jsonl
    - tests/repro/match-key.test.mjs
    - tests/repro/llm-record-replay.test.mjs
  modified: []
decisions:
  - "normalizeReq uses a deny-list of volatile keys (allow content by default) rather than an allow-list, so future content-affecting params are hashed automatically."
  - "Dropped `process` alongside subscription/provider as a routing/provider-selection hint (not request content) — the actual model is captured canonically and separately."
  - "matchKey hashes via a recursive stableStringify (keys sorted, array order preserved) so the key is robust to input key ordering, not just to the fixed field set."
  - "Composite key format `<sha256>#<ordinal>` maps to filename by replacing `#` (and any non [A-Za-z0-9._-]) with `_`; record and replay share the identical mapping."
metrics:
  duration: ~15m
  completed: 2026-07-02
  tasks: 3
  files: 8
  tests: 13
---

# Phase 67 Plan 01: Reproducibility Replay Rig — LLM Record/Replay Core Summary

The LLM channel's pure record/replay core is now importable and unit-tested with no live proxy daemon: the D-07 normalized-hash + per-key-ordinal match key, a best-effort fixture recorder, and a hard-fail-on-miss replay lookup — one shared hash implementation across record, replay, and (later) the proxy tap.

## What Was Built

- **`lib/repro/fixtures/match-key.mjs` (D-07)** — `normalizeReq(body)` strips volatile/routing fields (`task_id`, `subscription`, `request_id`/`trace_id`, `provider`/`providers`/hints, `process`, `timestamp`) and canonicalizes the model alias (trim + lowercase); `matchKey(normalized)` returns `"<sha256>#<ordinal>"` using a recursive `stableStringify` plus a module-level `Map<hash,count>` ordinal; `resetOrdinals()` clears the counters. Hashing mirrors the repo `crypto.createHash('sha256')…digest('hex')` idiom.
- **`lib/repro/fixtures/llm-record.mjs`** — `recordFixture(dir, key, resp)` writes exactly `{content,provider,model,tokens,latencyMs}` (+ optional `overheadMs`) under `<dir>/llm/`, wrapped in try/catch so a fixture write never breaks the LLM call (mirrors the `_tokenDb` best-effort contract).
- **`lib/repro/fixtures/llm-replay.mjs`** — `replayLookup(dir, key)` returns the parsed response on a hit or `null` on a miss (missing/unreadable/unparseable). It never falls through to a live/synthesized response — the D-06 hard-fail (409 REPLAY_MISS) is enforced by the proxy caller in Plan 06.
- **`tests/repro/_fixtures/`** — a synthetic `/api/complete` request/response pair and a redacted `WebSearch` transcript-JSONL fragment (also consumed by Plan 02).
- **Two node:test suites** — 13 tests total, all green: match-key stability/canonicalization/ordinal + record→replay byte-identical round-trip, miss→null, and best-effort-write proof.

Both `llm-record.mjs` and `llm-replay.mjs` import (and re-export) the key producers from `match-key.mjs`, guaranteeing a single hash implementation.

## TDD Gate Compliance

Each task followed RED → GREEN:
- RED: `test(67-01)` commit `ff00b4dda` — both suites authored and failing (modules absent).
- GREEN: `feat(67-01)` commit `e9f9ce39e` (match-key), then `feat(67-01)` commit `b266c2a45` (record + replay).

No REFACTOR commit was needed — implementations were clean on first green.

## Deviations from Plan

None — plan executed exactly as written. No architectural changes, no auto-fixes, no auth gates. No package-manager installs (phase is all Node built-ins / existing repo modules, per RESEARCH Package Legitimacy Audit).

## Verification

- `node --test tests/repro/match-key.test.mjs tests/repro/llm-record-replay.test.mjs` → 13 pass / 0 fail.
- `grep -rn "from 'node:test'" tests/repro/` → 2 (node:test convention, no jest).
- Exports confirmed: match-key `{normalizeReq,matchKey,resetOrdinals}`; llm-record adds `recordFixture`; llm-replay adds `replayLookup`; both link to match-key.mjs.
- `tests/repro/_fixtures/transcript-fragment.jsonl` contains no secret-shaped strings (`sk-`/`gho_`/`Bearer` scan clean); tokens redacted to `toolu_REDACTED01`.

## Threat Coverage

- **T-67-01-01 (Info Disclosure)** — mitigated: this plan writes no fixtures to tracked paths; all tests use `mkdtempSync` temp dirs removed in cleanup.
- **T-67-01-02 (false comparability)** — mitigated: `replayLookup` returns `null` on miss (round-trip test asserts miss→null); no live fallthrough.
- **T-67-01-03 / -SC** — accepted per plan (sha256, no package installs).

No new threat surface introduced beyond the plan's `<threat_model>`.

## Self-Check: PASSED

Created files verified present:
- FOUND: lib/repro/fixtures/match-key.mjs
- FOUND: lib/repro/fixtures/llm-record.mjs
- FOUND: lib/repro/fixtures/llm-replay.mjs
- FOUND: tests/repro/_fixtures/llm-complete.req.json
- FOUND: tests/repro/_fixtures/llm-complete.resp.json
- FOUND: tests/repro/_fixtures/transcript-fragment.jsonl
- FOUND: tests/repro/match-key.test.mjs
- FOUND: tests/repro/llm-record-replay.test.mjs

Commits verified present: ff00b4dda (RED tests), e9f9ce39e (match-key), b266c2a45 (record+replay).
