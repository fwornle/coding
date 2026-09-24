# EntityPatternAnalyzer

**Type:** SubComponent

## What It Is

`EntityPatternAnalyzer` is a class implemented in `src/ontology/heuristics/EntityPatternAnalyzer.ts` (module `EntityPatternAnalyzer.ts`). It is Layer 1 of a multi-layer team-ownership detection pipeline: its public entry point, `analyzeEntityPatterns`, returns a `LayerResult` explicitly tagged `layer: 1, layerName: 'EntityPatternAnalyzer'`. It imports `LayerResult` and `ArtifactMatch` from `ontology/types.ts`, which defines the shared contract other layers presumably also consume. As a child of **CodingPatterns**, it sits alongside sibling components `PatternVerificationTooling` (a bash/ripgrep compliance scanner) and `StatuslineClickFeedbackPattern` (a tmux UX constraint record) — distinct domains united only by their shared parent grouping of pattern-related knowledge.

Functionally, this component's role is to look at extracted artifacts referenced in a piece of knowledge content (file paths, package names, class names) and attribute that content to an owning team, which is directly relevant to the SESSION-recorded use case of routing externally drafted feedback files into the correct per-person/team destination in the second-brain-private vault before filing.

## Architecture and Design

![EntityPatternAnalyzer — Architecture](images/entity-pattern-analyzer-architecture.png)

The design follows a **chain-of-responsibility / first-match-wins** strategy: for each artifact, `checkLocalArtifact` (directory-prefix match, confidence 0.9) is tried before `matchArtifactPattern` (regex match, confidence 0.75), so a directory hit always outranks a naming-convention hit. This ordering is itself a design decision favoring physical repository structure as a stronger ownership signal than naming conventions.

Layered atop this is a **pipeline architecture**: the class self-identifies as Layer 1 via its own `LayerResult` output, implying downstream layers consume its attribution. The extraction step, `extractArtifacts`, acts as a lightweight **multi-pass regex tokenizer**, running four independent passes (file paths, npm-scoped packages, suffix-based class names like `*Service`/`*Agent`/`*Manager`, and bare directory prefixes) and merging results into a deduplicating `Set<string>`. Classification itself is **static lookup-table-driven** — `teamDirectories` (a `Map<string,string[]>`) and `artifactPatterns` (an array of `ArtifactPattern` objects) — rather than a rules engine or ML classifier, matching the "Static lookup-table-driven classification" pattern noted in Architectural Patterns observations.

The four conceptual children — **ArtifactPatternTable**, **TeamDirectoryRegistry**, **ArtifactExtractionEngine**, and **TwoStepArtifactMatching** — are not separate files or classes; observations confirm each is a descriptive label for logic embedded inline within `EntityPatternAnalyzer`: `artifactPatterns` (constructor lines ~47-107), the private `teamDirectories` field, the private `extractArtifacts()` method, and the two-step `checkLocalArtifact`/`matchArtifactPattern` sequence inside `analyzeEntityPatterns`, respectively. This is a single-file monolith presented with a decomposed conceptual model.

## Implementation Details

`analyzeEntityPatterns` iterates the `Set<string>` produced by `extractArtifacts` and **returns on the first artifact that produces a match** — no scoring, no majority vote. Because Set iteration order follows insertion order (i.e., whichever regex pass found the string first), when a knowledge entry references artifacts from multiple teams, attribution is decided silently by regex-pass ordering rather than by evidence weight. This is a significant, documented ambiguity in multi-team content.

`checkLocalArtifact` performs a directory-prefix (`startsWith`) test against `teamDirectories`, returning confidence 0.9 on a hit. `matchArtifactPattern` runs regex tests against the four-team `artifactPatterns` array (Coding, RaaS, ReSi, UI), returning confidence 0.75, and is reached only as fallback once `checkLocalArtifact` returns null — confirmed by the ArtifactPatternTable child observation describing it as "a fallback classifier, never the first-choice one."

