# NoUnboundedFsScanGuard

**Type:** Detail

[Architecture Notes] no-unbounded-fs-scan.ts is decomposed into pure, exported helper functions (`offendingRoot`, `findRoots`, implicitly `unboundedRoots`) separated from the side-effecting `pi.on('tool_call', ...)` handler, making the security-relevant parsing logic unit-testable independent of the pi extension runtime; The guard operates purely on the shell command string and `cwd` passed via the tool-call event — it has no access to and does not attempt to inspect actual filesystem state, making it a static/lexical policy check rather than a runtime sandboxing mechanism; Configuration and installation of the guard is entirely owned by config/agents/pi.sh's shell functions (`_pi_install_extensions`, `_pi_write_append_system`), not by the TypeScript extension itself — the extension is passive source that only becomes active once copied into pi's discovered `extensions/` directory; Scope-awareness is threaded through the installer (`CODING_AGENT_SCOPE=global` vs wrapper-local) so the same guard source can be deployed either narrowly (wrapper-owned scratch dir, always overwritten) or globally (`~/.pi/agent`, user-owned, marker-gated to avoid clobbering user customizations); The guard is agent-specific (pi only) — copilot.sh and opencode.sh have no equivalent filesystem-scan protection, showing the security-hardening layer is applied per-agent rather than as a shared cross-agent hook, consistent with each agent file's self-contained `agent_check_requirements`/`agent_pre_launch`/`agent_cleanup` hook triad

# NoUnboundedFsScanGuard: Technical Insight Document

## What It Is

NoUnboundedFsScanGuard is implemented at `config/agents/pi-extensions/no-unbounded-fs-scan.ts`, a ~80-line TypeScript extension for the `pi` coding agent that intercepts `bash` tool calls before execution and blocks filesystem scans rooted at whole-machine paths (e.g., `find /`, `find ~`, `find /Users`). It is installed and activated by `config/agents/pi.sh` via `_pi_install_extensions()`, which copies the file into pi's per-agent `extensions/` directory at launch time, and is reinforced by a natural-language twin in `APPEND_SYSTEM.md` written by `_pi_write_append_system()`. As a child of BaseAgent (BaseAgent contains NoUnboundedFsScanGuard), it functions as a hard runtime safety layer analogous to — but architecturally distinct from — BaseAgent's own template-method pipeline of `process() → calculateConfidence() → detectIssues() → generateRouting() → applyCorrections() → buildMetadata()`.

## Architecture and Design

