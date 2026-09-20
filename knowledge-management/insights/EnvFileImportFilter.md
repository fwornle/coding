# EnvFileImportFilter

**Type:** Detail

[LLM] There's a structural ordering dependency between the EnvFileImportFilter and entrypoint.sh's later feature-gating block: the .env loop runs first and is a simple bash `while` loop with no error handling beyond the `case`/`continue` skip, while the feature-gating section (PROGRAM_FEATURES) is comment-documented as reading a *different* file (/coding/.coding/runtime/features.json) via `node -e`. The two mechanisms are independent env-mutation strategies inside the same script — one filters and exports raw shell variables from .env, the other reads structured JSON and writes supervisord conf stanzas — yet both exist for the same underlying policy goal (fail-open / least-surprise container boot) documented in the parent context.

# EnvFileImportFilter — Technical Insight Document

## What It Is

EnvFileImportFilter is implemented in `docker/entrypoint.sh`, inside the `.env`-loading `while` loop that begins with `if [ -f /coding/.env ]`. It is a line-oriented shell filter that reads a bind-mounted `.env` file via `read -r key value` (splitting on `=`), and, before exporting each variable, checks the key against a deny pattern:

```
case "$key" in *_API_KEY|*_TOKEN|*_MANAGEMENT_KEY) continue ;; esac
```

This is the mechanism the surrounding codebase refers to as the "T2 egress lockdown" — a boundary intended to prevent raw provider secrets from a host-side `.env` file from being imported into the container's environment. It lives as a child concept of SupervisordRuntime, sharing the same script and the same general policy goal (fail-open, least-surprise container boot) as its sibling, FeatureGatingSnapshot, but operating on a completely different input file and mutation mechanism.

## Architecture and Design

The filter is a classic **deny-list pattern-match on key name**, not a content-based secret scanner. Any variable whose name ends in `_API_KEY`, `_TOKEN`, or `_MANAGEMENT_KEY` is skipped outright; anything else — including bare `SECRET`, `PASSWORD`, or `CREDENTIAL`-style names — passes through unfiltered. The security boundary is therefore a naming convention enforced syntactically, not semantically.

Layered on top of this is a **non-clobbering, additive merge** design: `if [ -z "${!key}" ]; then export "$key=$value"; fi`. This guarantees that .env-provided values only take effect when docker-compose hasn't already defined the variable, making the container's compose-level environment authoritative. This is a deliberate defense-in-depth measure — even a secret whose name evades the `case` pattern can be neutralized by pre-defining a dummy/empty value for that key in docker-compose.yml.

Structurally, this filter sits beside — but is fully independent from — the feature-gating block described in the parent, SupervisordRuntime. The `.env` loop is a simple, unstructured bash mechanism with no error handling beyond `case`/`continue`, whereas feature gating reads structured JSON (`features.json`, produced by FeatureGatingSnapshot) via `node -e` and writes supervisord conf stanzas. Both exist in the same script for the same fail-open philosophy but use unrelated data formats and mutation strategies — an instance of two independent env/config mechanisms coexisting without shared abstraction.

## Implementation Details

The parsing logic is minimal and deliberately non-general-purpose:
- Comments are skipped via `[[ "$key" =~ ^[[:space:]]*# ]] && continue`.
- Blank lines are skipped via `[[ -z "$key" ]] && continue`.
- The key is trimmed with `key=$(echo "$key" | xargs)`, but the value (everything after the first `=` from `read -r key value`) is *not* stripped, so trailing/leading whitespace on values can leak through untouched.
- There is no support for quoting, multi-line values, or escaping embedded `=` characters — the parser is adequate only for the project's own `.env` conventions, not a robust dotenv implementation.

