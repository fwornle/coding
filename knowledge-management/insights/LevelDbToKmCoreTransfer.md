# LevelDbToKmCoreTransfer

**Type:** Detail

The parent analysis attributes dry-run flag, idempotency checks, and error-budget enforcement to this same file, meaning the safety controls and the transfer logic are co-located rather than split into separate modules—a design that simplifies invocation but increases the file's responsibility surface.

# LevelDbToKmCoreTransfer — Technical Insight Document

## What It Is

`LevelDbToKmCoreTransfer` is implemented at `scripts/migrate-leveldb-to-kmcore.mjs`, a standalone migration script responsible for moving knowledge records from a LevelDB source store into the KmCore target system. It is a Detail-level component within the broader `KnowledgeMigration` parent, which groups one-off data migration utilities that retroactively reshape persisted knowledge data.

The `.mjs` extension is significant: it explicitly opts the file into Node.js ES module semantics. This means imports are resolved as ESM by default, and any CommonJS dependencies must be brought in via dynamic `import()` or interop wrappers. This choice constrains the toolchain used to execute the migration and indicates a deliberate alignment with modern module syntax.

Operationally, the script performs a record-by-record transfer from LevelDB into KmCore, co-locating its safety controls (dry-run mode, idempotency checks, and error-budget enforcement) with the transfer logic itself in the same file.

## Architecture and Design

The architectural approach is a **single-file migration script** pattern. Rather than decomposing the transfer pipeline into multiple modules (e.g., separate reader, transformer, writer, and policy enforcer files), `LevelDbToKmCoreTransfer` consolidates the entire workflow inside `scripts/migrate-leveldb-to-kmcore.mjs`. This is a conscious trade-off: the script is easier to invoke and reason about as a self-contained unit, but its single-file responsibility surface is larger than a layered design would produce.

The core processing model is **sequential, record-by-record iteration** rather than bulk batch transfer. This pattern enables per-entry error handling — each record can succeed or fail independently, and the error-budget mechanism can count failures incrementally and abort cleanly once a threshold is crossed. Bulk transfer would force an all-or-nothing posture that is risky against potentially large or partially malformed LevelDB datasets.

The script combines three orthogonal safety controls in one place:
- **Dry-run flag**: allows a full read/transform pass without committing writes to KmCore, enabling validation of the migration plan before mutation.
- **Idempotency checks**: prevent duplicate insertion if the script is re-run, so that resumption and retries are safe.
- **Error-budget enforcement**: tolerates a bounded number of per-record failures before aborting, balancing strict correctness against the realities of legacy data <USER_ID_REDACTED>.

This co-location reflects a "migration-as-disposable-tool" philosophy: the script is meant to be run a small number of times and then archived, so the overhead of splitting it into reusable libraries is not justified.

## Implementation Details

The implementation centers on driving a LevelDB cursor or iterator that yields entries one at a time, transforming each entry into the KmCore representation, and writing it to the destination. Because the observations describe sequential processing, the loop body is the natural place where the safety controls are interleaved:

1. **Read** the next LevelDB record.
2. **Idempotency check** — query KmCore (or consult a local marker) to determine whether the record has already been migrated; skip if so.
3. **Transform** the record into KmCore's expected shape.
4. **Dry-run gate** — if the flag is set, log the intended write and continue without mutating KmCore; otherwise persist the record.
5. **Error handling** — catch per-record exceptions, increment the failure counter, and compare it against the configured error budget. Exceed the budget and the script aborts; remain within it and processing continues.

Because the file uses ESM syntax (`.mjs`), any LevelDB client library or KmCore SDK that ships only as CommonJS must be loaded with care — typically via top-level `import` of ESM-compatible distributions, or `createRequire` / dynamic `import()` when only CJS is available. This is a real toolchain consideration during migration runs.

The code symbol surface is currently not indexed (0 symbols found), which is consistent with a script-style file where logic lives in top-level statements and small helper functions rather than exported classes.

## Integration Points

`LevelDbToKmCoreTransfer` sits between two persistence systems:

- **Source**: A LevelDB store containing the legacy knowledge records. The script must understand the LevelDB key/value encoding conventions used by the prior system.
- **Sink**: The KmCore system, which is the canonical target for knowledge records going forward. The script depends on whatever client interface KmCore exposes for record creation and idempotency lookup.

