# SecureEnvImportFilter

**Type:** Detail

# SecureEnvImportFilter — Technical Insight Document

## What It Is

SecureEnvImportFilter is not a standalone module but a small, inline security control embedded entirely within `docker/entrypoint.sh`, inside the `.env` loading loop (`while IFS='=' read -r key value; do ... done < /coding/.env`). As the container boots and reads the host-mounted `.env` file line by line, this filter applies a `case "$key" in *_API_KEY|*_TOKEN|*_MANAGEMENT_KEY) continue ;; esac` glob match, silently skipping any variable whose name ends in one of those three suffixes before it can be exported into the container's environment. It is a denylist-by-suffix mechanism, not a semantic or allowlist-based one: a variable named `QWEN_LOCAL_SECRET`, `DB_PASSWORD`, or `WEBHOOK_SIGNING` would pass through untouched, because the filter only inspects lexical suffixes, not actual sensitivity.

As a child of ServiceProbe in the entrypoint script's structure, SecureEnvImportFilter shares a file and boot sequence with its sibling FeatureGatedSupervisordOverride, executing before the feature-gating block that manipulates supervisord autostart behavior.

## Architecture and Design

The filter directly encodes a documented security invariant: the comment above the case statement states its purpose is "T2 egress lockdown: never import raw provider keys/tokens from the bind-mounted host .env — all LLM/embedding egress routes via the host llm-cli-proxy (:12435)." This makes SecureEnvImportFilter a defense-in-depth complement to network-level enforcement — even if a proxy-only egress policy exists at the network layer, this filter prevents in-container SDK clients from ever acquiring a raw provider key that could be used to dial out directly, bypassing the proxy's accounting, fallback, and capability-gating logic.

Architecturally, this is a boundary enforced structurally at the container entrypoint rather than at the SDK or call-site level — it relies on the invariant that secrets simply never enter `process.env` in the first place, rather than on runtime checks at usage points. This design choice trades flexibility for simplicity: no per-client logic is needed, but the guarantee only holds as strongly as the entrypoint script's parsing and suffix list.

A second architectural layer governs precedence: the filter's suffix check is combined with `if [ -z "${!key}" ]; then export "$key=$value"; fi`, using indirect parameter expansion to test whether docker-compose already defined the variable. This establishes a "docker-compose wins" precedence rule — `.env` is a fallback source, not an override source. Critically, this also means the filter's protection is scoped only to the bind-mounted file ingestion path; any `*_API_KEY`-named variable set directly via docker-compose's environment block bypasses the loop (and thus the filter) entirely, since the loop only processes lines read from the file.

Within the broader entrypoint script, SecureEnvImportFilter represents a deliberate asymmetry: the script is overwhelmingly fail-open at boot time (mirrored by its parent ServiceProbe's `wait_for_service()`, which returns 0 even after exhausting attempts, and by sibling FeatureGatedSupervisordOverride's fallback of starting everything when no feature snapshot exists), but this filter is fail-closed for the one thing it protects — secret-suffixed variables are always stripped, with no override or config path.

## Implementation Details

The core mechanism is plain bash string/glob matching, hardcoded inline in `docker/entrypoint.sh` — there is no shared, tested, or externally configurable pattern list. The suffix set `*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY` exists solely as a `case` pattern within the loop body.

Key extraction relies on naive `.env` parsing: `key=$(echo "$key" | xargs)` trims whitespace, comment lines are skipped via `[[ "$key" =~ ^[[:space:]]*# ]]`, and empty keys are skipped. Because `IFS='='` combined with `read -r key value` only splits on the first `=`, values containing embedded `=` characters parse correctly, but quoted values retain their quote characters upon export. This means the security boundary's reliability is bounded by this ad hoc parser — malformed or unusually formatted `.env` lines could produce key values that unexpectedly match or evade the suffix glob.

The precedence check (`[ -z "${!key}" ]`) executes independently of the suffix filter, meaning both conditions must be reasoned about together: a variable must both survive the suffix denylist and find no pre-existing docker-compose-set value before it is exported via `export "$key=$value"`.

## Integration Points

SecureEnvImportFilter's most direct integration is architectural rather than functional: it enforces, at the environment-ingestion boundary, the same T2 egress-lockdown policy that is presumably enforced elsewhere via the host `llm-cli-proxy (:12435)`, forming a two-layer defense against direct provider SDK calls from inside the container. It executes in the same script and boot sequence as its ServiceProbe parent (`wait_for_service()`) and sibling FeatureGatedSupervisordOverride (the `PROGRAM_FEATURES` / `features.json` gating block), sharing the entrypoint's overall lifecycle but diverging sharply in its fail-closed posture.

It also implicitly integrates with docker-compose's environment configuration, since the precedence rule means docker-compose-defined variables both take priority over and can completely bypass this filter's scrutiny — an integration point that is also a documented gap.

## Usage Guidelines

Developers extending secret-naming conventions elsewhere in the codebase must manually update the hardcoded suffix list in `docker/entrypoint.sh`; there is no shared enum, constant, or automated regression check tying this list to naming conventions used elsewhere (in contrast to `tests/features/service-gating.test.mjs`, which structurally enforces `PROGRAM_FEATURES`/`SERVICE_CONFIGS` coverage for the sibling gating mechanism). Introducing a new convention like `*_SECRET` or `*_CREDENTIAL` without updating this filter would silently create a leak path.

Anyone configuring secrets via docker-compose directly (rather than via the bind-mounted `.env`) should understand that SecureEnvImportFilter provides no protection in that path — it only polices file-based ingestion, not all routes by which environment variables can enter the container.

Because the filter depends on an ad hoc `.env` parser, `.env` files should avoid quoted values and unusual formatting, since parsing quirks could cause a secret to evade the suffix match or a legitimate variable to be inadvertently dropped. Finally, given the absence of test coverage, any change to this section of `docker/entrypoint.sh` warrants manual verification that the suffix denylist and precedence logic still behave as documented, since no automated test currently guards this security-critical code path.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- [LLM] docker/entrypoint.sh's wait_for_service() function (lines defining `wait_for_service()`) implements the same epistemic-humility contract described for lib/utils/service-probe.js at the bash layer: it uses `timeout 2 bash -c "echo >/dev/tcp/$host/$port"` to prove only that a TCP socket accepted a connection, then explicitly returns 0 even after exhausting `max_attempts` with a `WARNING: ... continuing anyway` message and the comment `# Don't fail - let supervisord handle it`. This is a deliberate fail-open probe: the script never asserts 'healthy' or blocks container startup on a probe failure, deferring the actual liveness judgment to supervisord's own process management, which mirrors the SPEC R6 distinction between 'running/reachable' and 'functioning correctly' at a completely different layer of the stack (container boot vs. in-process service management).

### Siblings
- [FeatureGatedSupervisordOverride](./FeatureGatedSupervisordOverride.md) -- [LLM] docker/entrypoint.sh implements feature gating as an additive override layer rather than a rewrite of supervisord.conf: it writes only a `disabled.conf` fragment into `/etc/supervisor/features.d/` that sets `autostart=false` for specific `[program:...]` sections, leaving supervisord.conf itself as the single source of truth for command lines and logging. The `PROGRAM_FEATURES` variable hardcodes an eight-entry mapping (e.g. `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `health-dashboard:health`) that must stay in lockstep with both supervisord.conf's program list and lib/features catalogue — a drift-prone design the codebase explicitly compensates for via tests/features/container-gating.test.mjs asserting exact coverage in both directions.


---

*Generated from 9 observations*
