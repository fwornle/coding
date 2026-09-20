# FeatureGatedSupervisordOverride

**Type:** Detail

# FeatureGatedSupervisordOverride: Technical Insight Document

## What It Is

FeatureGatedSupervisordOverride is implemented in `docker/entrypoint.sh` as the mechanism by which container-level feature flags translate into supervisord process control. Rather than rewriting `supervisord.conf`, the script writes an additive fragment — `disabled.conf` — into `/etc/supervisor/features.d/`, setting `autostart=false` on specific `[program:...]` sections for features that are disabled. `supervisord.conf` itself remains the single source of truth for command lines and logging configuration; this component only ever subtracts from what would otherwise run.

The gating logic is driven by a hardcoded `PROGRAM_FEATURES` mapping (eight entries, e.g. `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `health-dashboard:health`) cross-referenced against a JSON snapshot read from `/coding/.coding/runtime/features.json`. As a child of the parent **ServiceProbe** component (which owns `wait_for_service()`), this override mechanism shares ServiceProbe's fail-open philosophy but applies it to a different decision: not "is this service reachable" but "should supervisord even start this program."

## Architecture and Design

The dominant pattern here is **additive override rather than config rewrite** — a deliberate choice to keep `supervisord.conf` authoritative and let the feature layer act purely as a subtractive gate via `features.d` fragments. This avoids the risk of a generated config silently drifting from the hand-maintained one.

A second pattern is the **snapshot/handoff model**: the container cannot query the host's live feature resolver ("the container cannot run the feature resolver"), so it consumes a point-in-time JSON snapshot mounted read-only. This is structurally the same policy-extraction idea seen in the sibling-adjacent `scripts/prompt-classifier-service.mjs`, which pushes model-routing decisions into a hot-reloadable YAML service instead of embedding them in `rapid-llm-proxy`. Both cases move a decision out of its natural owner into an independently updatable surface — for entrypoint.sh, a boot-time JSON snapshot; for the classifier, a live-reloaded config file.

The design is also characterized by **asymmetric fail-open behavior**, compounding at two levels:
1. Missing snapshot → skip gating entirely, start everything, with an explicit log message.
2. Snapshot present but feature key unrecognized → treated as enabled by the inline `node -e` evaluator (`value === false ? "false" : "true"`).

This mirrors, but is materially different from, ServiceProbe's `wait_for_service()` fail-open posture: there, failing open risks skipping a liveness assertion; here, it risks running unnecessary programs. The codebase's own comments justify this asymmetry — a silently idle container is harder to diagnose than an over-provisioned one.

## Implementation Details

The mechanics center on a small number of concrete constructs:

- **`PROGRAM_FEATURES`**: a hardcoded string mapping supervisord program names to feature-catalogue keys. It must be kept in lockstep with both `supervisord.conf`'s program list and the `lib/features` catalogue — a form of tight coupling by convention rather than shared code, enforced externally by `tests/features/container-gating.test.mjs`.
- **Snapshot evaluation**: rather than using `jq` ("not installed in this image, node is"), the script shells out to `node -e` to parse `FEATURES_SNAPSHOT` and resolve an `enabled` value. The `enabled=$(...)` assignment wraps this in a `|| echo "true"` fallback, meaning any node invocation failure — missing binary, syntax error, corrupted JSON — is silently reinterpreted as "feature enabled." This is an implicit, untested dependency on Node's presence in the image.
- **`FEATURES_DIR=/etc/supervisor/features.d`**: the write target for `disabled.conf`, which contains `autostart=false` stanzas for gated programs.

This shell/supervisord-layer implementation has a structural twin at the Node orchestration layer: `scripts/start-services-robust.js`'s `startOneService`, which enforces the identical three-state model (disabled/degraded/failed) for host-spawned child processes. The two mechanisms — one shell/supervisord-based, one Node-process-based — share a policy contract (`observations: false` → `results.disabled`, never `results.degraded`) but no code path. Each is independently verified: `tests/features/container-gating.test.mjs` for the container side, `tests/features/service-gating.test.mjs` for the host side.

Critically, the host-side implementation is fail-**closed**: `service-gating.test.mjs`'s test asserting `startOneService` rejects with `/unknown feature 'nope'/` when a service config's feature name is corrupted establishes that an unrecognized feature at the host orchestration layer is a programming error worth crashing on. This is the deliberate philosophical opposite of entrypoint.sh's fail-open handling of an unrecognized key — justified because the host's `loadFeatures()` catalogue is authoritative, while the container only ever sees a derived, potentially stale snapshot of it.

## Integration Points

FeatureGatedSupervisordOverride sits within `docker/entrypoint.sh` alongside its sibling **SecureEnvImportFilter**, which filters `.env` variables during the same entrypoint execution using a denylist-by-suffix approach (`*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY`). Both components operate at container boot time inside the same script, though they address orthogonal concerns — one gates process autostart, the other filters secret-shaped environment variables — with neither sharing code with the other.

The parent **ServiceProbe** component's `wait_for_service()` operates immediately after or alongside this gating logic, using a fail-open TCP probe (`timeout 2 bash -c "echo >/dev/tcp/$host/$port"`) that always returns 0 and defers actual liveness judgment to supervisord. The feature-gating override and the service probe together define entrypoint.sh's two major fail-open decision points at container startup.

Externally, this component depends implicitly on Node's presence in the base image (for `node -e` snapshot parsing) and on a read-only mount of `/coding/.coding/runtime/features.json` produced by a host-side feature resolver process it never directly queries.

## Usage Guidelines

Developers modifying `PROGRAM_FEATURES` must simultaneously update `supervisord.conf`'s `[program:...]` sections and the `lib/features` catalogue; the only guardrail against drift is `tests/features/container-gating.test.mjs`, which asserts exact coverage in both directions. Treat this test as mandatory to run after any change to program lists or feature names.

Because the container's gating is fail-open at multiple points (missing snapshot, unrecognized key, node failure), do not rely on entrypoint.sh to enforce hard security or resource boundaries — it is designed to err toward over-provisioning, not toward blocking. If strict enforcement is required, prefer the host-side `startOneService` contract, which fails closed on unknown features.

Be aware that `start-services.sh`'s `ROBUST_MODE=${ROBUST_MODE:-true}` flag can bypass the entire tested feature-gating contract: setting `ROBUST_MODE=false` routes through a legacy shell implementation with its own ad hoc Docker/Qdrant/Redis orchestration that participates in none of the disabled/degraded/failed guarantees. This flag should be left at its default in any environment where feature-gating correctness matters, and any legacy-mode changes should not be assumed to inherit the modern contract's safety properties.

Finally, since the container never queries a live feature resolver, expect a version-skew window between host feature state and container behavior whenever the snapshot is stale — this is an inherent, accepted trade-off of the snapshot/handoff design, not a bug to fix locally.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- [LLM] docker/entrypoint.sh's wait_for_service() function (lines defining `wait_for_service()`) implements the same epistemic-humility contract described for lib/utils/service-probe.js at the bash layer: it uses `timeout 2 bash -c "echo >/dev/tcp/$host/$port"` to prove only that a TCP socket accepted a connection, then explicitly returns 0 even after exhausting `max_attempts` with a `WARNING: ... continuing anyway` message and the comment `# Don't fail - let supervisord handle it`. This is a deliberate fail-open probe: the script never asserts 'healthy' or blocks container startup on a probe failure, deferring the actual liveness judgment to supervisord's own process management, which mirrors the SPEC R6 distinction between 'running/reachable' and 'functioning correctly' at a completely different layer of the stack (container boot vs. in-process service management).

### Siblings
- [SecureEnvImportFilter](./SecureEnvImportFilter.md) -- [LLM] The SecureEnvImportFilter lives entirely inside docker/entrypoint.sh's `.env` loading loop (the `while IFS='=' read -r key value; do ... done < /coding/.env` block). It reads the host-mounted `.env` file line by line and applies a `case "$key" in *_API_KEY|*_TOKEN|*_MANAGEMENT_KEY) continue ;; esac` glob match to skip secret-shaped variable names before they are exported into the container's environment. This is a denylist-by-suffix approach rather than an allowlist: any variable whose name happens to end in one of these three tokens is dropped, but a secret named something else (e.g. `QWEN_LOCAL_SECRET`, `DB_PASSWORD`, `WEBHOOK_SIGNING`) would pass straight through, since the filter matches on lexical suffix, not on any semantic classification of sensitivity.


---

*Generated from 10 observations*
