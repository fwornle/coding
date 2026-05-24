# MigrationScripts

**Type:** Detail

The MCP Constraint Monitor integration (`integrations/mcp-constraint-monitor/README.md`) provides the runtime monitoring layer that complements these scripts, catching violations introduced after migration in live code via Claude Code hook data described in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`.

# MigrationScripts

## What It Is

MigrationScripts are the executable mechanism documented in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` (the "Constraint Configuration Guide") that enforce fixed canonical type sets during schema or vocabulary changes. They function as the primary gating control for any modification to the controlled vocabulary used across the system, acting as a transformation-and-validation layer that runs as a required step whenever the canonical type space changes.

Operating as a child component of the ClosedVocabularyPattern, MigrationScripts implement the active enforcement side of that pattern. While their sibling component, CanonicalTypeSets, defines *what* identifiers are permissible (governed through the same `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` reference), MigrationScripts define *how* existing data and configuration are brought into compliance whenever those canonical sets evolve. Together, the two siblings form a complete declarative-plus-procedural enforcement model under the ClosedVocabularyPattern umbrella.

Concretely, every deprecated or non-canonical type encountered in existing configuration must be transformed into a valid canonical identifier — or explicitly rejected — before a migration is permitted to complete. This makes the scripts the choke point through which all vocabulary evolution must pass.

## Architecture and Design

The architecture follows a clear separation between *definition* and *enforcement*, with MigrationScripts playing the enforcement role within the ClosedVocabularyPattern. The design intentionally rejects an "open" vocabulary model: rather than allowing arbitrary type identifiers to accumulate and be cleaned up later, the system requires that any introduction or removal of a type identifier flow through a deliberate, scripted transformation step. This is a closed-world design choice that prioritizes consistency and auditability over flexibility.

A second architectural layer is provided by the MCP Constraint Monitor integration itself (`integrations/mcp-constraint-monitor/README.md`), which provides runtime monitoring that complements the static, migration-time enforcement of MigrationScripts. Where MigrationScripts catch vocabulary drift *before* it enters the persisted configuration, the runtime monitor catches violations introduced *after* migration in live code — using Claude Code hook data as described in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`. This pairing produces a two-phase defense: design-time gating via MigrationScripts and runtime detection via the constraint monitor.

The pattern is essentially a write-time validation gate combined with a read-time observability layer. Each phase covers a failure mode the other cannot: scripts cannot detect drift introduced by ad-hoc code paths that bypass migration, while runtime monitoring cannot prevent drift from being committed in the first place.

## Implementation Details

The implementation is centered on the constraint configuration model documented in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. MigrationScripts operate against this configuration during schema changes — when the canonical type set is altered, the migration step is required to run, scanning existing configuration for any type identifier that is no longer valid under the new canonical set. Each encountered non-canonical type must be explicitly mapped to a replacement (transformation) or marked for rejection.

Because the source observations do not enumerate specific script files, classes, or functions (no code symbols were identified for this entity), the implementation is best understood through its behavioral contract rather than a code surface: the scripts guarantee that, at the conclusion of a migration, no deprecated or non-canonical type remains in the system's persisted configuration. This guarantee is what enables downstream consumers to treat the CanonicalTypeSets as truly closed.

The mechanics depend on the Constraint Configuration Guide as the source of truth — the same document governs CanonicalTypeSets — meaning the scripts and the canonical definitions evolve in lockstep through a single authoritative reference. This avoids the common failure mode where vocabulary definitions live in one place and migration logic in another, allowing them to drift out of sync.

## Integration Points

MigrationScripts integrate with three primary points in the system. First and most directly, they integrate with their parent ClosedVocabularyPattern by providing the procedural enforcement that makes the pattern's closed-world guarantee real. Without the scripts running as a required step, the pattern would degrade into a documentation convention rather than an enforced contract.

Second, they integrate with their sibling CanonicalTypeSets through the shared `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` reference. The CanonicalTypeSets describe the permitted identifiers; MigrationScripts read those same definitions to determine what counts as a violation requiring transformation or rejection.

Third, they integrate with the broader MCP Constraint Monitor described in `integrations/mcp-constraint-monitor/README.md`, which provides the runtime monitoring counterpart. The hand-off is temporal: MigrationScripts own the migration moment, the constraint monitor owns everything after. The monitor consumes Claude Code hook data per the format specified in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`, allowing it to observe live code activity and flag any constraint violations that emerge between migrations.

## Usage Guidelines

Developers modifying canonical type sets must treat MigrationScripts as a non-optional step. Any change to the type vocabulary requires producing a corresponding migration that either transforms each existing non-canonical instance into a valid replacement or explicitly rejects it. Skipping this step is not merely a process violation — it breaks the closed-world guarantee that the ClosedVocabularyPattern depends on, and would allow deprecated types to silently persist in configuration.

When authoring a migration, consult the Constraint Configuration Guide at `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` as the single source of truth for which identifiers are permitted. Because the same guide governs CanonicalTypeSets, the migration and the canonical definition must be updated together — never independently — to keep the system consistent.

Developers should also remember that MigrationScripts do not catch *all* vocabulary drift. Violations introduced after a successful migration — for example, by code that constructs type identifiers dynamically — are the responsibility of the runtime MCP Constraint Monitor. When debugging a constraint violation, the question to ask first is whether the violation was committed at migration time (a MigrationScripts gap) or emerged at runtime (a monitor finding via Claude Code hook data). This division of responsibility should guide where remediation effort is invested.

---

### Summary of Requested Analysis

1. **Architectural patterns identified**: Closed-vocabulary enforcement via a gated transformation step; separation of declarative definition (CanonicalTypeSets) from procedural enforcement (MigrationScripts); two-phase defense pairing migration-time gating with runtime monitoring.

2. **Design decisions and trade-offs**: Choosing a closed-world model trades flexibility for consistency and auditability. Requiring scripts as a mandatory migration step trades developer velocity for the guarantee that drift cannot accumulate silently. Co-locating canonical definitions and migration logic in a single authoritative document trades distributed ownership for synchronization safety.

3. **System structure insights**: MigrationScripts are one of two child components under ClosedVocabularyPattern, paired with CanonicalTypeSets, and integrated with the broader MCP Constraint Monitor for runtime coverage.

4. **Scalability considerations**: The mandatory migration step adds friction proportional to vocabulary change frequency. The model scales well for vocabularies that evolve deliberately, less well for systems requiring rapid or experimental vocabulary changes. The single-document source of truth (`constraint-configuration.md`) may itself become a coordination bottleneck as vocabulary size grows.

5. **Maintainability assessment**: Strong — the explicit transform-or-reject contract makes vocabulary changes auditable, and the pairing with runtime monitoring ensures drift cannot persist undetected. The main maintenance risk is divergence between MigrationScripts and CanonicalTypeSets if updates are made without using the shared configuration guide as the entry point.


## Hierarchy Context

### Parent
- [ClosedVocabularyPattern](./ClosedVocabularyPattern.md) -- The migration scripts in integrations/mcp-constraint-monitor/docs/constraint-configuration.md enforce fixed canonical type sets

### Siblings
- [CanonicalTypeSets](./CanonicalTypeSets.md) -- Governed and documented in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` ('Constraint Configuration Guide'), which acts as the single authoritative reference for which type identifiers are permitted in the system.


---

*Generated from 3 observations*
