# Plan 44-16 — Wire-Shape Audit (Task 1)

**Date:** 2026-06-07
**Goal:** Ratify camelCase as the canonical wire shape for `/api/coding/{digests,insights}` before locking the contract in Tasks 2–3.

## TL;DR

- **Zero** snake_case reader sites in dashboard production code.
- **One** snake_case mention in a code comment (`insights.tsx:173` — conceptual reference to the SQL column name, NOT a reader).
- **17** camelCase reader sites in dashboard production code that depend on the current adapter output.
- **Migration script** confirms storage stays snake_case (`observation_ids`, `files_touched`, `digest_ids`, `last_updated` come from SQLite column names verbatim).
- **Decision:** lock camelCase. No dashboard rewrite required.

---

## 1. Dashboard reader sites verified (snake_case scan)

Command:

```bash
grep -rnE 'observation_ids|files_touched|digest_ids|last_updated' \
  integrations/system-health-dashboard/src \
  --include='*.ts' --include='*.tsx' | grep -v test
```

Output:

```text
integrations/system-health-dashboard/src/pages/insights.tsx:173:  //     changed since last_updated. Pure age does NOT decay confidence
```

**One match — a code comment.** Reading `insights.tsx:173` context, the comment explains the staleness-decay design and references the SQL column name `last_updated` as a historical attribution, not a JS field access. The actual reader four lines below uses `insight.lastUpdated` (camelCase, line 467).

**Verdict:** zero production-code snake_case readers. Dashboard is camelCase-only.

---

## 2. Adapter wire-shape map

Command:

```bash
grep -nE 'observationIds|filesTouched|digestIds|lastUpdated|createdAt' \
  lib/km-core/src/adapters/observation-view.ts
```

Output (truncated to material lines):

```text
74: * `observation_ids AS observationIds`, `files_touched AS filesTouched`,
75: * `created_at AS createdAt`. The dashboard at :3032 reads the camelCase
84:  observationIds: string[];
86:  filesTouched: string[];
88:  createdAt: string;
95: * SELECT block, which used SQL column aliases `digest_ids AS digestIds`,
96: * `last_updated AS lastUpdated`, `created_at AS createdAt`. The dashboard
105:  digestIds: string[];
106:  lastUpdated: string;
107:  createdAt: string;
193:    observationIds: Array.isArray(m.observation_ids)
197:    filesTouched: Array.isArray(m.files_touched)
201:    createdAt:
220: *   - digestIds   = metadata.digest_ids (when an array) or []
221: *   - lastUpdated = metadata.last_updated or entity.validFrom or ''
```

**Adapter contract (current, post-Plan-44-05):**

| Resource | Wire key | Source field in `metadata` (snake_case stored) |
|----------|----------|------------------------------------------------|
| Digest | `observationIds` | `metadata.observation_ids` |
| Digest | `filesTouched` | `metadata.files_touched` |
| Digest | `createdAt` | `metadata.createdAt` (already camelCase in storage) or `entity.validFrom` |
| Digest | `agents` | `metadata.agents` (unchanged) |
| Digest | `date`, `theme`, `summary`, `quality`, `project` | single-word, unchanged |
| Insight | `digestIds` | `metadata.digest_ids` |
| Insight | `lastUpdated` | `metadata.last_updated` |
| Insight | `createdAt` | `metadata.createdAt` (already camelCase in storage) or `entity.validFrom` |
| Insight | `topic`, `summary`, `confidence`, `project` | single-word, unchanged |
| Observation | `session_id` | `metadata.session_id` (passthrough — both stored AND wire are snake_case) |
| Observation | `id`, `agent`, `project`, `content`, `artifacts`, `timestamp`, `quality` | single-word, unchanged |

The adapter is the case-shift boundary: storage stays snake_case (legacy SQLite + migration inheritance), wire goes camelCase (matches pre-cutover SQL-alias contract + dashboard consumer expectations).

`session_id` is the lone snake_case wire key on Observation. The pre-cutover SQL handler did NOT alias it (the column was already `session_id` and rode through unchanged); Plan 44-16 preserves this exception verbatim.

---

## 3. Storage shape preservation (snake_case stays in metadata)

Command (A-side migration):

```bash
grep -nE "observation_ids|files_touched|digest_ids|last_updated" \
  scripts/migrate-sqlite-to-kmcore.mjs
```

Output:

```text
301:    'SELECT id, date, theme, summary, observation_ids, agents, ' +
302:      'files_touched, quality, created_at, metadata, project FROM digests',
306:    'SELECT id, topic, summary, confidence, digest_ids, ' +
307:      'last_updated, created_at, metadata, project FROM insights',
```

Migration reads SQLite columns named `observation_ids`, `files_touched`, `digest_ids`, `last_updated` and writes them into km-core `metadata.*` fields under the same names. **Storage stays snake_case** — the adapter is the only case-shift point.

Command (B-side migration):

```bash
grep -rnE "observation_ids|files_touched|digest_ids|last_updated" \
  integrations/mcp-server-semantic-analysis/scripts/
```

Output:

