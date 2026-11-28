Twelve features, two settings, one resolver, four surfaces that must agree about them. This tier is the
mechanism: how a decision is reached, who is allowed to act on it, and which failures are
deliberately asymmetric.

## The resolver

`lib/features/resolve.cjs` is the only thing that decides whether a feature is on. It is
CommonJS on purpose — the status line renders it on every tmux tick and cannot afford ESM
resolution — and it is mtime-cached, so a read costs a `stat()`.

Four layers, evaluated in order, last one wins:

| # | layer | scope |
|---|-------|-------|
| 1 | built-in defaults (all on) | the product — reached only by a checkout that was never installed |
| 2 | `<repo>/config/features.yaml` | the team — committed, shipped fully commented out |
| 3 | `~/.coding/features.yaml` | this machine — what `coding-features` and the dashboard write |
| 4 | `CODING_FEATURE_<ID>=on\|off` | this shell |

The installer always writes layer 3: the tier the user picked, or `harness` in an unattended
run (`install.sh`, `ask_feature_selection`). An absent `features.yaml` resolves to all-on,
which is the developer profile with `lsl-redirect` included, so no install is left without one.

Layer 2 exists so a project can pin what it needs without every developer configuring it by
hand; it ships entirely commented out, so it doubles as schema documentation in the place
you would look for it.

Every resolution carries a **reason string**, and every surface quotes it verbatim rather
than re-deriving one — `coding-features explain`, the status line tooltip, the dashboard
chip. That is what makes "why is this off" have exactly one answer.

## Dependencies

```
lsl ──▶ lsl-redirect
lsl ──▶ teams
lsl ──▶ observations ──▶ knowledge
            observations ──▶ cluster
llm-proxy ──▶ performance
```

`cluster` depends on `observations` because its routes (`/api/cluster`, `/api/routing`) are
served by obs-api, the `observations` daemon, which runs on the host. `teams` is the sharing
layer only: which repo a turn belongs to is core and stays on without it.

The rule is one-directional: **a dependent whose dependency is off is auto-disabled; a
dependency is never auto-enabled.** Off is an explicit instruction and is honoured exactly.
On-by-implication would start services nobody asked for, which is how a "minimal" install
quietly becomes a full one.

The resolver applies this transitively to a fixed point, and so does the dashboard's preview
— switching `lsl` off greys out `lsl-redirect`, `teams`, `observations`, `knowledge` and
`cluster`. The Features tab's map (**How the parts fit**) uses the same rule: a box whose
dependency is off will not switch on and says what is missing, and a family title switches
its members together but leaves off any member whose dependency outside the family is off. An editor that previewed
only one level was worse than one that previewed none, because the second surprise arrived
after the click.

## Settings beside the features

Two keys in the same layered files are choices rather than on/off switches:

| key | values | resolved by |
|-----|--------|-------------|
| `run` | `auto`, `box`, `strict-box`, `host` | `resolveRun()`: `auto` is the box while `constraints` is on, else the host; an explicit `box` or `strict-box` with `constraints` off falls back to the host, with the reason recorded |
| `agents` | a list of `config/agents/*.sh` names | unknown names and an empty list are config errors; without the key every agent is offered, and plain `coding` launches `claude` while it is offered, else the first one |

The box is how `constraints` is enforced (it runs under the guard), so the run mode follows
the same rule as a dependency: it is never switched back on for you.

**Job-class labelling** is a sub-switch of `llm-proxy` that does not live in these files. The
proxy owns it: `GET`/`PUT /api/job-classes/enabled` on rapid-llm-proxy, which writes this
machine's choice to its gitignored `llm-routing.machine.yaml` over the team's setting. The
Features tab reads and writes it there, under LLM Proxy and as a box on the map.

## Install tiers and profiles

`config/feature-profiles.yaml` names what each profile switches ON; everything it omits is
off, so a new feature never switches itself on in an existing profile.

| profile | on | offered by the installer |
|---------|----|--------------------------|
| `harness` | `llm-proxy`, `health`, `statusline` | yes, the default |
| `learning` | harness + `lsl`, `observations`, `knowledge`, `teams` | yes |
| `learning-perf` | learning + `performance` | yes |
| `everything` | learning-perf + `constraints`, `codegraph`, `cluster` | yes |
| `full` | everything + `lsl-redirect` | no — the developer profile |
| `minimal` | `statusline` | no — the baseline `--features=a,b` builds on |

No tier names `lsl-redirect`: it files turns it judges to be about the toolchain into the
tools repo, which for anyone not developing `coding` moves their own sessions out of their
project. Older names (`km`, `km-perf`, `proxy-only`, `logging-only`) still resolve as
aliases so an old `features.yaml` keeps working, but they are never listed.

## Fail-open and fail-closed are deliberately asymmetric

| kind of code | on an unparseable config | why |
|--------------|--------------------------|-----|
| anything that STARTS a process — launcher, service starter, CLI guards | **fail closed**: abort | half-starting a system is worse than not starting it |
| anything that DISPLAYS — status line, dashboard, coordinator checks | **fail open**: show everything, plus the error | a UI that silently drops half its content is indistinguishable from a broken build |

## Apply tiers

| tier | covers | mechanism |
|------|--------|-----------|
| `live` | status line, dashboard gating, coordinator checks, CLI gates | all read the mtime-cached resolver on next use |
| `apply` | host daemons and container programs | `scripts/apply-features.mjs` diffs and starts/stops only the delta |
| `session` | agent hooks | `--settings` is fixed at launch, so new sessions only |

`apply` deliberately does not restart the world: `coding --claude` already does a full start,
and a config edit should cost the smallest disruption that makes the config true.

## The three kinds of artifact

Adding a service, daemon, container program, tab or badge means declaring its feature, and
four mappings have to agree — `lib/features/daemons.mjs`, `scripts/apply-features.mjs`,
`docker/entrypoint.sh` and the architecture reference. `tests/features/*.test.mjs` fails the
build when they drift.

There is one artifact that fits neither table: **the ETM**. `enhanced-transcript-monitor.js`
is the writer behind `lsl`, and the health coordinator spawns it per project `detached` and
`unref()`ed — no launchd label, no supervisord program, and it outlives whoever started it.
It is therefore gated in three places rather than one:

| path | when `lsl` is off |
|------|-------------------|
| launch (`SERVICE_CONFIGS.transcriptMonitor`) | not started |
| coordinator safety-net sweep | does not spawn |
| coordinator reap | SIGTERMs every running ETM |
| apply (`reconcileEtm`) | SIGTERMs every running ETM |

The last two overlap on purpose: the coordinator can only reap while it is running, and
`minimal` and `harness` stop it in the same pass that switches `lsl` off.

## Why the API lives on the coordinator, not the dashboard

`/features` is served by the health coordinator on `:3034`. The dashboard runs *inside* the
`coding-services` container; the file it edits (`~/.coding/features.yaml`) is on the host,
and applying a change runs `launchctl` / `systemctl` / `schtasks`. `server.js`
reverse-proxies `/api/features` so the browser sees one origin. There is exactly one writer
implementation, `lib/features/write.mjs`.

## Docker

Only `knowledge`, `codegraph` and `constraints` need the container. With all three off,
`_start_services()` skips it entirely and the launcher never demands a daemon.

`health` deliberately does **not** need Docker: the coordinator and both dashboard servers
have host implementations, which is what lets `harness` run a dashboard on a machine with no
Docker Desktop at all.

## Reference

The engineering reference — the full feature→artifact matrix, port table, badge ownership,
and the coordinator health-check mapping — is `docs/architecture/features.md` in the repo.
