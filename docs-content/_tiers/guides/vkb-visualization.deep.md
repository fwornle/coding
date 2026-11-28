## Pieces

| Piece | Where | Role |
|---|---|---|
| `bin/vkb` | coding repo | feature gate, checks the container serves the viewer, obs-api check, open the browser |
| `integrations/unified-viewer` | coding repo | the React app (Vite); `dist/` is its build, gitignored |
| `docker/Dockerfile.coding-services` | image build | `npm ci` + `vite build` of the viewer; ships `dist/`, not its `node_modules` |
| `lib/viewer/mount.mjs` | dashboard frontend (`:3032`, `static-server.js`) in coding-services | serves `dist/` under `/viewer/`, the app shell for every route, mounted before the dashboard's own catch-all |
| obs-api `/api/v1/*`, `/api/coding/*`, `/api/teams` | obs-api `:12436` (host) | the data the app reads |

The app's production build uses base `/viewer/` (`vite.config.ts`), so its assets resolve
under `/viewer/assets/` and never collide with the dashboard's routes. Hashed assets are cached
for good; the shell (`index.html`) is never cached, so a new build shows on the next load.
Every answer from the mount carries `X-Coding-Viewer: built` (or `not-built`, with a 503 page
saying how to get a build); `vkb` checks for it, because without the mount the dashboard's
catch-all answers `/viewer/coding` with its own shell, also a 200.

The page's origin does not matter for its data: the backend URLs are absolute (below) and
obs-api answers CORS for any loopback origin (`lib/network/local-only.mjs`).
`lib/viewer/` is bind-mounted into the container next to `static-server.js`, so the two always
match; the build itself is the image's.

## Systems

| URL | Shows | Backend |
|---|---|---|
| `/viewer/coding` (VKB) | the coding knowledge graph | obs-api `:12436` |
| `/viewer/okb` (VOKB) | the operational knowledge base | OKM `:8090` |

Backends are fixed at build time (`src/config/system-endpoints.ts`); override with
`VITE_BACKEND_CODING_URL` / `VITE_BACKEND_OKB_URL` when building. Loopback addresses are
`127.0.0.1`, not `localhost` — see the comment there for the Chrome hang that taught it.

## When the build is redone

With every image build (`docker compose -f docker/docker-compose.yml build coding-services`,
and the release images on GHCR). The build is `vite build` only — not `npm run build`, which
type-checks first and would let a type error anywhere in the viewer keep everyone from opening
it. The step fails the image build if it produces no `dist/index.html`. Nothing builds the
viewer on the host any more; `npm run dev` (`:5173`) is for working on it.

## Feature gating

`vkb` is guarded by `lib/features/require-feature.sh` on `knowledge` (exit 2 with the reason
and the fix when it is off; `tests/features/cli-and-rules-gating.test.mjs`). The page is
served by the dashboard frontend, so it also needs `health` on (the default).

## History

Until 2026-09-08 `vkb` started a separate server, vkb-server, on `:8080`, with
`start/stop/status/logs/fg/port` subcommands. That server was retired when the unified viewer
replaced it (its experiment and kgbench APIs moved to obs-api first), and with it went the
command — leaving the viewer reachable only through its dev server until `vkb` came back as
this launcher. From 2026-10-05 obs-api served a host build (`:12436/viewer/`, built by the
installer and by `vkb` when stale); since 2026-11-28 the container serves the image's build on
`:3032`, so the host needs no npm and no build for it.