```text
integrations/mcp-server-semantic-analysis/scripts/migrate-leveldb-to-kmcore.mjs:200:/** Rows 7-8: metadata.created_at → createdAt + validFrom; last_updated →
integrations/mcp-server-semantic-analysis/scripts/migrate-leveldb-to-kmcore.mjs:205:  const metaUpdated = source?.metadata?.last_updated ?? source?.metadata?.last_modified;
integrations/mcp-server-semantic-analysis/scripts/migrate-leveldb-to-kmcore.mjs:207:  const flatUpdated = source?.last_updated ?? source?.last_modified;
```

B-side migration confirms the same pattern: source LevelDB stores `metadata.last_updated` snake_case; the adapter reshapes on read.

---

## 4. Total camelCase reader sites in dashboard

Command:

```bash
grep -rnE 'observationIds|filesTouched|digestIds|lastUpdated' \
  integrations/system-health-dashboard/src \
  --include='*.ts' --include='*.tsx' | grep -v test | wc -l
```

Output: **17**

Concrete reader sites (from earlier grep, truncated to material ones):

| File | Line | Field read |
|------|------|------------|
| `src/pages/digests.tsx` | 19 | `observationIds: string[]` (TS type) |
| `src/pages/digests.tsx` | 21 | `filesTouched: string[]` (TS type) |
| `src/pages/digests.tsx` | 45 | `digest.filesTouched.join(', ')` |
| `src/pages/digests.tsx` | 62 | `digest.observationIds.length` |
| `src/pages/digests.tsx` | 75 | `digest.filesTouched.length > 0` |
| `src/pages/digests.tsx` | 80-81 | `digest.filesTouched.slice(0, 5)` |
| `src/pages/insights.tsx` | 59 | `digestIds: string[]` (TS type) |
| `src/pages/insights.tsx` | 60 | `lastUpdated: string` (TS type) |
| `src/pages/insights.tsx` | 317 | `lastUpdated: string` (TS type, second decl) |
| `src/pages/insights.tsx` | 467 | `new Date(insight.lastUpdated)` |
| `src/pages/insights.tsx` | 485 | `insight.digestIds.length` |
| `src/pages/insights.tsx` | 756 | `lastUpdated: resp.lastUpdated` |
| `src/pages/coverage.tsx` | 20 | `lastUpdated: string` (TS type) |
| `src/store/slices/ukbSlice.ts` | 322 | `lastUpdated: string` (TS type) |
| `src/components/markdown-text.tsx` | 17 | doc-comment mentioning `filesTouched` |

All 17 reads expect camelCase. Switching the wire to snake_case would require coordinated edits to every file above + a dashboard rebuild + a deploy cycle, with high risk of missing a downstream slice or selector.

---

## 5. Decision narrative

Four pieces of evidence converge on camelCase:

1. **Pre-cutover SQLite handler** explicitly aliased columns to camelCase before serialization (documented inline at `observation-view.ts:74-75,95-96`). Dashboard at :3032 has been reading camelCase since before Phase 44 started.

2. **17 dashboard reader sites** consume camelCase verbatim. None reach for snake_case. A wire-shape swap would require coordinated multi-file edits + a deploy cycle + carries high risk of missed reader.

3. **Post-Plan-44-05 adapter** emits camelCase by design. The shape was deliberate, not accidental — the JSDoc cites the SQL-alias inheritance as the rationale.

4. **The Wave 0 RED stub** (`tests/integration/typed-views.test.js`, authored pre-Plan-44-07) asserted snake_case based on the SQL column names alone, **without consulting the SQL-alias contract**. Its `REQUIRED_DIGEST_KEYS` + `REQUIRED_INSIGHT_KEYS` lists were a spec error. The test was written RED with the expectation it would go GREEN after the endpoints landed — but its assertions were never validated against the actual production wire shape that pre-existed Phase 44.

**Decision: lock camelCase as the canonical wire shape for `/api/coding/{digests,insights}`.**

Dual-emit (additive snake_case aliases) was considered:

- **Cost:** 5 extra string keys per row (~10% bytes-on-wire on a hot endpoint).
- **Benefit:** zero consumer breakage either direction.
- **Verdict:** rejected. The 17 dashboard readers already pin camelCase. The single Python-consumer hypothetical doesn't exist yet. Adding 5 extra keys defers the decision instead of resolving it, and projects the same case-shift complexity to a future planner. Single-shape contract is cleaner. See plan threat T-44-16-01.

**Tasks 2–3 ratify the lock:**

- Task 2: rewrite `tests/integration/typed-views.test.js` REQUIRED_DIGEST_KEYS + REQUIRED_INSIGHT_KEYS to camelCase. Observations test unchanged (already conforms).
- Task 3: land a load-bearing `LOCKED contract` comment block above `digestToLegacy` + `insightToLegacy` in `observation-view.ts`; write `44-CONTEXT-amendment-4.md` ratifying the choice and correcting Pitfall 2 wording.

After this audit + Tasks 2–3, three independent ratification sites exist (test + adapter comment + amendment), making accidental drift hard.
