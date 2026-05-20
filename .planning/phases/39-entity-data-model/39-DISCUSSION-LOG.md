# Phase 39: Entity Data Model - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 39-entity-data-model
**Areas discussed:** Writer-side stamping, Supersession semantics, Backfill mechanics, Per-segment provenance writer

---

## Writer-Side Stamping

### Q1: How should validFrom, createdAt, and provenance (createdBy/lastConfirmedBy) get populated on putEntity?

| Option | Description | Selected |
|--------|-------------|----------|
| Store auto-stamps; caller provides ProvenanceStamp source | GraphKMStore.putEntity auto-stamps validFrom + confirmationCount; caller MUST supply createdBy ProvenanceStamp | ✓ |
| Store auto-stamps everything from constructor context | Constructor receives provenance once; putEntity reads from store | |
| Caller stamps everything; store validates | putEntity requires validFrom + createdBy in input; throws if missing | |

**User's choice:** Store auto-stamps; caller provides ProvenanceStamp source.
**Captured as:** D-30.

### Q2: Should the optional fields (validFrom?, validUntil?, supersedes?) become REQUIRED on the canonical Entity type after Phase 39?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep optional on type; enforce at writer | Entity.validFrom stays validFrom?; writer stamps if missing. No breaking change to Phase 37 callers. | ✓ |
| Make validFrom required, validUntil/supersedes optional | Small breaking change but type-level guarantees match SC literally | |
| Make all three required with a dedicated 'StoredEntity' subtype | Cleanest type model but doubles the surface | |

**User's choice:** Keep optional on type; enforce at writer.
**Captured as:** D-31.

### Q3: When a putEntity confirms an existing entity (same id, second write), what should happen to lastConfirmedBy and confirmationCount?

| Option | Description | Selected |
|--------|-------------|----------|
| Store auto-bumps; caller provides confirming ProvenanceStamp | Same putEntity call; store decides create vs confirm by id existence | ✓ |
| Caller decides via explicit 'create' vs 'confirm' methods | Two methods: putEntity + confirmEntity. Doubles surface | |
| Single putEntity, caller controls provenance entirely | Caller reads existing, computes new fields, writes back | |

**User's choice:** Store auto-bumps; caller provides confirming ProvenanceStamp.
**Captured as:** D-32.

---

## Supersession Semantics

### Q1: When putEntity is called with supersedes: someOldId, what happens to the OLD entity's validUntil?

| Option | Description | Selected |
|--------|-------------|----------|
| Store auto-sets old.validUntil = new.validFrom | Atomic batch op: writes new and updates old in one operation | ✓ |
| Caller does both writes explicitly | Caller must explicitly putEntity({ ...oldEntity, validUntil }) | |
| Store auto-sets but emits warning if old.validUntil already set | Same as recommended, with stderr warning on overwrite | |

**User's choice:** Store auto-sets old.validUntil = new.validFrom.
**Captured as:** D-33. (Note: also kept the validUntil-overwrite stderr warning from option 3 as a safety net.)

### Q2: Do default queries (getEntity, findByOntologyClass, iterate) include superseded entities, or only active ones?

| Option | Description | Selected |
|--------|-------------|----------|
| Default to ACTIVE only; add { includeSuperseded: true } opt-in | List queries filter validUntil <= now by default; explicit lookup unaffected | ✓ |
| Default to ALL entities; opt-in to active-only filter | Backwards-compatible but risks stale data in consumers | |
| Default to ALL, but include a separate findActive* method family | Phase 37 methods unchanged; doubles method surface | |

**User's choice:** Default to ACTIVE only; add { includeSuperseded: true } opt-in.
**Captured as:** D-34.

### Q3: What's the supersession-chain query API shape?

| Option | Description | Selected |
|--------|-------------|----------|
| Single getSupersessionChain(id): Promise<Entity[]> walks both directions | Returns full chain from origin to current, ordered by validFrom | ✓ |
| Two methods: getPredecessors(id) + getSuccessors(id) | More flexible; doubles surface | |
| Expose chain as a property: entity.lineage on read | Heavier reads; risk of unbounded payload | |

**User's choice:** Single getSupersessionChain(id) walks both directions.
**Captured as:** D-35.

---

## Backfill Mechanics

### Q1: How should the backfill operation be shipped — where does it run, who invokes it?

