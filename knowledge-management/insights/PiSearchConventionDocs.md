# PiSearchConventionDocs

**Type:** Detail

# PiSearchConventionDocs — Technical Insight Document

## What It Is

PiSearchConventionDocs describes the documentation-and-prose half of a single, dual-channel convention that prevents unbounded filesystem scans in agent-driven tooling. It is implemented in `config/agents/pi.sh`, specifically inside `_pi_write_append_system()`, which writes a heredoc into `APPEND_SYSTEM.md` under `$cfg_dir`. This file states, in prose, the same rule enforced deterministically by its sibling component, `UnboundedFsScanGate` (`offendingRoot()`/`findRoots()` in `config/agents/pi-extensions/no-unbounded-fs-scan.ts`): never run a `find` rooted at `/`, `/Users`, `$HOME`, or similar whole-machine paths. As a child concern of the parent `QualityAssurance` component, this entity represents the "soft" instructional layer, whereas the runtime hook represents the "hard" enforcement layer — together forming the complete convention that QualityAssurance implements.

## Architecture and Design

The dominant pattern is defense-in-depth: two independently sufficient mechanisms guard the same failure mode. `offendingRoot()` is a deterministic, code-level gate that blocks violating `bash` tool calls outright; `_pi_write_append_system()` is a prompt-level instrument that tries to make the gate unnecessary in the common case. The code comments make the trade-off explicit — a blocked call costs a round trip, but a model that never attempts the scan costs nothing, so the prose layer is framed as a cost optimization layered in front of a correctness backstop, not a redundant duplicate.

A second pattern is the "idempotent managed-file" convention, shared structurally with `_pi_install_extensions()`. Rather than templating or manifest-tracking generated files, each managed artifact (a Markdown prose file or a TypeScript extension file) carries an embedded ownership marker — `_PI_APPEND_MARKER` versus `_PI_EXTENSION_MARKER` — checked via `grep -qF` before any overwrite. This lets `pi.sh` distinguish tool-managed content from user-authored content using a uniform mechanism across otherwise unrelated file types.

A third pattern is scope-gated writes: `CODING_AGENT_SCOPE` determines whether shared config surfaces may be touched at all, independent of the marker check. This produces an asymmetric outcome between the two write functions, discussed below.

## Implementation Details

`_pi_write_append_system()` short-circuits entirely under global scope (`[ "$scope" = "global" ] && return 0`), refusing to touch a user's `~/.pi/agent/APPEND_SYSTEM.md`. This differs from `_pi_install_extensions()`, which still attempts writes under global scope, falling back only to its marker check. The practical consequence: under `CODING_AGENT_SCOPE=global`, the deterministic gate in `no-unbounded-fs-scan.ts` may still be installed, but the prose reinforcement is dropped unconditionally, leaving the runtime hook as sole enforcement for global installs.

The heredoc body is structured as a three-part decision tree: (1) a positive instrument to reach for first (`find .`, `git ls-files`), explicitly noting pi's toolset has "no separate find or grep tool to reach for"; (2) a named prohibition citing a concrete cost figure ("343s measured here"); (3) a fallback dispatch table for common cases (`~/.Trash` for deletions, `which`/`npm ls`/`brew list` for installed packages, named paths for known checkouts). This mirrors `offendingRoot()`'s block-reason string almost verbatim, confirming both texts were authored as one convention with two delivery mechanisms — proactive versus reactive.

Unlike `_pi_install_extensions()`, which uses `cmp -s` before `cp` to preserve mtime (protecting pi's path-based extension cache), `_pi_write_append_system()` unconditionally overwrites via `cat > "$f"` once past the marker/scope gates. This is a deliberate omission, not an inconsistency: `APPEND_SYSTEM.md` is re-read per launch as system-prompt text, not cached by path like a loaded extension module, so mtime preservation is irrelevant here.

## Integration Points

The entity is tightly coupled to its sibling, `UnboundedFsScanGate`: both cite identical figures and alternatives, and both scope their claims to pi's documented tool surface (read/bash/edit/write — no dedicated find/grep tool). This scoping matters operationally: because no alternative search tool exists, `bash` is the only path by which an unbounded scan could occur, which is why the corresponding `tool_call` hook filtering on `isToolCallEventType('bash', event)` provides complete coverage rather than partial mitigation. The convention also integrates with `_pi_install_extensions()` through the shared marker-based ownership pattern, and with `CODING_AGENT_SCOPE` as a cross-cutting configuration input governing both write paths.

## Usage Guidelines

Developers modifying either half of this convention should keep the two texts synchronized — the 343-second figure, `~/.Trash`, and package-manager fallbacks must match between `APPEND_SYSTEM.md`'s prose and `offendingRoot()`'s block-reason string, since they are authored as one convention. When extending scope behavior, preserve the asymmetry: `_pi_write_append_system()` intentionally forgoes global-scope writes, while extension installation may still proceed there. Any new managed file type should reuse the marker-comment ownership pattern rather than introducing a separate manifest system, and writers of frequently-read, non-cached files should avoid unnecessary `cmp`-based optimizations meant for path-cached artifacts.


## Hierarchy Context

### Parent
- [QualityAssurance](./QualityAssurance.md) -- [LLM] The `no-unbounded-fs-scan.ts` pi extension (config/agents/pi-extensions/no-unbounded-fs-scan.ts) implements quality assurance as a deterministic runtime gate rather than a prompt-level instruction. `offendingRoot()` parses shell command strings for `find` invocations rooted at whole-machine paths (`/`, `$HOME`, `/Users`, etc., enumerated in `unboundedRoots()`), and `findRoots()` deliberately stops consuming argv tokens at the first `-`-prefixed predicate so a flag value is never misread as a search root. This is a defense-in-depth pattern: the file's own comments explain that an equivalent instruction was also added to `AGENTS.md`, but the extension exists because 'a prompt-level instruction competes with the model's own reasoning at the moment the model is already improvising, which is exactly when it loses' — i.e., QA logic is pushed into code specifically because natural-language guidance proved insufficient after a 343-second production incident.

### Siblings
- [UnboundedFsScanGate](./UnboundedFsScanGate.md) -- offendingRoot() in config/agents/pi-extensions/no-unbounded-fs-scan.ts splits a shell command on operators (||, &&, ;, |, $(, backtick) and checks each segment for a `find` invocation rooted in unboundedRoots() (/, /Users, /home, $HOME, etc.)


---

*Generated from 9 observations*
