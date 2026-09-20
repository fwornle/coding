# FeatureGatingScript

**Type:** Detail

[Architectural Patterns] Additive override / filter layer pattern — entrypoint.sh generates a supplementary supervisord include (disabled.conf) rather than rewriting the canonical config, keeping supervisord.conf as single source of truth; Fail-open-by-default with layered redundant safety nets — entrypoint.sh stacks three independent fallback paths (ternary default, subprocess-failure fallback, missing-file fallback) all converging on 'enable'; Escalating retry / graceful-then-forceful shutdown pattern — killProcessOnPortAndWait's SIGTERM-then-SIGKILL-after-half-timeout in scripts/start-services-robust.js; Active probing over passive inference — waitForPortBindable uses a real bind attempt instead of inferring kernel socket state from logs or listener checks; Three-layer duplicate-detection cascade — transcriptMonitor's startFn checks PSM-global, PSM-per-project, then OS-level pgrep before spawning, self-healing PSM's bookkeeping via re-registration; Strategy/mode toggle via env var with unreachable legacy path — start-services.sh's ROBUST_MODE gate and `exec` guarantee; Hot-reload-on-mtime config pattern — prompt-classifier-service.mjs's loadConfig mirrors llm-routing.yaml's convention, keeping last-good config on parse failure; Structural coverage tests as an architectural safety net — tests/features/service-gating.test.mjs enforces catalogue/config/order consistency independent of runtime behavior tests

# FeatureGatingScript — Technical Insight Document

## What It Is

FeatureGatingScript is the umbrella concept covering two independently-implemented feature-gating mechanisms that gate process startup based on a shared feature catalogue: the container-side implementation in `docker/entrypoint.sh` (lines ~100-140) and the host-side implementation in `scripts/start-services-robust.js`. As a child concept of `DockerComposeOrchestration`, it exists specifically as an additive filter layer over `docker/supervisord.conf` — it never rewrites the canonical supervisor configuration, only supplements it via a generated `disabled.conf` include. Its sibling, `EnvFileImportFilter`, shares the same `entrypoint.sh` file but solves an unrelated problem (credential egress lockdown); the two should not be confused despite living side by side in the same script.

The container side reads a host-written snapshot (`/coding/.coding/runtime/features.json`) and, for each `program:feature` pair in the `PROGRAM_FEATURES` enumeration, decides whether to autostart that supervisord program. The host side, `SERVICE_CONFIGS` in `start-services-robust.js`, performs the analogous check for Node-orchestrated services, with contract behavior enforced by `tests/features/service-gating.test.mjs`.

## Architecture and Design

The dominant pattern is **additive override rather than rewrite**: `entrypoint.sh` writes `/etc/supervisor/features.d/disabled.conf`, which supervisord includes alongside the main config, preserving `supervisord.conf` as single source of truth per the parent `DockerComposeOrchestration` principle.

A second pattern, **fail-open by default with layered redundant safety nets**, is deliberately stacked three deep in the container script: the `node -e` ternary (`value === false ? "false" : "true"`) collapses any non-literal-false value to "true"; a shell `|| echo "true"` catches subprocess failure (malformed JSON, permission errors); and a missing snapshot file leaves `features.d` empty entirely, starting everything. All three converge on "start it," reflecting the explicit design principle that under-starting is worse than over-starting.

Critically, this fail-open philosophy is **not mirrored** on the host side. `start-services-robust.js`'s `startOneService` is asserted (via the "unknown feature on a config is a loud failure" test) to `assert.rejects(..., /unknown feature 'nope'/)` — a fail-loud policy. This isn't inconsistency; it's a structural asymmetry justified by different failure sources: the container's unknown key arises from deployment skew (an older host snapshot against newer code), which must be safe-permissive, whereas the host script's unknown feature is a hardcoded typo in `SERVICE_CONFIGS`, a programmer error that should surface loudly and immediately.

A related orthogonality: `required: true` (e.g., on `transcriptMonitor` and `liveLoggingCoordinator`) and `feature`-gating are checked in a specific order — feature-gate first, required-ness second. A required-but-feature-disabled service is routed to `results.disabled` and never touches the blocking path, meaning "required" only has teeth once a feature is already enabled.

## Implementation Details

In `entrypoint.sh`, the `for` loop iterates the flat `PROGRAM_FEATURES` string (e.g., `semantic-analysis:knowledge`, `constraint-monitor:constraints`) and shells out to `node -e` rather than `jq`, because `jq` isn't installed in the image — a deliberate micro-tool substitution. Each iteration's ternary, subprocess fallback, and missing-file fallback compose the three fail-open layers described above.

On the host side, `SERVICE_CONFIGS` entries drive `startOneService`, whose contract (body not shown, but fully inferable from tests) implements: disabled-skip, disabled-not-degraded, required-off-doesn't-block, required-failure-blocks, and unknown-feature-throws. `tests/features/service-gating.test.mjs` also structurally asserts `SERVICE_CONFIGS`/`SERVICE_ORDER` coverage — a stronger consistency guarantee than the container side, whose correctness depends entirely on `tests/features/container-gating.test.mjs` cross-checking `PROGRAM_FEATURES` against `supervisord.conf`'s `[program:...]` sections at CI time, with no runtime self-check inside `entrypoint.sh` itself.