Within the project's component hierarchy, this script is one of two siblings under `KnowledgeMigration`. The other sibling, `EntityTypeConsolidation` at `scripts/migrate-graph-db-entity-types.js`, performs a conceptually distinct task: normalizing entity type values to the canonical `System` / `Project` / `Pattern` set inside an already-populated graph DB. Where `EntityTypeConsolidation` operates post-write on live or snapshot data, `LevelDbToKmCoreTransfer` operates **at the boundary** between two stores, moving records from one system into another. Both, however, share the script-style, single-file conventions of the `KnowledgeMigration` parent — they are invoked from the `scripts/` directory and are designed for occasional, deliberate execution rather than continuous service.

Notably, the two siblings differ in module system: `LevelDbToKmCoreTransfer` is `.mjs` (ESM) while `EntityTypeConsolidation` is `.js` (default Node resolution). Developers should not assume uniformity across the migration scripts directory.

## Usage Guidelines

When running or extending `LevelDbToKmCoreTransfer`, observe the following conventions:

- **Always perform a dry run first.** Invoke the script with its dry-run flag to validate that the source records are readable, that transformations succeed, and that no obvious schema mismatches exist before any KmCore writes occur.
- **Set the error budget intentionally.** A budget of zero enforces strict correctness; a non-zero budget acknowledges that some legacy records may be unrecoverable. Choose a value that reflects the known <USER_ID_REDACTED> of the LevelDB dataset and document the rationale.
- **Rely on idempotency for resumption.** If the script aborts (whether from exceeding the error budget or external interruption), it is safe to re-run because the idempotency checks will skip already-transferred records. Do not introduce shortcuts that bypass these checks.
- **Respect the ESM constraint.** When modifying the script, remember that it executes as an ES module. Imports of CommonJS-only libraries require interop handling. Do not casually convert it to `.js` without auditing the implications for the Node version and tooling in use.
- **Keep the single-file design unless complexity demands otherwise.** The co-location of transfer logic and safety controls is deliberate. Splitting the file is only justified if the same primitives need to be reused — and in that case, consider promoting shared logic into a `KnowledgeMigration`-level utility consumed by both `LevelDbToKmCoreTransfer` and `EntityTypeConsolidation`.
- **Treat the script as disposable but auditable.** Once the migration is complete, the script's value is primarily as a historical record of how data was reshaped. Keep it in `scripts/` with sufficient inline documentation that a future engineer can reconstruct what was done and why.

---

### Summary of Architectural Assessment

1. **Architectural patterns identified**: Single-file migration script; sequential record-by-record processing; co-located safety controls (dry-run, idempotency, error budget).
2. **Design decisions and trade-offs**: ESM (`.mjs`) over CJS for modern syntax at the cost of CJS interop friction; consolidated responsibility surface for ease of invocation at the cost of larger file scope; per-record processing for resilience at the cost of throughput compared to bulk operations.
3. **System structure insights**: Acts as a boundary component between LevelDB and KmCore, distinct from its sibling `EntityTypeConsolidation` which operates within a single store; both live under the `KnowledgeMigration` umbrella in `scripts/`.
4. **Scalability considerations**: Sequential processing limits throughput; for very large LevelDB datasets, the script's runtime scales linearly with record count. Idempotency makes long runs interruptible and resumable, partially mitigating duration risk.
5. **Maintainability assessment**: The single-file design is appropriate for a disposable migration tool but concentrates responsibility; the absence of indexed code symbols suggests logic lives at the top level and may benefit from light internal structuring (named helper functions) for future readability without abandoning the single-file convention.


## Hierarchy Context

### Parent
- [KnowledgeMigration](./KnowledgeMigration.md) -- scripts/migrate-graph-db-entity-types.js consolidates entity types to a canonical three-value set (System/Project/Pattern), indicating the graph schema has undergone at least one breaking taxonomy change that required a retroactive data migration

### Siblings
- [EntityTypeConsolidation](./EntityTypeConsolidation.md) -- Resides at scripts/migrate-graph-db-entity-types.js (per SubComponent hierarchy context); its sole purpose is normalizing entity type values already stored in the graph DB, meaning it operates post-write on live or snapshot data rather than at ingestion time.


---

*Generated from 3 observations*
