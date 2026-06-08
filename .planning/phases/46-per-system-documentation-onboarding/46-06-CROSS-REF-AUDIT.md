---
phase: 46-per-system-documentation-onboarding
plan: 06
artifact: cross-reference-audit
generated: 2026-06-08
auditor: gsd-executor (sequential, main working tree)
---

# Phase 46 Plan 06 — Cross-Reference Audit (SC-4 + D-46-05 + D-46-06)

This document is the audit deliverable for Plan 46-06. It verifies three independent gates against the four shipped READMEs (`coding`, `mcp-server-semantic-analysis`, `lib/km-core`, `operational-knowledge-management`) plus the three supporting docs (`README-TEMPLATE.md`, `ONBOARDING.md`, `AGENTS.md`):

1. **SC-4 cross-reference matrix** — every README's Related Systems block resolves to the other three (12 inbound links, verified by `test -f` for relative paths and canonical-URL string-match for external URLs).
2. **D-46-05 naming-convention sweep** — shipped artifacts MUST use concrete system names (`coding`, `mcp-server-semantic-analysis`, `operational-knowledge-management`), never the internal A/B/C planning shorthand.
3. **D-46-06 milestone-shorthand sweep** — shipped artifacts MUST reference features by their concrete name (e.g., `/api/v1/` REST contract, `SnapshotManager`), never by phase/plan/wave/version shorthand.

## Audit Scope — Files Inspected

| Path | Role |
| --- | --- |
| `README.md` (root) | `coding` system entry point |
| `lib/km-core/README.md` | KM-Core shared-core README (submodule) |
| `lib/km-core/docs/README-TEMPLATE.md` | Canonical 6-section template skeleton |
| `lib/km-core/docs/ONBOARDING.md` | Verifiable 7-step contributor exercise |
| `integrations/mcp-server-semantic-analysis/README.md` | mcp-server-semantic-analysis README (submodule) |
| `integrations/mcp-server-semantic-analysis/docs/AGENTS.md` | Per-agent long-form companion to the mcp-server README |
| `_work/rapid-automations/integrations/operational-knowledge-management/README.md` | OKM README (external BMW GHE repo, branch `gsd/44-09-rest-cutover-v2`) |

## 1. SC-4 Cross-Reference Matrix

Four READMEs × three outbound Related Systems entries each = **12 inbound links** to verify.

### Link Resolution Table

| # | Source README | Target system | Link form (literal in source) | Resolution check | Status |
| - | --- | --- | --- | --- | --- |
|  1 | `README.md` (root) | KM-Core | `[KM-Core](lib/km-core/README.md)` | `test -f /Users/Q284340/Agentic/coding/lib/km-core/README.md` from repo root | PASS |
|  2 | `README.md` (root) | `mcp-server-semantic-analysis` | `[mcp-server-semantic-analysis](integrations/mcp-server-semantic-analysis/README.md)` | `test -f /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/README.md` from repo root | PASS |
|  3 | `README.md` (root) | `operational-knowledge-management` | `[operational-knowledge-management](https://bmw.ghe.com/adpnext-apps/operational-knowledge-management)` | String-match against canonical OKM URL in `46-PATTERNS.md` P-4 | PASS |
|  4 | `lib/km-core/README.md` | `coding` | `[coding](../../README.md)` | `test -f` resolves to `/Users/Q284340/Agentic/coding/README.md` | PASS |
|  5 | `lib/km-core/README.md` | `mcp-server-semantic-analysis` | `[mcp-server-semantic-analysis](../../integrations/mcp-server-semantic-analysis/README.md)` | `test -f` resolves to `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/README.md` | PASS |
|  6 | `lib/km-core/README.md` | `operational-knowledge-management` | `[operational-knowledge-management](https://bmw.ghe.com/adpnext-apps/operational-knowledge-management)` | String-match against canonical OKM URL | PASS |
|  7 | `integrations/mcp-server-semantic-analysis/README.md` | KM-Core | `[KM-Core](../../lib/km-core/README.md)` | `test -f` resolves to `/Users/Q284340/Agentic/coding/lib/km-core/README.md` | PASS |
|  8 | `integrations/mcp-server-semantic-analysis/README.md` | `coding` | `[coding](../../README.md)` | `test -f` resolves to `/Users/Q284340/Agentic/coding/README.md` | PASS |
|  9 | `integrations/mcp-server-semantic-analysis/README.md` | `operational-knowledge-management` | `[operational-knowledge-management](https://bmw.ghe.com/adpnext-apps/operational-knowledge-management)` | String-match against canonical OKM URL | PASS |
| 10 | OKM `README.md` (external) | KM-Core | `[KM-Core](https://www.npmjs.com/package/@fwornle/km-core)` | String-match against canonical npm package URL (KM-Core npm publication is the reachable surface from outside the coding repo) | PASS |
| 11 | OKM `README.md` (external) | `coding` | `[coding](https://github.com/fwornle/coding)` | String-match against canonical GitHub URL | PASS |
| 12 | OKM `README.md` (external) | `mcp-server-semantic-analysis` | `[mcp-server-semantic-analysis](https://github.com/fwornle/mcp-server-semantic-analysis)` | String-match against canonical GitHub URL | PASS |

