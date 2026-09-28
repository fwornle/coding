# TeamDirectoryMapping

**Type:** Detail

## What It Is

`TeamDirectoryMapping` is not a standalone module but a specific data structure: the `teamDirectories` private field declared in the constructor of `src/ontology/heuristics/EntityPatternAnalyzer.ts`. It is a hardcoded `Map<string, string[]>` with four keys — Coding, RaaS, ReSi, UI — each mapping to a flat array of directory-prefix strings (e.g., Coding → `src/ontology`, `src/knowledge-management`, `src/live-logging`, `scripts`, `.specstory`). It exists to answer one question: given an extracted artifact string, which team owns it, by virtue of where it lives.

## Architecture and Design

This mapping realizes the "known location beats plausible name" policy described by its parent, `EntityTeamOwnershipHeuristics`. Within `analyzeEntityPatterns()`, each artifact produced by sibling component ArtifactExtraction (`extractArtifacts()`) is checked first via `checkLocalArtifact()` against `teamDirectories` (confidence 0.9), and only on failure falls through to the sibling `ArtifactPatternMatching` branch, `matchArtifactPattern()` (confidence 0.75). This is a two-tier confidence heuristic implemented purely through loop order and early return — there is no explicit priority field, just structural privileging. The overall design is a Static Map-as-lookup-table pattern: no external config, no persistence, no reload path, constructor-initialized and immutable for the analyzer instance's lifetime.

## Implementation Details

`checkLocalArtifact()` iterates `teamDirectories.entries()` and tests `dirs.some((dir) => artifact.startsWith(dir))` — a plain string-prefix test with no path-segment boundary awareness, so `scripts-legacy/` would falsely match `scripts`. The candidates it tests come from ArtifactExtraction's `dirPattern` regex and three other regex passes, unioned into one `Set`, meaning `teamDirectories` prefixes are checked against directories, file paths, npm packages, and class names alike — a full file path like `src/ontology/types.ts` will match the same prefix as a bare directory, so specificity is a byproduct of upstream extraction, not enforced here. Team coverage is asymmetric: Coding has 5 heterogeneous entries (mixing top-level dirs and dotfiles), while RaaS, ReSi, and UI each have exactly 3 flat single-segment names, biasing match likelihood toward Coding independent of actual code ownership. Match results supply only `team`; the associated `entityClass` is derived separately by `inferEntityClass()`, which maintains its own independent `teamMappings` table — one that includes an 'Agentic' team (Agent/RAG/LLM/Vector prefixes) absent from `teamDirectories` and `artifactPatterns`, making that branch unreachable dead code and evidencing drift between the two team-truth sources.

## Integration Points

`teamDirectories` is consumed exclusively by `checkLocalArtifact()`, which is invoked by `analyzeEntityPatterns()` ahead of the pattern-matching fallback implemented in sibling ArtifactPatternMatching. Its inputs come from sibling ArtifactExtraction's `extractArtifacts()`, whose four sequential regex passes (file paths, npm packages, class names, directories) determine `Set` insertion order and thus which artifact shapes reach the mapping first. There is no reconciliation hook with any external authoritative source (e.g., a CODEOWNERS-style record) — per the Metadata Merge Bug pattern, `checkLocalArtifact()` simply returns whichever team's Map entry matches first in insertion order (Coding, RaaS, ReSi, UI), with no conflict detection across teams.

## Usage Guidelines

Treat `teamDirectories` as an authoritative-but-brittle source: adding new directories for a team requires updating this Map directly, and any addition should be checked against existing entries for accidental prefix collisions given the plain `startsWith()` semantics. Any new team must be added consistently across `teamDirectories`, `artifactPatterns`, and `inferEntityClass()`'s `teamMappings` — the orphaned 'Agentic' entry demonstrates the cost of updating only one. Because Coding's disproportionate entry count skews confidence-0.9 matches in its favor, changes affecting match-rate evaluation should account for this imbalance, and per the KB Architecture Audit's audit-before-write discipline, no evaluation harness currently guards against this bias.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Metadata Merge Bug — Destructive Overwrite Pattern record's warning about un-reconciled authoritative sources applies concretely to `teamDirectories`: it is a compile-time-hardcoded `Map` with no persistence, versioning, or merge path visible in this file, so any external process that also assigns team ownership to the same directories (e.g. a manually curated CODEOWNERS-style record) would have no reconciliation hook here — `checkLocalArtifact()` simply returns whichever team's prefix matches first in Map insertion order (Coding, then RaaS, then ReSi, then UI), with no conflict detection if two teams' entries ever overlapped.

## Hierarchy Context

### Parent
- [EntityTeamOwnershipHeuristics](./EntityTeamOwnershipHeuristics.md) -- [LLM] src/ontology/heuristics/EntityPatternAnalyzer.ts implements the actual 'Layer 1: File/Artifact Detection' stage of EntityTeamOwnershipHeuristics, per its own header comment. analyzeEntityPatterns() runs a two-step check per extracted artifact: checkLocalArtifact() first looks for a direct prefix match against a hardcoded teamDirectories Map (Coding → src/ontology, src/knowledge-management, src/live-logging, scripts, .specstory; RaaS → raas-service, orchestration-engine, event-mesh; ReSi → virtual-target, embedded-functions, reprocessing-engine; UI → curriculum-alignment, aws-lambda, multi-agent-system), returning confidence 0.9. Only if that fails does matchArtifactPattern() fall back to a per-team array of naming-convention regexes (e.g. /LSL(Session|Monitor|Classifier)/i for Coding, /Kubernetes(Cluster|Pod|Service)/i for RaaS) at confidence 0.75 — a deliberate 'known location beats plausible name' ordering.

### Siblings
- [ArtifactPatternMatching](./ArtifactPatternMatching.md) -- [LLM] The supplied code implements the underlying EntityPatternAnalyzer class (Layer 1 of EntityTeamOwnershipHeuristics), but there is no distinct 'ArtifactPatternMatching' symbol, module, or exported member anywhere in the file — the closest match is the private matchArtifactPattern() method, one of two branches inside analyzeEntityPatterns() (the other being checkLocalArtifact()). The requested component name appears to be an entity-graph abstraction layered over this single method rather than a standalone unit of code, so any file/line-level analysis of 'ArtifactPatternMatching' is really an analysis of this one branch of a larger class.
- [ArtifactExtraction](./ArtifactExtraction.md) -- [LLM] The component named "ArtifactExtraction" maps directly onto the private extractArtifacts() method in src/ontology/heuristics/EntityPatternAnalyzer.ts, which is the sole artifact-mining routine in the supplied code. It runs four independent regex passes over the raw knowledge-content string and unions every hit into a single `Set<string>`: a file-path pattern requiring a two-segment lowercase/hyphen directory prefix before one of nine hardcoded extensions (ts/js/cpp/java/tsx/jsx/py/go/rs), an npm-scoped-package pattern (`@scope/name`), a class-name pattern requiring a capitalized identifier ending in one of nine hardcoded suffixes (Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor), and a bare two-segment directory pattern (`x/y/`). Because `Array.from(artifacts)` preserves Set insertion order and the four `.forEach` calls run strictly sequentially (file paths, then npm packages, then class names, then directories), a class-name artifact is always inserted before a directory artifact extracted from the same line of text, even if the directory appeared first in the source string — insertion order is a function of regex pass order, not of position in the content.


---

*Generated from 9 observations*
