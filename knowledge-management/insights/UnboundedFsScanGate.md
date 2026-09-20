# UnboundedFsScanGate

**Type:** Detail

The file's own comments document the 2026-09-02 incident where `find / -name ...` took 343 seconds, and justify pushing this into code because 'a prompt-level instruction competes with the model's own reasoning at the moment the model is already improvising'

# UnboundedFsScanGate

## What It Is

UnboundedFsScanGate is implemented in `config/agents/pi-extensions/no-unbounded-fs-scan.ts` as a runtime tool-call gate that intercepts shell commands before execution and blocks `find` invocations rooted at whole-machine or whole-home directories. It is the concrete "Detail"-level realization of the QualityAssurance parent component's strategy of enforcing correctness through deterministic code rather than natural-language instruction. The gate's origin is a documented incident (2026-09-02) where an unconstrained `find / -name ...` call ran for 343 seconds — the extension exists specifically to make that class of mistake structurally impossible rather than merely discouraged.

## Architecture and Design

The design pattern here is a deterministic runtime interceptor registered via `pi.on('tool_call', ...)`, placed directly in the tool invocation path so it can inspect and veto commands before they run. This reflects a broader architectural philosophy stated in the code comments: a prompt-level instruction "competes with the model's own reasoning at the moment the model is already improvising, which is exactly when it loses." Rather than trusting instructions to hold under improvisation pressure, QualityAssurance pushes the invariant into code where it cannot be reasoned away.

A key trade-off embedded in the design is the fail-open behavior: any internal exception in the gate is caught and swallowed, allowing the original command to proceed. This is explicit and intentional — the authors frame the extension as "a latency guard, not a security boundary," meaning correctness of the gate is optimized for the common case, and its own failure must never become a new source of blocked or broken workflows.

## Implementation Details

Command inspection happens in `offendingRoot()`, which splits an incoming shell command string on shell control operators (`||`, `&&`, `;`, `|`, `$(`, backticks) to examine each resulting segment independently for a `find` invocation. Each segment's roots are extracted via `findRoots()`, which walks argv tokens but stops consuming them as soon as it hits a `-`-prefixed predicate (or `(`/`!`), specifically to avoid misinterpreting flag values — e.g., the path in `-name /foo` — as an actual search root. The extracted roots are checked against `unboundedRoots()`, an enumerated list of whole-machine anchors such as `/`, `/Users`, `/home`, and `$HOME`.

When a match is found, the gate returns `{block: true, terminate: false, reason: ...}` rather than terminating the session outright. The `reason` field is an actionable message — suggesting the model search the project directory, check `~/.Trash`, or use package manager tools instead — designed to be read in-transcript so the model can self-correct on its very next tool call rather than dead-ending.

## Integration Points

The gate integrates with the tool-calling infrastructure through the `pi.on('tool_call', ...)` hook, making it a cross-cutting concern applied uniformly to shell-executing tool calls rather than something individual tools must opt into. It shares its enforcement goal with the sibling component PiSearchConventionDocs, specifically `pi.sh`'s `_pi_write_append_system()`, which writes the same search-boundary rule into `APPEND_SYSTEM.md` as prose. These two layers are explicitly designed as a matched pair: the code comment in `_pi_write_append_system()` states its prose warning exists "to stop the model SPENDING a tool call to discover the gate" — the system-prompt text is a cost optimization, while UnboundedFsScanGate is the actual backstop that fires when the prompt-level nudge fails.

## Usage Guidelines

Developers extending or modifying this gate should preserve the fail-open contract — any new failure paths added to `offendingRoot()` or `findRoots()` must be caught rather than allowed to propagate, since the gate's job is to reduce risk without introducing new blocking failure modes. Anyone updating `unboundedRoots()` should keep it centralized so both the runtime gate and the documentation in `AGENTS.md`/`APPEND_SYSTEM.md` stay conceptually aligned, even though they are enforced independently. When adding similarly "obvious in hindsight" QA rules, the precedent here is: write the rule twice — once as an actionable, model-readable block reason for the runtime gate, and once as prose warning in the system prompt — since "a blocked call costs a round trip; a model that never tries costs nothing."


## Hierarchy Context

### Parent
- [QualityAssurance](./QualityAssurance.md) -- [LLM] The `no-unbounded-fs-scan.ts` pi extension (config/agents/pi-extensions/no-unbounded-fs-scan.ts) implements quality assurance as a deterministic runtime gate rather than a prompt-level instruction. `offendingRoot()` parses shell command strings for `find` invocations rooted at whole-machine paths (`/`, `$HOME`, `/Users`, etc., enumerated in `unboundedRoots()`), and `findRoots()` deliberately stops consuming argv tokens at the first `-`-prefixed predicate so a flag value is never misread as a search root. This is a defense-in-depth pattern: the file's own comments explain that an equivalent instruction was also added to `AGENTS.md`, but the extension exists because 'a prompt-level instruction competes with the model's own reasoning at the moment the model is already improvising, which is exactly when it loses' — i.e., QA logic is pushed into code specifically because natural-language guidance proved insufficient after a 343-second production incident.

### Siblings
- [PiSearchConventionDocs](./PiSearchConventionDocs.md) -- [LLM] The `no-unbounded-fs-scan.ts` extension and `pi.sh`'s `_pi_write_append_system()` implement the same search-boundary convention through two independent enforcement layers rather than one. `offendingRoot()` (in the extension) is the deterministic runtime gate that blocks a `find` call rooted at `/`, `/Users`, `$HOME`, etc., while `_pi_write_append_system()` writes an `APPEND_SYSTEM.md` heredoc into `$cfg_dir` stating the same rule in prose ('Never search from `/`, `~`, `/Users`...'). The code comment in `_pi_write_append_system()` explicitly frames this redundancy as intentional: the prose layer exists 'to stop the model SPENDING a tool call to discover the gate' — i.e., the extension is the enforcement backstop and the system-prompt text is a cost optimization that tries to make the backstop unnecessary in the common case, since 'a blocked call costs a round trip; a model that never tries costs nothing.'


---

*Generated from 5 observations*