The deny-list check runs strictly *before* the export step, so matched keys never enter the process environment at all — they are skipped, not exported with an empty placeholder. This distinction matters downstream: code that does `process.env.SOME_API_KEY` sees `undefined`, not `""`. This is consistent with the house convention seen in `scripts/prompt-classifier-service.mjs`, which explicitly deletes any env var whose value is an empty string (`if (v==='') delete process.env[k]`), treating "absent" and "empty" as equivalent. The convention is duplicated, not centralized, between the container's shell-based filter and the host's Node-based loader.

Notably, the filter is the *only* place in `entrypoint.sh` with an inline rationale comment ("T2 egress lockdown: never import raw provider keys/tokens…"), suggesting it was a later, security-motivated patch retrofitted onto an already-existing `.env`-loading loop rather than part of the original bring-up design — contrasted with the larger prose block documenting feature gating elsewhere in the file.

## Integration Points

EnvFileImportFilter operates entirely within `docker/entrypoint.sh`, under the SupervisordRuntime parent, and has no shared code path with its sibling FeatureGatingSnapshot beyond co-location in the same script and adherence to the same fail-open philosophy. It implicitly depends on docker-compose to set authoritative environment values ahead of container start, since its non-override guard treats any pre-existing environment variable as taking precedence over `.env`. It also has an unenforced, convention-only relationship with `scripts/prompt-classifier-service.mjs`'s env-handling code — both treat empty and absent as equivalent, but this is not shared logic, just a repeated house convention that could drift if one side changes independently.

## Usage Guidelines

Developers should not treat this filter as a general-purpose or content-aware secret scanner: any secret whose variable name does not end in `_API_KEY`, `_TOKEN`, or `_MANAGEMENT_KEY` will pass straight through. New secret-bearing env vars should follow these naming suffixes if they must be excluded from container import, or should instead be pre-defined in docker-compose.yml (even as empty strings) to leverage the non-override guard as a second line of defense. Because unstripped whitespace and lack of quoting support make this a fragile parser, `.env` files consumed by this loop should avoid quoted, multi-line, or complex values. Finally, since skipped keys are wholly absent (not empty) in `process.env`, downstream code should check for `undefined` rather than assuming an empty string, matching the existing convention in `scripts/prompt-classifier-service.mjs`.


## Hierarchy Context

### Parent
- [SupervisordRuntime](./SupervisordRuntime.md) -- [LLM] docker/entrypoint.sh implements a fail-open feature-gating layer that sits in front of supervisord rather than inside it: it reads a host-written snapshot at /coding/.coding/runtime/features.json (mounted read-only) and, for each entry in the PROGRAM_FEATURES mapping (e.g. `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `health-dashboard:health`), shells out to `node -e` to read the flag and writes a `[program:<name]\nautostart=false` stanza into /etc/supervisor/features.d/disabled.conf when a feature is off. Because supervisord.conf's `[include]` directive pulls in that directory, the override never touches the canonical program definitions — it only flips autostart. The script deliberately treats an absent snapshot, an unreadable snapshot, or an unknown feature key as 'enabled' (comment: 'starts everything — the historical behaviour'), which is a conscious fail-open decision to avoid a container that silently runs nothing because a JSON file arrived late.

### Siblings
- [FeatureGatingSnapshot](./FeatureGatingSnapshot.md) -- [LLM] docker/entrypoint.sh implements feature gating as a translation layer between two incompatible configuration worlds: the host-side YAML feature resolver (~/.coding/features.yaml, never mounted into the container) and supervisord's own `[include]`-based config system. Rather than teaching the container how to resolve features itself, the design pushes resolution entirely to the host and reduces the container's job to consuming a flat, pre-resolved JSON snapshot at /coding/.coding/runtime/features.json. The `PROGRAM_FEATURES` string (e.g. `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `health-dashboard:health`) is a hardcoded space-separated list parsed with `${pair%%:*}`/`${pair##*:}` — a shell-native map emulation that trades readability for zero external dependencies, since the script explicitly avoids `jq` ('jq is not installed in this image, node is') in favor of invoking `node -e` per feature lookup.


---

*Generated from 9 observations*
