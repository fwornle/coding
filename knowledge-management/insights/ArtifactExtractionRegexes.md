# ArtifactExtractionRegexes

**Type:** Detail

# ArtifactExtractionRegexes — Technical Insight Document

## What It Is

`ArtifactExtractionRegexes` refers to the four inline regular expressions embedded in the private `extractArtifacts()` method of `src/ontology/heuristics/EntityPatternAnalyzer.ts`. This method is the first stage of the parent component `AgentWrapperConvention`'s team-attribution pipeline: it scans free-text knowledge content and produces a single, untyped `Set<string>` of candidate "artifacts" — strings that might refer to files, packages, or classes owned by a team. The four passes are:

- a **file-path pattern**: `/[a-z-]+\/[a-z-]+\/[a-zA-Z0-9_\-\/]+\.(ts|js|cpp|java|tsx|jsx|py|go|rs)/g`
- an **npm-scope pattern**: `/@[a-z-]+\/[a-z-]+/g`
- a **class-suffix pattern**: `/[A-Z][a-zA-Z]+(Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor)/g`
- a **bare directory-prefix pattern**: `/[a-z-]+\/[a-z-]+\//g`

These extracted candidates feed downstream into `checkLocalArtifact()` and `matchArtifactPattern()`, which score them against `HardcodedTeamDirectoryMap` and `ArtifactPatternRegexTable` respectively.

## Architecture and Design

The design is a **multi-pass regex extraction into a deduplicating Set**, followed by a **two-tier confidence-scored matching cascade** (directory-prefix match at 0.9, regex fallback at 0.75), as documented at the `AgentWrapperConvention` level. This reflects a broader "convention-as-signal" pattern: the codebase's own `*Service/*Manager/*Classifier` naming convention (mirrored in real classes like `SensitivityClassifier`/`OntologyClassifier`) is reused as a detection heuristic rather than enforced as an implementation rule.

Structurally, the four regexes are not independent — they overlap. The directory-only pattern is a strict subset of the file-path pattern's leading capture group, so a single well-formed path like `scripts/knowledge-management/verify-patterns.sh` produces two Set entries: the full path and the truncated `scripts/knowledge-management/` prefix. Because the Set is untyped and provenance-free, there is no record of which regex produced which artifact, and the sibling `TwoStepArtifactAttribution` logic in `analyzeEntityPatterns()` treats all Set members identically regardless of extraction rule quality.

## Implementation Details

Each regex encodes narrow, undocumented assumptions rather than deriving from any enumerated source of truth:

- The **file-path regex** requires kebab-case (lowercase-and-hyphen-only) first two path segments. A camelCase or underscore directory like `src/liveLogging/foo.ts` or `scripts_v2/bar.ts` simply fails to match, falling back to weaker patterns or no match at all.
- The **class-suffix regex** is greedy on `[a-zA-Z]+` before the suffix alternation, so compound names like `MyServiceManager` collapse into a single token bound to the outermost suffix (`Manager`), never surfacing `MyService` as a separate candidate. This directly limits what `matchArtifactPattern()` can later test — e.g., a pattern like `/Kubernetes(Cluster|Pod|Service)/i` from `ArtifactPatternRegexTable` only ever sees the full compound token.
- The **npm-scope regex** has no word-boundary anchoring, so scope-shaped substrings unrelated to actual imports (e.g., a Slack-handle-like `@team/subteam` in prose) are extracted as false positives. These can never match `HardcodedTeamDirectoryMap` entries (all plain filesystem paths), but they still consume a full iteration of the outer artifact-matching loop in `checkLocalArtifact()`/`matchArtifactPattern()` before being discarded.
- The **directory-prefix regex** produces redundant, dead-weight Set entries that are pure prefixes of other entries, adding no discriminative value to the `startsWith(dir)` checks in `checkLocalArtifact()`.

Additionally, digits are unsupported in class names (`[A-Z][a-zA-Z]+` rejects `S3Manager`) and there is no handling for Windows-style paths or numeric path segments (`v2/module.ts`) — gaps that exist because there is no fixture or table-driven test exercising `extractArtifacts()` in isolation.

## Integration Points

`extractArtifacts()` is consumed exclusively by `analyzeEntityPatterns()`, which is documented under the sibling `TwoStepArtifactAttribution`. That method short-circuits on the *first* artifact in Set iteration order that produces any match — not the highest-confidence match overall — so the accidental insertion order of `extractArtifacts()` (file paths, then npm packages, then class names, then directories) determines which evidence type effectively "wins," coupling this component's internal ordering decisions to attribution outcomes elsewhere in the system.