| Option | Description | Selected |
|--------|-------------|----------|
| Library function in km-core; per-system scripts invoke it | Per-system scripts call backfillEntityDataModel(store, options) | ✓ |
| Auto-migrate at store.open() if any entity is missing validFrom | Surprise long-running migration on cold start; hard to dry-run | |
| Standalone CLI tool: npx km-core backfill --system=A | Operator-friendly but reopens D-06 (no bin/ entry) | |

**User's choice:** Library function in km-core; per-system scripts invoke it.
**Captured as:** D-36.

### Q2: How does the backfill detect 'legacy' entities to stamp, and how does it stamp legacyId?

| Option | Description | Selected |
|--------|-------------|----------|
| Missing validFrom = legacy; per-system resolver provides legacyId mapping | Caller passes resolver (entity) => { validFrom, legacyId? } | ✓ |
| Missing validFrom OR missing legacyId = legacy | Broader detection; marginal benefit | |
| Explicit list of legacy ids passed in by caller | Operator-controlled but requires pre-computed list | |

**User's choice:** Missing validFrom = legacy; per-system resolver provides legacyId mapping.
**Captured as:** D-37.

### Q3: What's the backfill's transactional contract — batch atomicity, dry-run, partial-failure recovery?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-entity write + checkpoint file; resumable on crash | Each putEntity atomic; checkpoint file tracks last id; supports dryRun | ✓ |
| Single all-or-nothing batch via store.batch(ops[]) | Maps to LevelDB atomic batch; memory blow-up risk on large stores | |
| Streaming with periodic store.batch flushes (every N entities) | Faster than per-entity; loses fine-grained checkpoint resolution | |

**User's choice:** Per-entity write + checkpoint file; resumable on crash.
**Captured as:** D-38.

---

## Per-Segment Provenance Writer

### Q1: Who detects 'identical text → append confirmation' instead of creating a new DescriptionSegment, and where does that logic live?

| Option | Description | Selected |
|--------|-------------|----------|
| Helper function in km-core; caller invokes before store write | mergeDescriptionSegment(entity, newSegment): Entity pure function | ✓ |
| Store auto-merges inside putEntity when called with a segment: DescriptionSegment opt-in | Couples Phase 39 logic into Phase 37 API | |
| Ingest pipeline handles entirely; km-core only ships the type | Risks divergence across A/B/C | |

**User's choice:** Helper function in km-core; caller invokes before store write.
**Captured as:** D-39.

### Q2: What counts as 'identical text' for confirmation matching?

| Option | Description | Selected |
|--------|-------------|----------|
| Whitespace-normalized + case-sensitive | normalize(s) = s.trim().replace(/\s+/g, ' '); case preserved | ✓ |
| Exact match (===) | Strict byte equality; misses trailing whitespace differences | |
| Whitespace + case-insensitive | Risks merging semantically distinct text (CSS vs css in code) | |

**User's choice:** Whitespace-normalized + case-sensitive.
**Captured as:** D-40.

### Q3: Is there a cap on the number of DescriptionSegments OR confirmations[] per segment? What happens at the cap?

| Option | Description | Selected |
|--------|-------------|----------|
| No hard cap in Phase 39; monitoring only | Stderr warning at 100 segments or 50 confirmations; pruning deferred | ✓ |
| Cap at 50 segments / 20 confirmations; evict oldest | Hard caps with FIFO eviction; magic numbers picked too early | |
| Cap on segments only (max 30), confirmations unbounded | Half-measure; still premature on numbers | |

**User's choice:** No hard cap in Phase 39; monitoring only.
**Captured as:** D-41.

---

## Claude's Discretion

- Internal helper file layout, test file structure.
- ID/key naming for the reverse-supersedes index in Graphology.
- Exact JSDoc and code-comment wording (subject to TS-strict + no-console-log).
- Whether the backfill checkpoint file is JSON or JSON Lines.

## Deferred Ideas

- Pruning policy for DescriptionSegments and confirmations (revisit when warning fires).
- Relation-level temporal supersession (`Relation.supersedes`) — not needed in v0.1.
- `ResolutionRecord` populator — belongs in Phase 40 PIPE-02.
- B's `SharedMemoryEntity` replacement — Phase 42 (INT-02) owns the swap.
- Backfill CLI binary — would reopen D-06 (library-only).
