## Pieces

| Piece | Where | Role |
|---|---|---|
| `bin/vkb` | coding repo | feature gate, build-if-stale, obs-api check, open the browser |
| `integrations/unified-viewer` | coding repo | the React app (Vite); `dist/` is its build, gitignored |
| `lib/viewer/mount.mjs` | obs-api (`:12436`) | serves `dist/` under `/viewer/`, the app shell for every route, `/` → `/viewer/coding` |
| obs-api `/api/v1/*`, `/api/coding/*`, `/api/teams` | obs-api | the data the app reads |

The app's production build uses base `/viewer/` (`vite.config.ts`), so its assets resolve
under `/viewer/assets/` and never collide with obs-api's own routes. Hashed assets are cached
for good; the shell (`index.html`) is never cached, so a rebuild shows on the next load.

## Systems

| URL | Shows | Backend |
|---|---|---|
| `/viewer/coding` (VKB) | the coding knowledge graph | obs-api `:12436` |
| `/viewer/okb` (VOKB) | the operational knowledge base | OKM `:8090` |

Backends are fixed at build time (`src/config/system-endpoints.ts`); override with
`VITE_BACKEND_CODING_URL` / `VITE_BACKEND_OKB_URL` when building. Loopback addresses are
`127.0.0.1`, not `localhost` — see the comment there for the Chrome hang that taught it.

## When the build is redone

`vkb` rebuilds when `dist/index.html` is missing, when `--build` is given, or when any of
`src/`, `index.html`, `vite.config.ts`, `package.json` is newer than it. A missing
`node_modules/` is installed with `npm ci` first. The build is `vite build` only — not
`npm run build`, which type-checks first and would let a type error anywhere in the viewer keep
everyone from opening it. Output goes to `.logs/vkb-build.log`.

## Feature gating

`vkb` is guarded by `lib/features/require-feature.sh` on `knowledge` (exit 2 with the reason
and the fix when it is off; `tests/features/cli-and-rules-gating.test.mjs`). The installer step
`install_unified_viewer` runs for `knowledge` only and appears in the impact manifest.

## History

Until 2026-09-08 `vkb` started a separate server, vkb-server, on `:8080`, with
`start/stop/status/logs/fg/port` subcommands. That server was retired when the unified viewer
replaced it (its experiment and kgbench APIs moved to obs-api first), and with it went the
command — leaving the viewer reachable only through its dev server until `vkb` came back as
this launcher.