Downstream, artifacts flow into `checkLocalArtifact()`, which tests `.startsWith(dir)` against `HardcodedTeamDirectoryMap`'s four hardcoded team-directory prefixes, and into `matchArtifactPattern()`, which tests against `ArtifactPatternRegexTable`'s per-team regex arrays and `entityClassMap`. Both consumers are themselves hardcoded TypeScript literals rather than YAML-driven config, meaning the entire chain — extraction, directory matching, and pattern matching — sits outside the "classification data is not code" philosophy noted for `prompt-classifier.yaml` elsewhere in the system.

## Usage Guidelines

Because all four regexes are private, inline, and untested in isolation, any correction to their assumptions (kebab-case paths, letters-only class names, unanchored npm scopes) requires a source-code change to `EntityPatternAnalyzer.ts`, not a config update. Developers extending team/directory coverage should be aware that new naming conventions (camelCase directories, digit-containing class names like `S3Manager`, Windows-style paths) will silently fail extraction with no compiler or test signal. Given the Set-based deduplication discards provenance, any future refactor should consider tagging extracted artifacts with their originating pattern to avoid near-duplicate entries (e.g., a full path and its own directory prefix) competing independently through the confidence cascade. Finally, because match order — not match quality — determines the returned result in `analyzeEntityPatterns()`, changes to extraction order or regex greediness can silently shift which team an artifact is attributed to, so any regex change here should be validated against the full attribution pipeline, not just extraction output.


## Hierarchy Context

### Parent
- [AgentWrapperConvention](./AgentWrapperConvention.md) -- [LLM] src/ontology/heuristics/EntityPatternAnalyzer.ts implements a two-step, confidence-scored team-attribution heuristic: analyzeEntityPatterns() first calls extractArtifacts() to pull file paths, npm scopes, class names (via a Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor suffix regex), and bare directory prefixes out of free-text knowledge content, then tries checkLocalArtifact() (directory-prefix match against the teamDirectories Map, confidence 0.9) before falling back to matchArtifactPattern() (regex match against artifactPatterns, confidence 0.75). This mirrors the parent's documented Classifier-suffix convention (<AWS_SECRET_REDACTED>) but is notably NOT YAML-driven — the team directories and regex patterns are hardcoded TypeScript literals in the constructor, contradicting the 'classification thresholds and categories are treated as data, not code' philosophy described for prompt-classifier.yaml elsewhere in the system.

### Siblings
- [TwoStepArtifactAttribution](./TwoStepArtifactAttribution.md) -- [LLM] EntityPatternAnalyzer.analyzeEntityPatterns() implements a short-circuit two-step confidence cascade: for each artifact extracted from free text, it calls checkLocalArtifact() first (directory-prefix match, confidence 0.9) and only calls matchArtifactPattern() (regex match, confidence 0.75) if that fails, then returns on the FIRST artifact that produces any match at all — not the highest-confidence match across all extracted artifacts. Because extractArtifacts() populates a Set (whose JavaScript iteration order is insertion order: file paths, then npm packages, then class names, then bare directories), the effective priority of evidence types is accidental rather than designed — a class name like 'BudgetTracker' appearing before a directory reference like 'src/ontology/' in the source text will never even be tried against checkLocalArtifact() if an earlier-extracted artifact already matched, even weakly.
- [HardcodedTeamDirectoryMap](./HardcodedTeamDirectoryMap.md) -- [LLM] The `teamDirectories` Map constructed in `EntityPatternAnalyzer`'s constructor hardcodes exactly four teams (Coding, RaaS, ReSi, UI) with directory prefixes like `src/ontology`, `raas-service`, `virtual-target`, and `curriculum-alignment`. Because `checkLocalArtifact()` iterates this Map with `dirs.some((dir) => artifact.startsWith(dir))`, any artifact path extracted by `extractArtifacts()` that doesn't begin with one of these twelve literal strings falls through to `matchArtifactPattern()` or returns null entirely — meaning a new team or a renamed top-level directory (e.g. `src/ontology` becoming `src/knowledge-ontology`) silently degrades Layer 1 attribution with no compiler or test signal, since these are plain string literals, not enum-backed constants.
- [ArtifactPatternRegexTable](./ArtifactPatternRegexTable.md) -- [LLM] The `ArtifactPatternRegexTable` — the `artifactPatterns` array literal in `EntityPatternAnalyzer.ts`'s constructor — is a hardcoded four-team lookup table (Coding, RaaS, ReSi, UI) that pairs an array of case-insensitive `RegExp` objects with a parallel `entityClassMap`. Each team entry's patterns and map keys are maintained by hand and only loosely coupled: for example the UI team's `entityClassMap` includes a `Redux` key mapped to `ReduxState`, and the corresponding pattern `/React(Component)?|Redux/i` does match bare 'Redux' mentions, but `inferEntityClassFromPattern` (referenced but truncated in the visible file) must still correctly extract 'Redux' as the map key from an arbitrary matched substring like 'ReduxState' or 'useReduxHook' — a fragile string-prefix inference rather than a captured regex group.


---

*Generated from 9 observations*
