# NamingConventions

**Type:** SubComponent

Because this is purely a naming heuristic, a developer searching for a 'NamingConventions.ts' file will find nothing; the actual pattern manifests only in the names chosen for classes like TranscriptAdapter or wave agent managers

# NamingConventions

## What It Is

NamingConventions is not implemented as a file, module, or class anywhere in the codebase—there is no `NamingConventions.ts` to inspect. Instead, it is a naming heuristic under which classes are classified by their suffix pattern (e.g., `*Manager`, `*Service`, `*Adapter`, `*Provider`) rather than by where they live in the directory tree. This makes classification name-driven rather than structure-driven: a `TranscriptAdapter` is understood as an adapter because of its name, not because it resides in an `adapters/` folder. As a SubComponent of CodingPatterns, it inherits the same character as its parent—a conceptual grouping label applied during architecture synthesis rather than an owned, browsable piece of code.

## Architecture and Design

The defining architectural decision here is that categorization happens **after the fact**. Per the parent CodingPatterns description, the suffix taxonomy is used retroactively to organize existing code rather than prescriptively guiding how code should be written up front. This is documented in docs/architecture/README.md, where the pattern is cited as the basis for grouping otherwise unrelated files into logical components during architecture synthesis—effectively a documentation-time abstraction layer rather than a runtime or build-time one.

![NamingConventions — Architecture](images/naming-conventions-architecture.png)

This retroactive, suffix-based approach mirrors the pattern seen in sibling AgentLifecyclePattern, which is likewise inferred from observed structural similarity rather than any shared interface or abstract class. Neither convention is enforced by the type system; both are emergent categorizations discovered by inspecting names and behaviors across the codebase rather than declared architectural contracts.

## Implementation Details

Because NamingConventions has zero associated code symbols and no key files, there is nothing to trace mechanically—the "implementation" is entirely the recurring choice of suffixes across the codebase. The clearest concrete instances come from the sibling AdapterPattern: `TranscriptAdapter` and `SpecstoryAdapter` both carry the `*Adapter` suffix and both convert external format-specific data into a common internal shape, making them the canonical examples of the naming heuristic being classified correctly. Similarly, wave agent managers are cited as examples of the `*Manager` suffix pattern. In all cases, the "implementation" is simply the developer's choice of class name at authoring time, later recognized as significant during architecture synthesis.

## Integration Points

![NamingConventions — Relationship](images/naming-conventions-relationship.png)

NamingConventions integrates with the rest of the system exclusively through documentation and analysis tooling: it is referenced in docs/architecture/README.md as a grouping mechanism for architecture synthesis docs. It has no runtime dependencies, no imports, and no compiled linkage to other components. Its only "interface" is the vocabulary of suffixes (`Manager`, `Service`, `Adapter`, `Provider`) that other subsystems—including AdapterPattern's `TranscriptAdapter`/`SpecstoryAdapter` and the wave/agent managers under AgentLifecyclePattern—happen to use, allowing architecture analysis to retroactively cluster them.

## Usage Guidelines

Since there is no dedicated enforcement mechanism—no linter rule or compiled constraint—the convention depends entirely on developer discipline and awareness. Developers should choose suffixes deliberately when naming new classes (`*Manager`, `*Service`, `*Adapter`, `*Provider`) since these names are the sole signal used during later architecture analysis to group related functionality. New contributors should not search for a "NamingConventions" module; instead, as with the parent CodingPatterns, they should consult CLAUDE.md and docs/architecture/ to understand how naming is used analytically. When introducing a new adapter-like class, following the precedent of `TranscriptAdapter`/`SpecstoryAdapter` (naming plus consistent external-to-internal conversion behavior) reinforces the convention's usefulness as a retroactive classification tool.


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- [LLM] CodingPatterns has no dedicated source directory or module of its own within the Coding project; it exists purely as a conceptual grouping label applied during component analysis to catch conventions that recur across many subsystems but are not owned by any single one. A new developer searching for 'CodingPatterns.ts' or 'patterns/' will find nothing—the actual pattern implementations live scattered inside the real subsystems (wave agents, adapters, managers) and are only retroactively categorized as 'CodingPatterns' during architecture synthesis. This means any onboarding effort to understand this component should redirect to CLAUDE.md and docs/architecture/ rather than expecting a browsable codebase location.

### Siblings
- [AgentLifecyclePattern](./AgentLifecyclePattern.md) -- The pattern is described as 'potentially used' by wave/agent components, indicating it was inferred from repeated structural similarity rather than a shared interface or abstract class
- [AdapterPattern](./AdapterPattern.md) -- TranscriptAdapter and SpecstoryAdapter are cited as concrete examples of this pattern, both converting external format-specific data into a common internal shape


---

*Generated from 5 observations*
