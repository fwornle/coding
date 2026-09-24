# EnvFileSecretFiltering

**Type:** Detail

## What It Is

EnvFileSecretFiltering is implemented inline within `docker/entrypoint.sh`, in the "Environment setup" block that loads `/coding/.env`. It is not a separate module, script, or function — it is a bash while-loop (`IFS='=' read -r key value`) that parses the .env file line by line, skipping comments and blank lines, trimming keys with `xargs`, and applying a `case` statement against the key name before deciding whether to `export` it. As a child component of `SupervisordRuntime`, it operates during container bootstrap, before supervised processes start, and sits alongside its sibling `FeatureSnapshotGating` (which similarly rebuilds `/etc/supervisor/features.d` from `PROGRAM_FEATURES` on every start) as one of the entrypoint's inline, non-modular startup mechanisms.

## Architecture and Design

The core pattern is **denylist-based filtering via shell glob patterns**: a `case` statement matches keys against `*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY` and `continue`s (skips export) on match, rather than using an allowlist of known-safe variables. This is layered on top of a second, independent gate — a **fail-open/non-conflicting precedence rule** — where a .env value is only imported `if [ -z "${!key}" ]`, meaning docker-compose-supplied environment variables always take precedence. A variable must therefore pass both gates (not already set, and not name-matching a secret pattern) to enter the container environment.

Notably, this mechanism doubles as a **network policy enforcement point**: per an inline comment tied to the T2 egress lockdown investigation, its real purpose is preventing in-container SDK clients from silently re-enabling direct provider API calls that bypass the host `llm-cli-proxy` at `:12435`. Security policy is thus implemented as a side-effect of environment bootstrapping rather than as a dedicated policy layer — an architectural trade-off that keeps the entrypoint simple but conflates concerns (secrets hygiene and egress control) in one lexical filter.

## Implementation Details

The mechanics are purely lexical: bash glob matching on key names, with no structural or content-based secret detection. Three suffix patterns are hardcoded: `*_API_KEY`, `*_TOKEN`, `*_MANAGEMENT_KEY`. There is no allowlist of expected safe keys, and critically, no logging of which specific keys were filtered — the entrypoint emits only an aggregate message ("Loading environment from /coding/.env (non-conflicting vars only)"), so operators cannot audit from container logs which variables were excluded versus passed through. Because matching is suffix-based, any secret-like variable not ending in one of the three recognized suffixes (e.g., a hypothetical `*_SECRET` or `*_CREDENTIAL`) silently passes through and gets exported — the guarantee depends entirely on naming-convention discipline elsewhere in the codebase, not on any structural detection mechanism.

## Integration Points

EnvFileSecretFiltering is embedded in the same entrypoint script that also implements `FeatureSnapshotGating`, though the two are functionally unrelated beyond sharing the file and both running at container start under `SupervisordRuntime`. Its output (the filtered environment) becomes the runtime environment for all processes supervisord subsequently launches, making it an implicit dependency for any service expecting secrets to be excluded or for egress-lockdown enforcement to hold. It also implicitly depends on docker-compose's environment configuration, since the "non-conflicting vars only" precedence rule means compose-supplied variables silently override .env values without any filtering interaction.

## Usage Guidelines

Developers modifying `docker/entrypoint.sh` should treat the three `case` patterns as a security boundary tied to the T2 egress lockdown effort, not just secrets hygiene — removing or narrowing a pattern could re-enable direct provider calls that bypass `llm-cli-proxy`. Any new secret-like environment variable naming convention (anything not ending in `_API_KEY`, `_TOKEN`, or `_MANAGEMENT_KEY`) must either be renamed to match an existing pattern or the `case` statement must be extended — there is no fallback detection. Because the documented "Health Verification Workflow" for `SupervisordRuntime` only checks process/health-endpoint liveness manually, a regression here (e.g., an accidentally narrowed pattern) would not be caught by any existing verification baseline; changes to this filter should be manually diffed and tested against the .env file's actual key set. Given the lack of per-key logging, adding an audit log of skipped variables would materially improve maintainability and incident diagnosis without changing the filtering logic itself.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Per the inline comment in entrypoint.sh tied to the T2 egress lockdown investigation area, the filter's stated purpose is to prevent in-container SDK clients from silently re-enabling direct provider calls that bypass the host llm-cli-proxy at :12435 — the filtering is framed as a network policy enforcement point, not merely a secrets-hygiene measure.
- The 'Coding-Services Docker Container — Health Verification Workflow' record establishes that post-restart verification of supervised processes is done manually, outside any script; this means a regression in EnvFileSecretFiltering (e.g. a case-pattern change that stops excluding a key) would not be caught by the documented verification baseline, which only checks process/health-endpoint liveness, not environment-variable content.

## Hierarchy Context

### Parent
- [SupervisordRuntime](./SupervisordRuntime.md) -- [SESSION] Feature Snapshot Forensics — Runtime Config Drift Investigation documents an ongoing, unresolved effort to find what rewrites the runtime feature snapshot into an overly restrictive state (e.g. 'logging-only'), causing silent service outages.

### Siblings
- [FeatureSnapshotGating](./FeatureSnapshotGating.md) -- [LLM] docker/entrypoint.sh's feature-gating block (the `FEATURES_SNAPSHOT="/coding/.coding/runtime/features.json"` section) is the only implementation of FeatureSnapshotGating among the retrieved files. It rebuilds `/etc/supervisor/features.d` from scratch on every container start (`rm -f "$FEATURES_DIR"/*.conf`), then iterates the space-separated `PROGRAM_FEATURES` mapping (`semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `health-dashboard:health`, etc.), splitting each `program:feature` pair with bash parameter expansion (`${pair%%:*}` / `${pair##*:}`) rather than a structured format.


---

*Generated from 9 observations*