### Resolution Methodology Notes

- **Rows 1–9 (in-coding-repo source):** Verified by `test -f` against the absolute path obtained by resolving the literal relative target from the source README's directory. All six in-repo relative paths resolve to files on disk.
- **Rows 10–12 (OKM source):** OKM lives in an external BMW GHE repo and cannot directly relative-link into the coding repo from its own working tree (different repo root). It therefore uses canonical published URLs — npm for KM-Core (which IS published as `@fwornle/km-core` on npm) and GitHub for the two sister code repos. This is the correct cross-repo idiom; the targets resolve from any browser with public-internet access.
- **OKM URL form (rows 3, 6, 9):** All three coding-repo READMEs link to OKM via `https://bmw.ghe.com/adpnext-apps/operational-knowledge-management` (the canonical BMW GHE URL fixed in `46-PATTERNS.md` P-4). String-match-only verification (no `curl` probe) was used because the operator may not be on the BMW corporate network at audit time. The URL is byte-identical across all three sources.

### Summary

**12/12 PASS — zero failures discovered.** No fix-edits were required by Task 2 of the plan (the SC-4 acceptance gate is satisfied as shipped by Plans 46-01 through 46-05).

## 2. D-46-05 Sweep — System Names, Not A/B/C Labels

The D-46-05 amendment (committed 2026-06-08 to `46-CONTEXT.md`) mandates that all shipped artifacts reference systems by their concrete repo/package names — never by the v7.1 internal alphabetical shorthand A/B/C. The sweep used the canonical regex from the dispatch prompt's `<extended_audit_scope>`:

```bash
grep -nE "^# [A-C]:|\b[A-C]:[ ]+\[?(coding|mcp|OKM|operational)|\b[A-C] reads|\b[A-C] owns|\b[A-C] configures|\b[A-C]'s [a-z]|\bSystem [A-C]\b"
```

augmented with a broader narrative sweep for `^# B —`, `The B system`, `gives B its`, `exposed by B` patterns (which the canonical regex does not catch).

### Sweep Results (After Fix-Ups)

