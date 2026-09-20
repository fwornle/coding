# FeatureGatingOverrideLayer

**Type:** Detail

# FeatureGatingOverrideLayer — Technical Insight Document

## What It Is

FeatureGatingOverrideLayer is implemented in `docker/entrypoint.sh` as part of the broader ApiAndDashboardWrappers component. Its concrete mechanism is a bash loop iterating over a hardcoded `PROGRAM_FEATURES` mapping (e.g. `constraint-monitor:constraints`, `health-dashboard:health`), which for each entry shells out to a fresh `node -e` invocation to read `snap.features?.[feature]` from a host-mounted, read-only snapshot at `/coding/.coding/runtime/features.json`. The resolved true/false values are written into a regenerated `/etc/supervisor/features.d/disabled.conf`, which supervisord loads alongside `supervisord.conf`. This is strictly an override layer: it never defines or alters program commands/logging, only whether a program autostarts.

## Architecture and Design

The dominant pattern is **override-not-rewrite configuration layering**: `disabled.conf` sits atop `supervisord.conf` without touching program definitions, relying entirely on supervisord's own include-order precedence to merge the two. Critically, the generator only ever emits `autostart=false` stanzas — there is no code path that re-enables a program via this file — making the generated config a purely negative, diffable signal of what's silenced on a given boot.

The second pillar is **fail-open-by-default with explicit rationale**, applied redundantly at two layers: JavaScript's optional chaining (`snap.features?.[feature]`) returns undefined (→ enabled) for missing keys, while the shell's `|| echo "true"` catches total node failure (parse errors, missing file). The documented justification — that a silently-empty container is harder to diagnose than one running too much — is consistent across this layer and its sibling ApiServiceWrapper/DashboardServiceWrapper, which apply the same philosophy to their own probes (DB wait-loops that never hard-fail).

A notable design cost is the **per-pair node spawn**: rather than parsing the JSON snapshot once, entrypoint.sh spawns eight separate `node -e` processes for eight hardcoded pairs, so a single malformed `features.json` produces eight independent crashes, each individually swallowed by the same fallback — obscuring the real failure mode (bad JSON) behind what looks like eight instances of "feature not found."

## Implementation Details

The core loop rebuilds `$FEATURES_DIR` from scratch every start (`rm -f "$FEATURES_DIR"/*.conf`), guaranteeing no stale stanzas persist across restarts. For each `PROGRAM_FEATURES` pair, the inline JS evaluates to the literal strings `'true'`/`'false'`, and only a resolved `false` produces a `[program:name]\nautostart=false` stanza in the output file — matching the design intent that the file's only observable effect is negative.

Alongside the feature-gating loop, entrypoint.sh's `.env`-loading path applies a **T2 egress-lockdown filter**: a single bash `case` glob (`*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY`) is the entire enforcement boundary preventing raw provider credentials from entering the container environment. This is architecturally the same class of control as `scripts/prompt-classifier-service.mjs`'s `ENV_FILE`/`process.loadEnvFile` block, which strips empty-string vars before loading — both are string-matching security boundaries rather than a vault, and both are self-documented as fragile (a credential-shaped var not matching the glob leaks through unfiltered).

## Integration Points

FeatureGatingOverrideLayer's correctness depends on three independently-maintained sources of truth staying aligned: the hardcoded `PROGRAM_FEATURES` mapping in `docker/entrypoint.sh`, the `[program:...]` stanzas in `supervisord.conf`, and `lib/features/catalogue.cjs`. Only `tests/features/container-gating.test.mjs` (not itself examined here) guards this drift risk — a pattern mirrored structurally by `tests/features/service-gating.test.mjs`, which cross-validates `SERVICE_CONFIGS` feature declarations against `FEATURE_IDS` from the same catalogue and asserts `SERVICE_ORDER` invariants (e.g., `transcriptMonitor`/`liveLoggingCoordinator` must start first).

Within its parent ApiAndDashboardWrappers, this layer coexists with a TCP-probe wait phase (`wait_for_service`, described under sibling DashboardServiceWrapper) that shares the fail-open philosophy but carries much lower consequence — a delayed dependency versus an entire program silently not running. Sibling ApiServiceWrapper documents the identical `node -e`/`enabled=$(... || echo "true")` construct, confirming this is one shared mechanism viewed from adjacent angles rather than duplicated logic.

