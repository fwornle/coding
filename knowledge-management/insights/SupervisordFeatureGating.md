# SupervisordFeatureGating

**Type:** Detail

## What It Is

SupervisordFeatureGating is the mechanism implemented within `docker/entrypoint.sh` (a subsection of its parent, DockerComposeStartupScript) that selectively disables supervisord-managed programs at container startup based on a feature snapshot. It reads a flat JSON file at `/coding/.coding/runtime/features.json`, which is mounted read-only into the container and written by the host — the host's `~/.coding/features.yaml` itself is never mounted directly. The mechanism translates feature flags into supervisord configuration overrides without modifying the canonical `supervisord.conf`.

## Architecture and Design

The design centers on a hardcoded mapping, `PROGRAM_FEATURES`, expressed as a space-separated string like `semantic-analysis:knowledge constraint-monitor:constraints health-dashboard:health`, iterated via a shell `for` loop. Rather than parsing JSON with a dedicated tool, the script shells out to `node -e` for each pair to evaluate `snap.features[feature]` — a deliberate substitution necessitated by the fact that `jq` is absent from the image (per an inline comment). This is a pragmatic dependency trade-off: Node.js is assumed present (likely for the broader application runtime), so it's reused as an ad hoc JSON parser rather than adding a new binary dependency.

The output side of the design writes gating decisions to a separate include file, `/etc/supervisor/features.d/disabled.conf`, containing `autostart=false` overrides. This keeps `supervisord.conf` as the single source of truth for program definitions, layering feature gating as an additive, non-invasive overlay — a clean separation-of-concerns pattern that avoids rewriting or templating the main config.

## Implementation Details

For each `program:feature` pair in `PROGRAM_FEATURES`, the loop invokes `node -e` to look up `snap.features[feature]` in the parsed JSON snapshot. Two fail-open behaviors are deliberately baked in at different levels:

1. **Unknown/missing feature key**: defaults to `true` (enabled) inside the `node -e` script itself, justified by the comment that "a snapshot written by an older host cannot silently switch a program off" — protecting against version skew between host and container.
2. **Missing snapshot file entirely**: skips gating altogether, starting everything — a coarser, file-level fail-open guard.

Only programs whose resolved feature value is `false` get an explicit `autostart=false` line written into `disabled.conf`; nothing is written for enabled programs, keeping the override file minimal and diff-friendly.

## Integration Points

This component depends on an external, host-written artifact (`features.json`) whose presence and mount are outside its control — it only reads, never writes, that snapshot. It integrates with supervisord's native config-include mechanism via `/etc/supervisor/features.d/disabled.conf`, meaning correctness depends on supervisord being configured to load `.d` includes alongside `supervisord.conf`. Structurally, it lives alongside its sibling, EnvFileSecretFiltering, within the same `docker/entrypoint.sh` script under DockerComposeStartupScript — both are startup-time, shell-scripted gating/filtering passes over external input (a JSON snapshot here vs. a `.env` file for the sibling), though they address unrelated concerns (feature toggling vs. secret exposure).

## Usage Guidelines

Developers adding a new gated program must extend the hardcoded `PROGRAM_FEATURES` string with a new `program:feature` pair — there is no dynamic registration. Because unknown feature names default to enabled, omitting or misnaming a feature key silently keeps the program running rather than disabling it, so mapping accuracy matters. Since `jq` is intentionally not used, any modification to the JSON-parsing logic should be made through the `node -e` invocation. Finally, because the whole gating step is skipped when `features.json` is absent, deployments must ensure the snapshot mount is present if selective disabling is required; its absence is a silent fail-open, not an error condition.


## Hierarchy Context

### Parent
- [DockerComposeStartupScript](./DockerComposeStartupScript.md) -- [LLM] docker/entrypoint.sh implements the container-side half of the feature-gating mechanism described in its own inline comments: it reads a flat JSON snapshot at /coding/.coding/runtime/features.json (mounted read-only, written by the host, never the host's ~/.coding/features.yaml itself since that file is never mounted into the container) and, for each entry in the hardcoded PROGRAM_FEATURES mapping (e.g. semantic-analysis:knowledge, constraint-monitor:constraints, health-dashboard:health), invokes `node -e` — not jq, which is explicitly absent from the image — to check snap.features[feature] and writes an `autostart=false` supervisord include into /etc/supervisor/features.d/disabled.conf for anything that resolves to false. An unknown feature name defaults to enabled, so an older host snapshot can never accidentally disable a program it doesn't know about.

### Siblings
- [EnvFileSecretFiltering](./EnvFileSecretFiltering.md) -- [LLM] The entire EnvFileSecretFiltering behavior lives in a single while-loop in docker/entrypoint.sh (the `if [ -f /coding/.env ]; then ... done < /coding/.env` block): it streams the bind-mounted host .env line by line with `IFS='=' read -r key value`, skips comment (`^[[:space:]]*#`) and blank lines, trims the key with `xargs`, and then runs a `case "$key" in *_API_KEY|*_TOKEN|*_MANAGEMENT_KEY) continue ;; esac` before ever exporting anything — so filtering happens by KEY-NAME PATTERN alone, never by inspecting the value, meaning a secret stored under a name that doesn't match one of those three suffixes (e.g. a bare `SECRET`, `PASSWORD`, or a service-specific credential var) passes through untouched.


---

*Generated from 5 observations*