Adjacent to but distinct from the gating logic, `start-services.sh` implements a strategy-toggle pattern: `ROBUST_MODE` gates an `exec node ...` call that, via `exec`'s process-replacement semantics, makes ~200 lines of legacy bash (`# LEGACY MODE`) provably unreachable whenever `ROBUST_MODE` is unset or "true" (the default). That legacy path uses grep-based `docker-compose ps | grep healthy` polling and hardcoded `docker run` fallbacks (`qdrant/qdrant:v1.15.0`, `redis:7-alpine`), lacking the robust path's `waitForPortBindable` active-bind probing and `killProcessOnPortAndWait` SIGTERM-then-SIGKILL escalation.

## Integration Points

FeatureGatingScript sits directly beneath `DockerComposeOrchestration` and operates alongside `EnvFileImportFilter` inside the same `entrypoint.sh` file, though the two serve unrelated concerns — one gates process autostart, the other blocks credential import (`*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY`) as a T2 egress-lockdown boundary supporting the host `llm-cli-proxy` routing model.

The container and host implementations duplicate the `PROGRAM_FEATURES`/`SERVICE_CONFIGS` mapping concept independently, with **no shared code** — only shared tests (`tests/features/container-gating.test.mjs`, `tests/features/service-gating.test.mjs`) and shared documentation (`docs/architecture/features.md`). Similarly, `SERVICE_ORDER` and `SERVICE_CONFIGS` are only kept coherent by test coverage, not by a shared derivation — they could drift silently in source, with CI as the only guardrail.

`scripts/prompt-classifier-service.mjs` is a loosely related consumer of environment/config conventions in the same family of scripts: it deletes empty-string env vars process-wide at import time before calling `process.loadEnvFile(ENV_FILE)`, and separately tunes `KEEPALIVE_MS` (240000ms) against an empirically observed llama.cpp cache-eviction incident — illustrating the broader codebase pattern of environment-driven, heuristic-tuned service behavior alongside the feature-gating mechanisms.

## Usage Guidelines

Developers modifying `PROGRAM_FEATURES` in `entrypoint.sh` must keep it manually synchronized with `supervisord.conf`'s `[program:...]` sections and the feature catalogue; this is enforced only by `tests/features/container-gating.test.mjs`, not by any compile-time check, so that test must run in CI for the mapping to be trustworthy. Likewise, changes to `SERVICE_CONFIGS`/`SERVICE_ORDER` in `start-services-robust.js` require `tests/features/service-gating.test.mjs` to pass to catch drift.

Do not treat the container's fail-open unknown-feature behavior and the host's fail-loud behavior as something to "fix" into consistency — they are deliberately opposite due to differing failure sources (deployment skew vs. typo) and should remain so. When adding new services with `required: true`, remember that required-ness never blocks startup for a feature-disabled service; it only matters once the feature is on.

The `ROBUST_MODE` legacy branch in `start-services.sh` has no test coverage and lacks the port-bindability and graceful-shutdown improvements of the robust path — it should be treated as unmaintained technical debt, not a safe fallback, and flipping `ROBUST_MODE` off in an emergency would reintroduce previously-fixed race conditions. Finally, anyone importing `prompt-classifier-service.mjs` as a library rather than running it standalone should be aware it mutates `process.env` globally as a side effect of import — a scoping hazard worth guarding against in future refactors.


## Hierarchy Context

### Parent
- [DockerComposeOrchestration](./DockerComposeOrchestration.md) -- [LLM] docker/entrypoint.sh implements a fail-open feature-gating override rather than a rewrite of docker/supervisord.conf: it reads a flat host-written snapshot at /coding/.coding/runtime/features.json (mounted read-only) and, for each entry in the PROGRAM_FEATURES mapping (e.g. 'semantic-analysis:knowledge', 'constraint-monitor:constraints', 'health-dashboard-frontend:health'), shells out to `node -e` (not jq, which the comment notes isn't installed in the image) to check `snap.features?.[feature]`. Any program whose feature reads `false` gets an autostart=false stanza written into /etc/supervisor/features.d/disabled.conf, which supervisord includes alongside the main config. Critically, an unknown/missing feature key resolves to 'true' by design ('a snapshot written by an older host cannot silently switch a program off'), and a missing/unreadable snapshot file leaves the entire features.d directory empty, starting every program — the pre-existing historical behavior. This directly implements the DockerizedServices principle from the parent context that supervisord.conf is the single source of truth for in-container processes, while this script is merely an additive filter over it.

### Siblings
- [EnvFileImportFilter](./EnvFileImportFilter.md) -- [LLM] docker/entrypoint.sh's .env import loop (`while IFS='=' read -r key value; do ... done < /coding/.env`) implements a T2 egress-lockdown filter distinct from the fail-open feature-gating logic described in the parent context: it uses a `case "$key" in *_API_KEY|*_TOKEN|*_MANAGEMENT_KEY) continue ;; esac` pattern to categorically refuse importing any variable whose name matches those suffixes, regardless of what the container might otherwise do with it. The comment is explicit that this is a security boundary, not a convenience filter: 'Importing them here would silently re-enable direct provider calls from in-container SDK clients,' meaning the entire purpose of routing LLM/embedding egress through the host llm-cli-proxy (:12435) depends on this loop never granting the container a raw provider credential, even one accidentally present in the bind-mounted host .env.


---

*Generated from 10 observations*
