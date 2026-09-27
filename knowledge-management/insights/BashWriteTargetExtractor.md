# BashWriteTargetExtractor

**Type:** Detail

## What It Is

The entity named "BashWriteTargetExtractor" has no literal class or module match in the retrieved code. The closest and clearly intended referent is the free function `bashWriteTargets(command)`, implemented in `scripts/enhanced-transcript-monitor.js`, which extracts shell redirection targets (`>`, `>>`, `tee`, `sed -i`) from a bash command string. There is no dedicated extractor module, class wrapper, or standalone file — the logic lives inline within the monitor script, which contradicts the standalone "Extractor" naming implied by the Detail entity. This should be treated as a normalized/renamed label applied over existing function-level logic rather than a separately retrieved architectural component.

## Architecture and Design

The function embodies a text-sanitization pipeline rather than a shell parser, deliberately avoiding full grammar parsing in favor of staged regex blanking: heredoc bodies are stripped first via `/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g`, then command substitutions `$(...)` are blanked in up to 4 iterative passes, and finally quoted spans are replaced with equal-length whitespace. This staged ordering is load-bearing — comments in the code explicitly note that reversing the substitution-blanking and quote-blanking steps previously caused quotes to "slide out of phase." Within `TranscriptAdapters` (the nominal parent, though no adapter-registry abstraction is actually visible in evidence), this represents a deny-list/heuristic filter pattern: the `add()` closure is a high-precision gate calibrated against a measured corpus (175 raw matches reduced to 15 true positives) rather than a formal grammar.

A second key pattern is normalization/adapter convergence: bash-derived write targets are folded into the same `modifiedFiles` array populated by structured Edit/Write tool calls via `PATH_ARG_KEYS`, unifying heterogeneous evidence sources (inferred shell text vs. structured arguments) into one output shape.

## Implementation Details

`bashWriteTargets` is invoked exclusively from `extractFileChanges(exchanges)`, inside the `SHELL_TOOL_NAMES.has(toolName)` branch, receiving the raw command string via `toolCallArgs(tc)` (`args.command || args.cmd || args.script`). Critically, the two detection regexes run over two *different* sanitized strings by design: the `>`/`>>`/`tee` scan runs over `unquoted` (command-substitution- and quote-blanked), while the `sed -i` scan runs over `text` (only heredoc-stripped, quotes intact) — because sed script arguments are always quoted, and blanking them would destroy the very target being extracted. This dual-text design is fragile to well-intentioned refactoring: collapsing to a single sanitized string would silently zero out sed-based detection.

The `add()` closure rejects: paths containing `$`, backtick, or `*` (runtime-computed), `/dev/*` and leading `&` (redirection descriptors), system directories (`/bin|/sbin|/usr|/etc|/opt|/System|/Library|/Applications|/Volumes`), sed script fragments, trailing-slash directories, `.git/` internals, `.log`/`.logs/` paths, and bare extensionless words. It also delegates to module-level `SCRATCH_PATH_RE` to drop `/tmp`, `/private/var/folders`, and `/scratchpad/` writes.

## Integration Points

`bashWriteTargets` is pure and stateless — no I/O, no imports beyond builtin regex — but tightly coupled within the same file to `toolCallArgs()` and `SHELL_TOOL_NAMES`, assuming the caller has already normalized the raw command string across agent-specific tool-call shapes. Its output feeds the shared `modifiedFiles` list, making bash-inferred targets structurally indistinguishable downstream from Edit/Write-derived artifacts. A JSDoc contract above `extractFileChanges` mandates this logic remain a free function so an offline backfill tool (not present in evidence) can re-derive artifacts identically to the live tap — any heuristic change carries a correctness obligation to that unseen consumer. Its sibling within `TranscriptAdapters`, `ClaudeJsonlTreeAdapter`, is similarly unresolvable against supplied code, suggesting the parent grouping itself may be a documentation-layer abstraction not materialized as a code module.

## Usage Guidelines

By design, this function trades recall for precision: `cp`/`mv` destinations and variable-indirected paths are explicitly out of scope. Maintainers must preserve the heredoc → substitution-blank → quote-blank ordering and must not consolidate the dual sanitized-string approach (`unquoted` vs `text`) used by the redirect and sed scans respectively, since doing so silently breaks sed detection with no visible test failure. Any change to the deny-list heuristics in `add()` should be re-validated against a real transcript corpus given its empirically-tuned false-positive suppression, and changes must be coordinated with the unseen backfill consumer implied by the `extractFileChanges` JSDoc contract.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- Within enhanced-transcript-monitor.js, `bashWriteTargets` is invoked exclusively from `extractFileChanges(exchanges)`, specifically inside the branch that checks `SHELL_TOOL_NAMES.has(toolName)` — it receives `args.command || args.cmd || args.script` pulled via `toolCallArgs(tc)` and every returned path is pushed into the same `modifiedFiles` array that Edit/Write tool calls populate via `PATH_ARG_KEYS`. This means bash-derived write targets are treated as first-class artifacts, structurally indistinguishable downstream from an agent's Edit/Write calls, even though they are inferred from shell text rather than a structured tool argument.

**Other:**
- The two regex scans that actually detect targets run over two DIFFERENT sanitized strings on purpose: the `>`/`>>`/`tee` scan runs over `unquoted` (command-substitution-blanked AND quote-blanked), while the `sed -i` scan runs over `text` (only heredoc-stripped, quotes intact) — because a sed script argument is always quoted and blanking it would destroy the very target the regex needs to read past. This dual-text design is easy to break by well-intentioned refactoring (e.g. 'simplifying' to a single sanitized string), which would silently zero out sed-based artifact detection.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- No session record in the supplied evidence discusses bash write-target extraction, heredoc handling, or shell-redirect artifact detection directly; the only SESSION-tagged material available (rapidscribe-meeting session-ID convention, obs-api contention under Jest) pertains to a different subsystem and is not applicable to this component's internals.

## Hierarchy Context

### Parent
- [TranscriptAdapters](./TranscriptAdapters.md) -- [LLM] No file in the supplied code evidence is named or scoped as 'TranscriptAdapters'. The closest candidates — enhanced-transcript-monitor.js, PiSessionReader.js, StreamingTranscriptReader.js, AdaptiveExchangeExtractor.js, PiSessionWriter.js — are transcript readers/writers referenced as imports inside enhanced-transcript-monitor.js, but none of them is shown, and no adapter-registry or adapter-interface abstraction is visible in the truncated excerpts provided.

### Siblings
- [ClaudeJsonlTreeAdapter](./ClaudeJsonlTreeAdapter.md) -- [LLM] No file, class, or export named 'ClaudeJsonlTreeAdapter' appears anywhere in the supplied code evidence. The nearest thematically-related code is in scripts/enhanced-transcript-monitor.js, which imports StreamingTranscriptReader, AdaptiveExchangeExtractor, and PiSessionReader from src/live-logging/ — three concrete transcript-parsing classes for different agent sources (Claude/opencode, and pi respectively) — but none of them is named or structured as a 'tree adapter', and no module builds or exposes a tree-shaped view of a Claude .jsonl transcript.


---

*Generated from 10 observations*
