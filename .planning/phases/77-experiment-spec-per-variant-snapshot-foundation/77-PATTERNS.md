# Phase 77: Experiment Spec & Per-Variant Snapshot Foundation - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 3 (2 new, 1–2 modified)
**Analogs found:** 3 / 3 (all exact — every analog named in CONTEXT.md exists and was read)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/experiments/experiment-spec.mjs` (NEW) | utility / resolver-validator (pure) | transform (YAML → validated variant cells) | `lib/experiments/taxonomy.mjs` | exact (same dir, same load+validate idiom) |
| `scripts/measurement-start.mjs` (MODIFIED) | operator CLI | request-response (flags → span.meta) | itself + `scripts/repro-restore.mjs` (arg-parse) | exact |
| `lib/experiments/experiment-restore.mjs` (NEW) — per-cell restore + determinism digest orchestration | service / orchestrator | batch (per variant×repeat: restore → hash → assert) | `scripts/repro-restore.mjs` (call pattern) + `lib/repro/restore-snapshot.mjs` (signature) | role-match / partial (no existing digest-assert analog — see No Analog) |

Note on the third file: the *restore call* is an exact wire of a shipped function; the *hash-and-assert determinism proof* (D-11/D-12) has no existing analog in the codebase and is net-new logic (see "No Analog Found").

## Pattern Assignments

### `lib/experiments/experiment-spec.mjs` (utility, transform — NEW)

Loads a user-authored YAML spec, expands cartesian axes `{agent[], model[], framework[], env[]}` × `repeats:N` into concrete variant cells, validates each cell (agent enum D-05 + unsupported-combination table D-07 + `test_command` SHELL_META_RE guard D-08), whole-run fail-fast D-06.

**Analog:** `lib/experiments/taxonomy.mjs`

**Imports + module-header + default-path idiom** (`lib/experiments/taxonomy.mjs:13-22`) — copy this exact ESM shape (js-yaml, `fileURLToPath(import.meta.url)`, repo-root two-up, module doc-comment stating "PURE and deterministic — no LLM, no network"):
```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This module lives at <repo>/lib/experiments/, so the repo root is two levels up.
const DEFAULT_TAXONOMY_PATH = path.resolve(__dirname, '..', '..', 'config', 'task-taxonomy.yaml');
```

**YAML load + null-guard + honest error** (`lib/experiments/taxonomy.mjs:33-43`) — the D-01 spec loader template. Reuse the `!parsed || typeof !== 'object' || missing-required-key` guard verbatim, swapping `classes` for the spec's required root key (`variants`/`axes`):
```javascript
export function loadTaxonomy(filePath = DEFAULT_TAXONOMY_PATH) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(raw);
  // Null-guard: yaml.load() returns undefined for an empty file and null for an
  // explicit YAML null document; a malformed file may also lack `classes`.
  if (!parsed || typeof parsed !== 'object' || !parsed.classes || typeof parsed.classes !== 'object') {
    throw new Error(`task-taxonomy.yaml is empty or malformed: missing classes (path: ${filePath})`);
  }
  return { version: parsed.version, classes: parsed.classes };
}
```

**Closed-enum validate (agent D-05)** (`lib/experiments/taxonomy.mjs:53-57`) — the fail-fast enum primitive. The enum values come from `route-trace-resolve.mjs:23` (see Shared Patterns). Adapt to return an honest per-cell error object/message rather than a bare boolean so D-06 can report *which cell, which dimension, why*:
```javascript
export function isValidClass(cls, taxonomy) {
  if (typeof cls !== 'string' || cls.length === 0) return false;
  const valid = taxonomy && taxonomy.classes ? Object.keys(taxonomy.classes) : CLOSED_6;
  return valid.includes(cls);
}
```

**Frozen closed-set constant idiom** (`lib/experiments/taxonomy.mjs:26`) — mirror for `KNOWN_AGENTS` re-export and the D-07 unsupported-combination table:
```javascript
const CLOSED_6 = Object.freeze(['refactor', 'bugfix', 'new-feature', 'migration', 'debug', 'docs']);
```

**test_command SHELL_META_RE guard (D-08)** — pattern from `lib/experiments/evidence-harness.mjs`. The regex is defined at `evidence-harness.mjs:209` and applied at `:242-249`. Import/reuse the SAME regex semantics (do NOT invent a looser one — constraint-dodging forbidden). Reject at spec-resolution time, before run 0:
```javascript
// evidence-harness.mjs:209
const SHELL_META_RE = /[|&;<>()$`\\"'\n\r]/;

// evidence-harness.mjs:242-249 — the guard-and-tokenize idiom to replicate
const cmd = fromMeta.trim();
if (SHELL_META_RE.test(cmd)) return null;        // reject shell-needing commands
const argv = cmd.split(/\s+/).filter(Boolean);   // fixed-argv tokenization
return argv.length ? argv : null;
```
Consideration for planner: either import `SHELL_META_RE` from `evidence-harness.mjs` (it is currently module-private — a small export addition) OR keep validation local but assert identical character class in a test. Prefer exporting the single canonical regex over duplicating it.

**YAML SoT file shape** — the spec file follows `config/task-taxonomy.yaml:1-29`: a top `version:` int, a leading comment block naming the readers, then the curated map. Mirror the header-comment convention (state what reads it + that it is human-authored SoT).

---

### `scripts/measurement-start.mjs` (operator CLI, request-response — MODIFIED)

Thread per-variant `{agent, model, framework, env, test_command}` into `span.meta` via new flags (`--agent/--model/--framework/--test-command/--variant`) and/or a `--spec <file> --variant <name>` mode.

**Analog:** the file itself (extend in place) + `scripts/repro-restore.mjs` for arg parsing.

**Flag parse helper** (`scripts/measurement-start.mjs:48-52`) — already present; reuse `parseStrArg` for every new string flag:
```javascript
function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}
```

**meta construction seam (THE hook point)** (`scripts/measurement-start.mjs:98-114`) — extend the `meta` object literal so the new fields land where `measurement-stop.mjs` already reads them. Existing code:
```javascript
const replayFrom = parseStrArg(args, '--replay');
const dataDir = process.env.LLM_PROXY_DATA_DIR || path.join(REPO_ROOT, '.data');
const replayFixturesDir = replayFrom ? path.join(REPO_ROOT, '.data', 'run-snapshots', sanitizeTaskId(replayFrom), 'fixtures') : null;
const meta = { record: true, ...(replayFixturesDir ? { replay_from: replayFixturesDir } : {}) };
// ...
span = startMeasurement({ task_id: taskId, ...(goalSentence ? { goal_sentence: goalSentence } : {}), meta });
```
Phase-77 change: merge `{ agent, model, framework, env, test_command }` (from flags, or resolved from `--spec/--variant` via `experiment-spec.mjs`) into `meta` — spreading only defined keys, matching the existing conditional-spread style. The `test_command` must have passed the SHELL_META_RE guard in `experiment-spec.mjs` before it reaches this seam.

**captureSnapshot import + call already wired** (`scripts/measurement-start.mjs:41` and `:124-131`) — the RUN-01 baseline capture already fires at span open; no change needed to capture, only to `meta`. Referenced so the planner does not duplicate the capture.

---

### `lib/experiments/experiment-restore.mjs` (orchestrator, batch — NEW)

Per variant×repeat: `restoreSnapshot(snapshotId, {inPlace:false,...})` → compute digest over restored git tree + `.data/knowledge-graph/` KB + routing config → assert two repeats are byte-identical (D-11), abort on divergence (D-12).

**Analog (restore call):** `scripts/repro-restore.mjs` (call site) + `lib/repro/restore-snapshot.mjs` (signature/return).

**The exact restore call to wire — sandbox default (D-10)** (`scripts/repro-restore.mjs:74-82`):
```javascript
const res = await restoreSnapshot(snapshotId, { inPlace: false, repoRoot, dataDir });
//  res.worktree        → isolated git worktree at the captured SHA
//  res.sandboxDataDir  → sandbox .data (contains knowledge-graph/ after hydrate)
//  res.replayArmed     → bool
```
`--in-place` is NOT used by the Phase-77 runner (D-10) — do not pass `inPlace:true`.

**restoreSnapshot signature + return shape** (`lib/repro/restore-snapshot.mjs:188-192`, return `:308-314`):
```javascript
export async function restoreSnapshot(snapshotId, opts = {}) {
  const inPlace = opts.inPlace === true;
  const repoRoot = opts.repoRoot || process.cwd();
  const dataDir = opts.dataDir || path.join(repoRoot, '.data');
  // ...
  return { worktree, sandboxDataDir, replayArmed, inPlace: false,
           steps: { worktree: true, ...steps, kb: kbHydrated, config: configWritten } };
}
```
Sandbox worktrees land under `.data/run-restores/<snapshot-id>-<ts>/`; the sandbox KB is at `<worktree>/.data/knowledge-graph/` (hydrated at restore step 5). The captured git SHA is recorded at `<snapDir>/git-sha.txt` and returned via the worktree checkout — the digest's `git_sha` component should read the restored worktree SHA (deterministic per snapshot).

**Digest inputs (D-11) — where each byte-source lives:**
- `git_sha`: restored worktree HEAD (or `<snapDir>/git-sha.txt`, which `restore-snapshot.mjs:252` reads).
- KB: `<res.sandboxDataDir>/knowledge-graph/` (the hydrated sandbox KB — never the live KB).
- routing config: `llm-settings.json` copied into `<res.sandboxDataDir>` by `restore-snapshot.mjs:284-287` (the `processOverrides`-only file; see `capture-snapshot.mjs:188` for its source `<dataDir>/llm-proxy/llm-settings.json`).

**Fixed-argv, no-shell exec (for any git/hash subprocess)** — mandatory pattern from `restore-snapshot.mjs:62-66`. Never build a shell string:
```javascript
function git(args, cwd, input) {
  const res = spawnSync('git', args, gitOpts(cwd, input));
  const ok = !!res && !res.error && res.status === 0;
  return { ok, stdout: ..., stderr: ... };
}
```

**Operator-CLI wrapper skeleton** (if this ships a CLI) — copy `scripts/repro-restore.mjs:35-50, 103-106`: `parseStrArg` + `prompt` readline helper + `main().catch(err => { process.stderr.write('FATAL: ...'); process.exit(1); })`. Diagnostics via `process.stderr.write` only (no-console-log).

---

## Shared Patterns

### Agent enum (D-05)
**Source:** `lib/experiments/route-trace-resolve.mjs:23`
**Apply to:** `experiment-spec.mjs` agent-dimension validation.
```javascript
const KNOWN_AGENTS = ['claude', 'copilot', 'opencode'];
```
Import/re-use this exact set (CONTEXT.md D-05 names it as the SoT). Do NOT hardcode a divergent copy. `model` and `framework/env` stay free-form (warn, never block) — no closed enum this phase.

### Fixed-argv / no-shell exec + SHELL_META_RE
**Source:** `lib/experiments/evidence-harness.mjs:209` (regex), `:242-263` (guard), `lib/repro/restore-snapshot.mjs:62-66` (git spawnSync)
**Apply to:** `test_command` validation in `experiment-spec.mjs` (D-08) and any subprocess in `experiment-restore.mjs`.
```javascript
const SHELL_META_RE = /[|&;<>()$`\\"'\n\r]/;
// reject if SHELL_META_RE.test(cmd); then cmd.split(/\s+/).filter(Boolean) → fixed argv
```

### Honest-error / fail-soft posture
**Source:** `lib/experiments/taxonomy.mjs:39-40` (throw CLEAR error on malformed input), `lib/repro/capture-snapshot.mjs:51-60` (best-effort writes, never throw whole op)
**Apply to:** spec loader throws actionable per-cell errors (fail-fast, D-06); restore orchestrator best-effort logs but aborts on determinism divergence (D-12, hard fail).

### Diagnostics channel
**Source:** CLAUDE.md no-console-log; every analog uses `process.stderr.write`
**Apply to:** ALL new/modified files. Never `console.*`. Never dodge via a different raw-write API.

### span.meta key contract (the integration seam)
**Source (writer):** `scripts/measurement-start.mjs:103-114`
**Source (reader):** `scripts/measurement-stop.mjs:341` (`span.meta?.agent`), `:447` (`span.meta?.framework`), `lib/experiments/evidence-harness.mjs:243` (`span.meta?.test_command`)
**Apply to:** the exact meta keys the spec/flags must set — `agent`, `model`, `framework`, `test_command` (and `env` for the D-07 gate). `measurement-stop.mjs:443-454` writes these into `Run.metadata` as `{task_hash, agent, model, framework, canonical_model, canonical_agent, background_models, snapshot_id}`. Setting any other key names will be silently dropped downstream.

---

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| Determinism digest + byte-identical assert (D-11/D-12) inside `experiment-restore.mjs` | orchestrator | batch/transform | No existing code computes a content digest over git-tree + KB + routing config, nor asserts cross-repeat equality. Net-new. Planner should use `node:crypto` `createHash('sha256')` (precedent: `measurement-stop.mjs:441` hashes `goal_sentence`), feeding a deterministic manifest: worktree `git_sha` string + a stable recursive content hash of `<sandboxDataDir>/knowledge-graph/` + the `llm-settings.json` bytes. Sort file entries for stable ordering. On mismatch: throw with both divergent digests (D-12). |
| Cartesian-axis expansion `{agent[]×model[]×framework[]×env[]} × repeats:N` | utility | transform | No existing matrix-expansion helper; standard nested-loop / reduce. Small, self-contained. |
| Unsupported-combination table (D-07, seed `copilot + headless → fail`) | data + validator | transform | No combination-gate precedent. Model as a `Object.freeze`d list of `{when:{agent,env}, reason, pointer}` (mirror the frozen-constant idiom at `taxonomy.mjs:26`), checked per cell. |

## Metadata

**Analog search scope:** `lib/experiments/`, `lib/repro/`, `scripts/`, `config/`
**Files scanned:** taxonomy.mjs, route-trace-resolve.mjs, evidence-harness.mjs, capture-snapshot.mjs, restore-snapshot.mjs, measurement-start.mjs, measurement-stop.mjs, repro-restore.mjs, task-taxonomy.yaml
**Pattern extraction date:** 2026-07-03