`inferEntityClass` maps a team to an entity class via an internal `teamMappings` table. Notably, this table defines an `'Agentic'` entry (`Agent→AgentFramework`, `RAG→RAGSystem`, `LLM→LLMProvider`, `Vector→VectorStore`) that is **unreachable**: `checkLocalArtifact` only ever returns team values drawn from `teamDirectories`' four keys (Coding, RaaS, ReSi, UI), so `'Agentic'` can never be produced internally. This reads as forward-looking/dead code for a team that was planned but never wired into `teamDirectories` or `artifactPatterns`.

## Integration Points

![EntityPatternAnalyzer — Relationship](images/entity-pattern-analyzer-relationship.png)

The component's sole external type dependency is `ontology/types.ts`, supplying `LayerResult` and `ArtifactMatch` — the shared vocabulary presumably used across all layers of the detection pipeline, though those other layers are not described in these observations. As Layer 1, its `LayerResult` output is consumed downstream, and the SESSION-recorded Detail Roll-up convention (verifying background consolidation jobs via process exit code, not assumption) generalizes to any consolidation pipeline this attribution feeds — a caution worth carrying forward for whatever orchestrates Layer 1 output. Separately, the second-brain vault routing session record ties this component's attribution role to filing externally drafted feedback into canonical per-person files without data loss or duplication.

There is **no dependency injection**: `teamDirectories` and `artifactPatterns` are built inline in the constructor with no external config source, meaning extending team coverage (e.g., wiring up the dormant `'Agentic'` mapping) requires directly editing `EntityPatternAnalyzer.ts`.

## Usage Guidelines

Treat this component strictly as **Layer 1** — a first-pass, string/structure-based heuristic, not a final authority. Confidence scores (0.9, 0.75) are hardcoded constants, not calibrated or evidence-weighted, so they should not be treated as statistically meaningful probabilities. Because attribution returns on the first matching artifact with no cross-artifact scoring, developers feeding multi-team knowledge entries through this analyzer should expect nondeterministic-feeling results driven by regex/insertion order, not by the "correct" majority owner — this is a known limitation, not a bug to chase blindly.

Anyone wanting to add team coverage must edit `teamDirectories` and `artifactPatterns` directly in the constructor; there is no registry or config file to extend externally despite the `TeamDirectoryRegistry` and `ArtifactPatternTable` naming suggesting otherwise. Before doing so, note the `'Agentic'` entry already exists in `inferEntityClass`'s `teamMappings` but sits unreachable — completing that wiring (adding an Agentic entry to `teamDirectories`/`artifactPatterns`) is a natural, low-risk extension point. Finally, all classification depends entirely on string/path conventions with no structural or semantic signal, so this analyzer should not be relied upon where naming conventions are inconsistent or teams share directory prefixes.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- EntityPatternAnalyzer (class) in EntityPatternAnalyzer.ts

**Relationships:**
- Imports: ontology/types.ts, ArtifactMatch, LayerResult
- EntityPatternAnalyzer.ts imports LayerResult and ArtifactMatch from ontology/types.ts and implements a single class, EntityPatternAnalyzer, whose public method analyzeEntityPatterns returns a LayerResult tagged `layer: 1, layerName: 'EntityPatternAnalyzer'` — confirming this class is explicitly Layer 1 of a multi-layer team-ownership detection pipeline rather than a standalone classifier. It performs two-step matching per extracted artifact: checkLocalArtifact (directory-prefix match against teamDirectories, confidence 0.9) is tried first, and only on failure does matchArtifactPattern (regex against artifactPatterns, confidence 0.75) run — so a directory hit always outranks a naming-convention hit for the same artifact.

**Other:**
- EntityPatternAnalyzer.ts (module) in EntityPatternAnalyzer.ts


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Second-Brain Vault Routing & Skill Architecture (about EntityPatternAnalyzer) establishes how externally drafted personal-development feedback dropped into ~/Downloads/ as .md files gets merged into canonical per-person feedback files inside the second-brain-private vault, with the merge required to preserve history and avoid data loss or duplication — this is the session record most directly tied to this component's role of attributing incoming content to an owner before it is filed.
- Detail Roll-up Background Task — Monitoring and Validation establishes that any background job consolidating fine-grained records (the example given is SubComponent entries rolling up into Detail records) must have its completion actively verified via process exit code rather than assumed successful once launched; this convention generalizes to any consolidation pipeline that EntityPatternAnalyzer's Layer-1 attribution feeds into downstream.

## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Tmux Statusline — Click Feedback and Hover Limitations record establishes that tmux (verified up to 3.6a) lacks MouseMove/hover event support, so the statusline substitutes an explicit click-feedback pattern instead of hover-highlight affordances for clickable fields.

### Children
- [ArtifactPatternTable](./ArtifactPatternTable.md) -- [LLM+CGR] EntityPatternAnalyzer.ts:47-107 defines the artifact-pattern table itself: `this.artifactPatterns` is an array of four `ArtifactPattern` objects (interface at line ~16-20: `{team, patterns: RegExp[], entityClassMap: Record<string,string>}`), one per team — Coding, RaaS, ReSi, UI. This is the exact structure the parent's CGR observation calls 'regex against artifactPatterns, confidence 0.75' and is consumed only by `matchArtifactPattern`, which is reached only after `checkLocalArtifact` (the `teamDirectories` lookup) has already returned null for a given artifact — so the table is a fallback classifier, never the first-choice one.
- [TeamDirectoryRegistry](./TeamDirectoryRegistry.md) -- [LLM] No file in the supplied evidence defines a class, module, or export named "TeamDirectoryRegistry". The only structurally similar artifact is the private `teamDirectories` field on `EntityPatternAnalyzer` (src/ontology/heuristics/EntityPatternAnalyzer.ts) — a `Map<string, string[]>` built inline in the constructor, not a separate registry class. It is read exclusively by `checkLocalArtifact`, which iterates `this.teamDirectories.entries()` and does a directory-prefix `startsWith` test; there is no importable registry object, no CRUD surface, and no file dedicated to team-directory storage.
- [ArtifactExtractionEngine](./ArtifactExtractionEngine.md) -- [LLM+CGR] No file, class, or module named "ArtifactExtractionEngine" appears anywhere in the supplied code graph or code files. The only artifact-extraction logic present is the private `extractArtifacts()` method inside `EntityPatternAnalyzer` (src/ontology/heuristics/EntityPatternAnalyzer.ts), which the code graph confirms is a method of the Layer-1 class `EntityPatternAnalyzer`, not a standalone `ArtifactExtractionEngine` component. This strongly suggests "ArtifactExtractionEngine" is a descriptive label applied post-hoc to a sub-routine of EntityPatternAnalyzer rather than a distinct, separately-implemented entity.
- [TwoStepArtifactMatching](./TwoStepArtifactMatching.md) -- [LLM+CGR] analyzeEntityPatterns (EntityPatternAnalyzer.ts) implements the two-step matching directly: for each artifact produced by extractArtifacts, it first calls checkLocalArtifact — a directory-prefix test against the teamDirectories Map, returning confidence 0.9 — and only when that returns null does it fall through to matchArtifactPattern, a regex test against the artifactPatterns array, returning confidence 0.75. The loop returns on the first artifact that satisfies either step, so a single early directory or pattern hit determines the whole LayerResult; later artifacts in the same knowledge entry are never even inspected once a match fires.

### Siblings
- [PatternVerificationTooling](./PatternVerificationTooling.md) -- [LLM] scripts/knowledge-management/verify-patterns.sh is the literal implementation of PatternVerificationTooling: a bash script (`set -euo pipefail`) that scans the working tree with ripgrep for compliance against named patterns — ConditionalLoggingPattern (`console.log` count vs `Logger.(log|debug|info|warn|error)` count), ReduxStateManagementPattern (`useState` vs `useSelector|useDispatch|createSlice` counts, gated on `package.json` containing 'react'), NetworkAwareInstallationPattern (grep for `check_network|detect_network|timeout` in `install.sh`), and an undocumented-function heuristic — accumulating results into a timestamped markdown report at `/tmp/pattern-verification-$(date +%Y%m%d_%H%M%S).md`.
- [StatuslineClickFeedbackPattern](./StatuslineClickFeedbackPattern.md) -- [SESSION] Tmux Statusline — Click Feedback and Hover Limitations establishes that tmux, verified up to version 3.6a, provides no MouseMove/hover event support, making hover-highlight affordances for clickable fields technically infeasible in current tmux releases


---

*Generated from 11 observations*
