# ArtifactExtraction

**Type:** Detail

## What It Is

ArtifactExtraction is the private `extractArtifacts()` method within `src/ontology/heuristics/EntityPatternAnalyzer.ts`, and it is the sole artifact-mining routine backing that class. It is not a standalone module or exported symbol — it is a single method that runs four independent regex passes over raw knowledge-content strings and unions all matches into a single `Set<string>`. This method feeds the "Layer 1: File/Artifact Detection" stage of its parent, EntityTeamOwnershipHeuristics, and its output is consumed immediately by `analyzeEntityPatterns()`.

## Architecture and Design

The core pattern is regex-based text mining: four hand-tuned patterns — a file-path pattern (two-segment lowercase/hyphen directory prefix plus one of nine hardcoded extensions: ts/js/cpp/java/tsx/jsx/py/go/rs), an npm-scoped-package pattern (`@scope/name`), a class-name pattern (capitalized identifier ending in Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor), and a bare two-segment directory pattern (`x/y/`) — are each run via `.forEach` in a fixed sequence: file paths, then npm packages, then class names, then directories. Because `Array.from(artifacts)` preserves `Set` insertion order, this pass order becomes a hidden coupling: it silently determines which artifact `analyzeEntityPatterns()` evaluates first, since that consumer loop is first-match-wins, returning as soon as `checkLocalArtifact()` or `matchArtifactPattern()` (the sibling ArtifactPatternMatching branch) succeeds. This produces the two-tier confidence scoring described at the parent level — 0.9 for a direct hit against the TeamDirectoryMapping prefix table, 0.75 for a naming-convention fallback — but that scoring is only ever applied to whichever artifact happened to be inserted first, not necessarily the most semantically authoritative one for the knowledge item.

There is no AST parsing, import-graph traversal, or code-fence/prose disambiguation anywhere in this stage — it is purely textual regex analysis, a deliberate trade-off for simplicity and speed at the cost of precision.

## Implementation Details

Each of the four regexes has a closed, hardcoded vocabulary: nine file extensions, nine class-name suffixes, and a lowercase-hyphen-only constraint on directory segments for both the file-path and bare-directory patterns; only scoped npm packages are recognized, unscoped ones are ignored entirely. Matches from all four passes are unioned into one `Set<string>`, deduplicating identical strings but preserving first-seen-by-pass ordering otherwise. `analyzeEntityPatterns()` then iterates this set in that order, checking each candidate first against `checkLocalArtifact()` (prefix match against the `teamDirectories` Map owned by sibling TeamDirectoryMapping) and, only on failure, against `matchArtifactPattern()` (the per-team regex fallback that is effectively the ArtifactPatternMatching sibling). The loop returns on the first success, meaning later-extracted artifacts — even ones with stronger evidentiary value — never get evaluated once an earlier one resolves.

## Integration Points

ArtifactExtraction's Set output is the sole input to the classification branch inside `analyzeEntityPatterns()`, giving it a direct, order-sensitive dependency on both TeamDirectoryMapping's prefix table and ArtifactPatternMatching's regex fallback. Beyond `EntityPatternAnalyzer.ts`, there is no other integration surface: `scripts/knowledge-management/verify-patterns.sh` and the `integrations/graphify/tests/fixtures/xaml_viewmodel/` fixtures that surface in the same retrieval set are unrelated (a compliance auditor and XAML-parsing test fixtures, respectively) and should not be treated as part of this pipeline. Its output also indirectly feeds downstream consolidation/confidence-merge logic referenced by the Metadata Merge Bug concerns, since the 0.9/0.75 confidence values it produces can be overwritten during later merge steps.

## Usage Guidelines