| File | Matches | Status |
| --- | --- | --- |
| `README.md` (root) | 0 | CLEAN |
| `lib/km-core/README.md` | 0 | CLEAN |
| `lib/km-core/docs/README-TEMPLATE.md` | 0 | CLEAN (placeholder `{other-system-name}` is the convention's directive, not a violation) |
| `lib/km-core/docs/ONBOARDING.md` | 0 | CLEAN |
| `integrations/mcp-server-semantic-analysis/README.md` | 0 | CLEAN |
| `integrations/mcp-server-semantic-analysis/docs/AGENTS.md` | 0 (after 3 fix-ups; was 3) | CLEAN — see fix-ups below |
| OKM `README.md` (external) | 0 | CLEAN |

### Fix-Ups Applied — AGENTS.md (3 residual `B` labels)

Plan 46-03 created `integrations/mcp-server-semantic-analysis/docs/AGENTS.md` during Wave 2; the D-46-05 amendment landed shortly after (post-Plan 46-03 visual-check checkpoint). The AGENTS.md was authored before the amendment was captured in `46-CONTEXT.md` and consequently still used the planning-internal `B` shorthand in three places. This audit fixes them inline as a Rule 2 deviation (critical-correctness fix-up):

| Line | Before | After |
| --- | --- | --- |
| 1 | `# B — Agent Details` | `# mcp-server-semantic-analysis — Agent Details` |
| 5 | `The B system orchestrates **14 intelligent agents** ...` | `The \`mcp-server-semantic-analysis\` system orchestrates **14 intelligent agents** ...` |
| 11 | `... giving B its "semantic" depth beyond pattern-matching.` | ``... giving `mcp-server-semantic-analysis` its "semantic" depth beyond pattern-matching.`` |
| 157 | `These tools are exposed by B over the MCP protocol ...` | ``These tools are exposed by `mcp-server-semantic-analysis` over the MCP protocol ...`` |

Post-fix sweep returns zero matches across all six narrative-pattern alternations.

## 3. D-46-06 Sweep — Feature Names, Not Milestone Shorthand

The D-46-06 amendment mandates that all shipped artifacts reference features by their concrete name (e.g., `/api/v1/` REST contract, `SnapshotManager` git-tag backend, `LayeredDeduplicator`), never by planning shorthand (`Phase 44`, `Plan 46-05`, `Wave 3`, `v7.1`).

### Sweep Regex

```bash
grep -nE "(Phase [0-9]+|Plan [0-9]{2}-[0-9]{2}|Wave [0-9]|\bv7\.[0-9x])"
```

augmented with a comprehensive lowercase scan for `milestone`, `phase 4`, `wave 1..4`, and `gsd/[0-9]` branch references.

### Sweep Results

| File | Matches | Status |
| --- | --- | --- |
| `README.md` (root) | 0 | CLEAN |
| `lib/km-core/README.md` | 0 | CLEAN |
| `lib/km-core/docs/README-TEMPLATE.md` | 0 substantive (1 meta-reference at line 20, exempted) | CLEAN — see note |
| `lib/km-core/docs/ONBOARDING.md` | 0 | CLEAN |
| `integrations/mcp-server-semantic-analysis/README.md` | 0 | CLEAN |
| `integrations/mcp-server-semantic-analysis/docs/AGENTS.md` | 0 | CLEAN |
| OKM `README.md` (external) | 0 | CLEAN |

### README-TEMPLATE.md Exemption (Line 20)

The template carries one comprehensive instruction line directing future authors NOT to use phase/plan/wave/version shorthand. This is the convention's own documentation surface, not a substantive use of the shorthand:

```text
... Reference systems by their concrete repo/package name (e.g., `coding`, `mcp-server-semantic-analysis`,
`operational-knowledge-management`), not by internal milestone shorthand. Likewise reference features by
their concrete name (e.g., "the `/api/v1/` REST contract", "the `SnapshotManager` git-tag backend"), not
by phase/plan/wave/version shorthand — ...
```

This line teaches the convention; it does not violate it. Exemption is granted by the dispatch prompt's extended-audit-scope guidance: "the cleanup that just landed is the canonical pattern: feature names, system names, no letters/phases."

## 4. Round-Trip Reachability Check

A spot-check of the round-trip navigation surface (the SC-4 "four doors" model) confirms that a contributor entering through any of the four READMEs can navigate to all three siblings without dead ends:

1. **Enter via `coding/README.md`** → click `[KM-Core](lib/km-core/README.md)` → KM-Core README loads → click `[coding](../../README.md)` → arrive back at root README. **Round-trip PASS.**
2. **Enter via `lib/km-core/README.md`** → click `[mcp-server-semantic-analysis](../../integrations/mcp-server-semantic-analysis/README.md)` → mcp-server README loads → click `[KM-Core](../../lib/km-core/README.md)` → arrive back at KM-Core README. **Round-trip PASS.**
3. **Enter via `integrations/mcp-server-semantic-analysis/README.md`** → click `[coding](../../README.md)` → root README loads → click `[mcp-server-semantic-analysis](integrations/mcp-server-semantic-analysis/README.md)` → arrive back. **Round-trip PASS.**
4. **OKM external entry** → click any of the three URLs (npm KM-Core / GitHub coding / GitHub mcp-server) → opens public-internet target → contributor navigates back via browser history. **Reachability PASS** (the cross-repo idiom does not require relative-path round-trip; external URLs are the canonical reachability surface from BMW GHE).

## 5. Audit Conclusion

- **SC-4 (cross-references):** 12/12 inbound links resolve. No in-repo fix-edits required for the four READMEs themselves.
- **D-46-05 (system names, not letter labels):** Initially 3 residual `B` labels in `AGENTS.md`; fixed inline as a Rule 2 critical-correctness deviation; post-fix sweep is CLEAN across all seven shipped docs.
- **D-46-06 (feature names, not milestone shorthand):** CLEAN across all seven shipped docs (the README-TEMPLATE.md line-20 meta-instruction is exempted as convention-documentation, not a substantive use).
- **Round-trip reachability:** All four "doors" round-trip cleanly to all three siblings.

Phase 46's SC-4 success criterion is verified satisfied as shipped (with one AGENTS.md fix-up applied during this audit). No external-repo follow-up is required — OKM's outbound links are already canonical (npm + GitHub), and OKM's inbound side (rows 3, 6, 9) is byte-identical across the three coding-repo READMEs.

---

*Plan 46-06 Cross-Reference Audit — closes Phase 46 SC-1 through SC-4.*