More broadly, the same "verify at the protocol level, not via parsing/log inference" instinct recurs in `scripts/start-services-robust.js`'s `waitForPortBindable()`, and the same table-driven, structurally-tested configuration approach recurs in `SERVICE_CONFIGS`/`SERVICE_ORDER`, suggesting a house style favoring data-shape validation and direct probes over imperative or log-based inference.

## Usage Guidelines

Any change to `supervisord.conf`'s `[program:...]` sections or to `lib/features/catalogue.cjs` must be manually mirrored in `PROGRAM_FEATURES`; this is not enforced at runtime, only by `tests/features/container-gating.test.mjs`, so this test must be run/kept green whenever programs or features are added or renamed. Operators should treat `/etc/supervisor/features.d/disabled.conf` as a diagnostic artifact — diffing it across boots reliably shows exactly what got disabled — rather than a place to hand-edit enable rules, since the generator never writes `autostart=true`. When debugging a program that unexpectedly failed to start, check for node crashes in the per-pair `node -e` invocations first, since parse failures and legitimately-absent features currently produce indistinguishable log output. Finally, treat the T2 egress-lockdown glob as a naming-convention contract: any new secret-bearing env var must conform to `*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY` naming to be filtered, or it will leak through unfiltered into the container.


## Hierarchy Context

### Parent
- [ApiAndDashboardWrappers](./ApiAndDashboardWrappers.md) -- [LLM] docker/entrypoint.sh implements a feature-gating override layer that sits ON TOP of supervisord.conf rather than replacing it: it reads a host-written flat snapshot (`/coding/.coding/runtime/features.json`, mounted read-only) and, for each entry in the hardcoded `PROGRAM_FEATURES` mapping (e.g. `constraint-monitor:constraints`, `health-dashboard:health`), generates a `/etc/supervisor/features.d/disabled.conf` with `autostart=false` stanzas. This is a deliberate override-not-rewrite design: supervisord.conf remains the single place where a program's command/logging is defined, while the generated conf only flips autostart. The script explicitly documents a fail-open philosophy: a missing/unreadable snapshot, or a feature name absent from the JSON, both resolve to 'enabled' — the comment states this is because 'a container that silently ran nothing because a JSON file was late would be far harder to diagnose than one that ran too much.' This is a real architectural risk: PROGRAM_FEATURES must be kept in sync with supervisord.conf's `[program:...]` sections and with the features catalogue by hand, and only `tests/features/container-gating.test.mjs` (referenced but not shown here) catches drift.

### Siblings
- [ApiServiceWrapper](./ApiServiceWrapper.md) -- [LLM] docker/entrypoint.sh's feature-gating block (the `PROGRAM_FEATURES` loop and the `node -e` snippet that reads `/coding/.coding/runtime/features.json`) is an override layer bolted onto supervisord rather than a replacement for it: it writes only `/etc/supervisor/features.d/disabled.conf` with `autostart=false` stanzas, leaving every `[program:...]` command/logging definition in `supervisord.conf` untouched. The `enabled=$(node -e '...' || echo "true")` construct is doubly fail-open — both the inline JS (`value === false ? "false" : "true"`, so anything but an explicit `false` reads as enabled) and the shell fallback (`|| echo "true"` if node itself throws or the file is missing) resolve toward 'run it'. This means a corrupt or stale features.json degrades to 'everything starts', which is diagnosable, rather than to 'nothing starts', which the comment explicitly says would be harder to debug.
- [DashboardServiceWrapper](./DashboardServiceWrapper.md) -- [LLM] docker/entrypoint.sh implements a two-phase startup: (1) a `wait_for_service` bash function that TCP-probes Qdrant and Redis via `/dev/tcp/$host/$port` with a bounded retry loop, deliberately returning 0 even on exhaustion ('Don't fail - let supervisord handle it'), and (2) a feature-gating phase that reads `/coding/.coding/runtime/features.json` and materializes `/etc/supervisor/features.d/disabled.conf`. Both phases share the same fail-open philosophy documented in the parent observations, but the mechanisms are quite different in risk profile: the DB-wait loop just delays startup (worst case, downstream services retry against a not-yet-ready dependency), whereas the feature-gating loop determines whether entire programs (constraint-monitor, health-dashboard, etc.) run at all — a `node -e` snippet parsing the snapshot silently defaults unparseable or missing entries to 'true' (enabled), which is a much higher-consequence fail-open than a delayed DB connection.


---

*Generated from 10 observations*