Because the extraction vocabularies are closed and hand-tuned to this project's own conventions, anything shaped differently — `.md`/`.yaml`/`.json`/`.sh`/`.sql` files, mixed-case or underscored directories like `src/knowledge_management`, or unscoped npm packages — is invisible to the rest of the pipeline with no logging or fallback. The class-name pattern is also prose-unsafe: any capitalized English compound ending in one of the nine suffixes (e.g., "ProjectManager," "RiskHandler") will be extracted as if it were a real code artifact, with no guard distinguishing genuine identifiers from narrative text. Developers modifying regex pass order should recognize this changes classification outcomes, not just extraction contents, due to the Set-insertion-order coupling. Unlike `report-entity-resolution.mjs`'s dry-run audit discipline elsewhere in the knowledge-management tooling, there is no test harness measuring false-positive/false-negative rates for this stage — adding one before extending the regexes is strongly advisable, as is considering resolving ties by evidentiary strength (e.g., preferring `checkLocalArtifact()` matches) rather than raw pass order.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The KB Architecture Audit — Gap Analysis Initiative record establishes report-entity-resolution.mjs as a dry-run auditor that validates similarity-threshold behavior before trusting a writer/consolidator. The same 'audit before write' discipline is conspicuously absent for extractArtifacts(): there is no accompanying test harness in the supplied files that measures false-positive rate (prose incorrectly matched as an artifact) or false-negative rate (real artifacts missed by the four hardcoded regexes) for this specific extraction stage, even though its output directly seeds the 0.9/0.75-confidence team classification that the Metadata Merge Bug record warns could be silently clobbered during consolidation.

## Hierarchy Context

### Parent
- [EntityTeamOwnershipHeuristics](./EntityTeamOwnershipHeuristics.md) -- [LLM] src/ontology/heuristics/EntityPatternAnalyzer.ts implements the actual 'Layer 1: File/Artifact Detection' stage of EntityTeamOwnershipHeuristics, per its own header comment. analyzeEntityPatterns() runs a two-step check per extracted artifact: checkLocalArtifact() first looks for a direct prefix match against a hardcoded teamDirectories Map (Coding → src/ontology, src/knowledge-management, src/live-logging, scripts, .specstory; RaaS → raas-service, orchestration-engine, event-mesh; ReSi → virtual-target, embedded-functions, reprocessing-engine; UI → curriculum-alignment, aws-lambda, multi-agent-system), returning confidence 0.9. Only if that fails does matchArtifactPattern() fall back to a per-team array of naming-convention regexes (e.g. /LSL(Session|Monitor|Classifier)/i for Coding, /Kubernetes(Cluster|Pod|Service)/i for RaaS) at confidence 0.75 — a deliberate 'known location beats plausible name' ordering.

### Siblings
- [TeamDirectoryMapping](./TeamDirectoryMapping.md) -- [LLM] The literal 'TeamDirectoryMapping' entity is realized as the `teamDirectories` private field in `src/ontology/heuristics/EntityPatternAnalyzer.ts`'s constructor: a `Map<string, string[]>` with four hardcoded team keys (Coding, RaaS, ReSi, UI), each holding a flat array of directory-prefix strings (e.g. Coding → `src/ontology`, `src/knowledge-management`, `src/live-logging`, `scripts`, `.specstory`). This is not a generic config object but the exact lookup table `checkLocalArtifact()` iterates via `this.teamDirectories.entries()`, using `dirs.some((dir) => artifact.startsWith(dir))` — a simple prefix test, not a path-segment-aware match, so a hypothetical directory named e.g. `scripts-legacy/` would also satisfy `startsWith('scripts')`.
- [ArtifactPatternMatching](./ArtifactPatternMatching.md) -- [LLM] The supplied code implements the underlying EntityPatternAnalyzer class (Layer 1 of EntityTeamOwnershipHeuristics), but there is no distinct 'ArtifactPatternMatching' symbol, module, or exported member anywhere in the file — the closest match is the private matchArtifactPattern() method, one of two branches inside analyzeEntityPatterns() (the other being checkLocalArtifact()). The requested component name appears to be an entity-graph abstraction layered over this single method rather than a standalone unit of code, so any file/line-level analysis of 'ArtifactPatternMatching' is really an analysis of this one branch of a larger class.


---

*Generated from 9 observations*
