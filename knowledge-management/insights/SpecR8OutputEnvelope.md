# SpecR8OutputEnvelope

**Type:** Detail

## What It Is

SpecR8OutputEnvelope refers to the `outputEnvelope()` function in `scripts/health-prompt-hook.js`, the single low-level primitive responsible for producing the SPEC R8-compliant wire format: `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }`. It is a child concern of the parent `HealthPromptHook` component, serving as that hook's exclusive output channel — every code path in the file, regardless of success or failure, ultimately funnels through this one function before the process exits.

## Architecture and Design

The defining architectural pattern is a **single-writer output primitive**: rather than trusting each call site to construct the correct envelope shape, `outputEnvelope()` is the only function permitted to emit the SPEC R8 structure, and it is invoked identically from the Q3 no-op branch, the normal `outputHealthContext()` flow, the catch block around `checkHealthStatus()`, and the outer `.catch()` in `main()`. This guarantees structural correctness by construction rather than convention.

This is paired with a **defensive multi-layer fallback** design: `main()`'s nested try/catch blocks handle failures at the health-check and top level, but `outputEnvelope()` itself adds a second, lower-level defensive layer by coercing any non-string `additionalContext` (including `undefined` or objects) to an empty string via `typeof additionalContext === 'string' ? additionalContext : ''`. The effect is that no failure mode anywhere in the file — including total absence of the repo's `scripts/health-verifier.js` (handled upstream by sibling `CheckHealthStatusCoordinatorFetch`) — can produce anything other than a syntactically valid envelope followed by `process.exit(0)`.

A key design decision, noted in the architecture notes, is the **decoupling of envelope shape from health-state acquisition**: failures in `checkHealthStatus()` or `deriveSummary()` (the sibling `DeriveSummaryHealthReducer`) degrade the *content* of the envelope (e.g., 'unknown' status, empty issues) but never its shape. This isolates upstream data-quality problems — such as the known coverage-metric bug in obs-api's entity-type ratio denominator affecting `observations` and `digests` — from the hook's contractual output format.

## Implementation Details

`outputHealthContext()` is the primary producer feeding `outputEnvelope()`. It maps `deriveSummary()`'s three-way `overallStatus` (`'unknown' | 'unhealthy' | 'healthy'`) to fixed emoji-prefixed strings (⚪/⚠️/✅), and truncates the `issues` array via `issues.slice(0, 3).join(', ')` before passing the resulting string down. This truncation is an implicit size cap on envelope content, independent of how many issues the reducer actually collected upstream.

`outputEnvelope('')` is called verbatim from three distinct failure contexts — the Q3 carve-out, the catch around `checkHealthStatus()` (via an 'unknown' status flowing through `outputHealthContext`), and the last-ditch outer `.catch()` — demonstrating that empty-string content is a deliberate, reusable failure value rather than an accidental default.

## Integration Points

Internally, `SpecR8OutputEnvelope` sits downstream of `CheckHealthStatusCoordinatorFetch` (`checkHealthStatus()`) and `DeriveSummaryHealthReducer` (`deriveSummary()`), consuming only their final `overallStatus`/`issues` output rather than raw coordinator JSON — reinforcing the allow-listed data projection pattern the reducer enforces ("no unsanitised passthrough," T-33-05-02 mitigation).

Externally, the emitted `additionalContext` string functions as a de facto cross-application contract: it is parsed independently by two deployed frontends — a Next.js constraint-monitor dashboard and the Vite-based system-health-dashboard — neither of whose source is present in this file set. This makes the envelope's string phrasing a hidden but real API surface.

## Usage Guidelines

Any change to `outputHealthContext()`'s emoji/text formatting must be treated as a breaking-change candidate for both consuming dashboards, since their parsing logic is invisible from this codebase alone. New fields should never be passed straight through from coordinator data — the reducer's allow-list discipline should be extended, not bypassed, at the `outputEnvelope()` boundary. Because `outputEnvelope()` is the sole legitimate constructor of the SPEC R8 shape, new call sites should always route through it rather than reconstructing the object literal ad hoc, preserving the structural guarantee. Finally, any fix to the upstream obs-api coverage-metric bug should be verified against `deriveSummary()`'s consumption of `services[]`/`databases.status` to ensure content-level corrections propagate correctly through to the envelope without requiring shape changes.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'obs-api Service Lifecycle and Dev Workflow Resumption' work record documents an unresolved coverage-metric bug in obs-api whose ratio denominator wrongly includes 'observations' and 'digests' entity types, establishing that the coordinator-derived data this hook's envelope ultimately reports on (via checkHealthStatus() and deriveSummary()) has a known accuracy gap upstream of the envelope itself.
- The 'HealthDashboard — Performance/System-Health/Token-Cost Dashboards' work record establishes that the SPEC R8 envelope's `additionalContext` string is consumed as a de facto contract by two independently deployed frontends (a Next.js constraint-monitor dashboard and the Vite-based system-health-dashboard), meaning any change to outputHealthContext()'s phrasing risks breaking parsing logic in both without either frontend's source being visible in this component's own files.

## Hierarchy Context

### Parent
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] obs-api Service Lifecycle and Dev Workflow Resumption record notes a related coverage-metric bug in obs-api counting 'observations' and 'digests' entity types in a ratio denominator that should exclude them, showing this hook's upstream data source has known accuracy gaps

### Siblings
- [DeriveSummaryHealthReducer](./DeriveSummaryHealthReducer.md) -- [LLM+CGR] The component maps to `deriveSummary()` in scripts/health-prompt-hook.js, a pure reducer that folds the coordinator's `/health/state` JSON into a `{ overallStatus, issues, generated_at }` shape. It only reads five allow-listed fields — `container.healthcheck`, `databases.status`, `services[]`, `lsl_by_project`, and `knowledge_pipeline.status` — and the header comment labels this restriction 'no unsanitised passthrough (T-33-05-02 mitigation)'. Any new coordinator field is invisible to the hook until this function is explicitly edited to extract it, making the reducer a narrow, versioned contract rather than a general formatter.
- [CheckHealthStatusCoordinatorFetch](./CheckHealthStatusCoordinatorFetch.md) -- [LLM] checkHealthStatus() (scripts/health-prompt-hook.js) is the literal implementation this component name describes: a single fetch to the health-coordinator, gated by a repo-detection heuristic. Before any network call it checks `existsSync(VERIFIER_SCRIPT)` — the presence of `scripts/health-verifier.js` next to this file — and short-circuits to `{ servicesAvailable: false, exists: false, isStale: false, shouldBlock: false, status: null }` when absent. This is the Q3 carve-out: the function's very first branch has nothing to do with coordinator health and everything to do with deciding whether the hook is even running inside the coding repo.


---

*Generated from 9 observations*