The guard is a textbook instance of the **PreToolUse / deterministic pre-execution gate** pattern: `pi.on('tool_call', ...)` synchronously inspects and can veto a bash invocation before it runs, rather than trusting the LLM's judgement alone. Internally it follows a compressed lexer→parser→policy pipeline: `unboundedRoots()` supplies a static deny-list, `findRoots(argv)` parses `find`'s positional-then-flag argv convention (stopping at `-`-prefixed tokens, `(`, or `!`), and `offendingRoot(command, cwd)` orchestrates command-splitting (on `||`, `&&`, `;`, `|`, newlines, `$(`, backticks) and root resolution. This decomposition into pure, exported functions separated from the side-effecting `tool_call` handler is a deliberate maintainability choice — it makes the security-relevant parsing logic unit-testable independently of the pi runtime (Architecture Notes #9).

A defining design decision is scope restraint: the guard refuses only whole-machine roots and never rewrites the command itself, because silently narrowing `find /` to `find .` "would silently answer a different question than the one asked" and prevent the model from learning its search was too broad. This is paired with `terminate: false`, allowing the agent to retry within the same turn — correction, not termination.

## Implementation Details

`offendingRoot()` normalizes relative and `~`-prefixed paths against the actual `cwd` (`path.resolve(cwd, r.replace(/^~(?=$|\/)/, os.homedir()))`), closing the evasion where `find ../../../..` could reach `/` without literally naming it. It also strips leading `sudo`/`time`/`nice`/`nohup`/`command`/`env` wrappers before checking the binary name via `path.basename(unquote(argv[0]))`, so wrapped invocations are caught identically to bare ones. The code explicitly frames this as heuristic, not hardened: "the failure direction is to miss an exotic spelling, never to block an innocent one."

The handler's try/catch is annotated as intentionally **fail-open**: internal errors are swallowed so a bug in the guard cannot disable bash execution entirely — treating an unbounded scan (recoverable, if slow) as strictly less costly than total agent paralysis. This inverts but mirrors the conservative-failure philosophy noted elsewhere in `selectBatchesForReport()` (integrations/system-health-dashboard/batch-provenance.mjs), which degrades toward under-inclusion rather than guessing.

Refusal responses are structured (`{ block: true, reason, terminate: false }`) with `reason` engineered as a **teaching-oriented artifact**: it names the rule, cites a measured incident cost ("343s on this machine"), and enumerates alternatives (`find .`, `git ls-files`, `~/.Trash`, package-manager lookups) — visible in the transcript for the model to learn from, not just a bare deny code.

## Integration Points

Installation and lifecycle are entirely owned by shell-layer functions in `config/agents/pi.sh`, not the TypeScript source itself: the extension is passive until `_pi_install_extensions()` copies it (not symlinks it — pinning behavior to launch time against mid-edit or branch-switch drift) into `$cfg_dir/extensions/`, gated by a `_PI_EXTENSION_MARKER` sentinel that distinguishes installer-owned files from user-authored ones, critical under `CODING_AGENT_SCOPE=global` where the target is the user-owned `~/.pi/agent/extensions`. This marker/sentinel convention parallels `_PI_APPEND_MARKER` in `APPEND_SYSTEM.md`, forming a **belt-and-braces defense**: the prompt-level guidance catches the common case cheaply (a blocked call costs a round trip; a model that never tries costs nothing), while the extension is the deterministic backstop.

The guard is agent-specific: `copilot.sh` and `opencode.sh` implement no equivalent protection, though both share its underlying philosophy of collapsing competing decision paths into one — `opencode.sh` retiring `CODING_OPENCODE_NO_PROXY` for a single `llm-routing.yaml` path, and `copilot.sh` deferring BYOK decisions to `configure_proxy_routing()` to avoid WR-02/WR-05 double-write bugs. Its sibling, OpenCodeVariantBandSplicing (`_oc_splice_config()`), reflects the same "enforce an invariant once, centrally" instinct applied to JSON composition rather than security policy.

## Usage Guidelines

Developers extending this guard should preserve its pure/side-effect separation (`offendingRoot`, `findRoots`, `unboundedRoots` vs. the `tool_call` handler) to keep it unit-testable. Any new deny-list entries belong in `unboundedRoots()`; new evasion vectors (additional wrapper commands, shell operators) should extend the existing stripping/splitting logic rather than introducing parallel checks. The guard must remain fail-open and non-terminating by design — do not change error handling to fail-closed, and do not have it rewrite commands rather than refuse them, since both would violate its stated pedagogical and availability goals. Because it is a static/lexical check with no real filesystem access, it should not be mistaken for a sandboxing mechanism; and because it is pi-specific, equivalent protection for copilot.sh or opencode.sh would need independent implementation, not reuse.


## Hierarchy Context

### Parent
- [BaseAgent](./BaseAgent.md) -- [LLM] The parent observation describing BaseAgent's template-method execute() pipeline (process() → calculateConfidence() → detectIssues() → generateRouting() → applyCorrections() → buildMetadata()) is not directly visible in the provided code files, but the surrounding config/agents/*.sh scripts (copilot.sh, opencode.sh, pi.sh) reveal a parallel template-method philosophy at the shell layer: each agent definition file sources common hooks (agent_check_requirements, agent_pre_launch, agent_cleanup) that are called uniformly by launch-agent-common.sh, mirroring the same 'implement the hooks, let the orchestrator drive the sequence' pattern that BaseAgent enforces in TypeScript. This suggests the project applies the template-method pattern consistently across both its LLM-agent pipeline and its CLI-agent launch pipeline.

### Siblings
- [OpenCodeVariantBandSplicing](./OpenCodeVariantBandSplicing.md) -- [LLM] opencode.sh's `_oc_splice_config()` (config/agents/opencode.sh) exists solely to fix a JSON-composition bug: the two former call sites inlined `{${frag},${OPENCODE_CONFIG_CONTENT#\{}}`, which produces a syntactically invalid trailing-comma object (`{frag,}`) whenever the accumulator was still the empty `{}` seed. The fix centralizes the check (`if "$_cur" = '{}' or empty, then wrap; else prepend with comma`) into one function used by every later splice call (provider, command, plugin/compaction fragments), so the invariant — always-valid JSON regardless of call order — is enforced once rather than re-derived at each of the four+ splice sites in the file.


---

*Generated from 10 observations*
