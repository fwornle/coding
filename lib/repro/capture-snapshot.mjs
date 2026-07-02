// lib/repro/capture-snapshot.mjs
//
// Phase 67, Plan 67-04 (Wave 2) — REPRO-01 / SC-1: assemble the full RunSnapshot. Composes
// the Plan 03 primitives (git/env/mcp) + the Task 1 KB capture into ONE traversal-safe,
// secret-safe `.data/run-snapshots/<sanitizeTaskId(task_id)>/` directory with a manifest
// that records the clock_base (span-open baseline, Pattern 3) and an HONEST per-channel
// capability map (llm:record; WebSearch/WebFetch/MCP:record-only — replay-hard-fails per
// D-06/D-08; clock:virtualized).
//
// Every capture step is BEST-EFFORT (try/catch, stderr log, never throws the whole capture
// on one bad item) so a partially-broken environment still yields a usable partial snapshot
// with a manifest — mirroring the fail-soft contract of the Plan 03 primitives.
//
// SECURITY:
//   • T-67-04-01 (path traversal): sanitizeTaskId (allow [A-Za-z0-9._-], path.basename'd)
//     on every snapshot-path construction — a `../evil` task_id can never escape run-snapshots.
//   • T-67-04-02 (single-owner DB): KB captured via captureKb (filesystem copy only) — no
//     second store on the live LevelDB.
//   • T-67-04-03 (secret leakage): env is allowlist-only (captureEnvAllowlist); the routing
//     config is copied ONLY after a secret-field deny-regex check (FLAG T-67-03-04); the
//     snapshot dir is gitignored (Plan 03 — .gitignore `.data/run-snapshots/`).
//   • T-67-04-04 (repudiation): manifest.kb_caveat states consistent-at-span-open only.
//
// Diagnostics via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { captureGitState } from './git-state.mjs';
import { captureEnvAllowlist, SECRET_DENY_RE } from './env-allowlist.mjs';
import { captureMcpInventory } from './mcp-inventory.mjs';
import { captureKb } from './kb-capture.mjs';

const CLI_TIMEOUT_MS = 20_000;

/**
 * task_id → filesystem-safe id (T-67-04-01). Mirrors the proxy's measurement-span.ts:83
 * `sanitizeTaskId` contract: `path.basename` to strip any directory component, then keep
 * only `[A-Za-z0-9._-]` (any other char → `_`). Empty/degenerate input falls back to
 * `unknown` so a snapshot dir is always constructible under run-snapshots.
 * @param {unknown} id
 * @returns {string}
 */
export function sanitizeTaskId(id) {
  const base = path.basename(String(id ?? ''));
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned : 'unknown';
}

/** Best-effort JSON write (pretty). Never throws — logs and returns false on failure. */
function writeJson(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
    return true;
  } catch (err) {
    process.stderr.write(`[capture-snapshot] write ${path.basename(file)} failed: ${err?.message || err}\n`);
    return false;
  }
}

/** Best-effort text write. Never throws. */
function writeText(file, text) {
  try {
    fs.writeFileSync(file, text);
    return true;
  } catch (err) {
    process.stderr.write(`[capture-snapshot] write ${path.basename(file)} failed: ${err?.message || err}\n`);
    return false;
  }
}

/**
 * Recursively test whether any KEY name in a parsed object is secret-shaped
 * (SECRET_DENY_RE — /KEY|TOKEN|SECRET|PASSWORD/i). Used to gate the llm-settings.json copy
 * per FLAG T-67-03-04: the routing config should hold `processOverrides` ONLY, no secrets.
 * @param {unknown} node
 * @returns {boolean}
 */
function hasSecretShapedKey(node) {
  if (!node || typeof node !== 'object') return false;
  for (const [key, value] of Object.entries(node)) {
    if (SECRET_DENY_RE.test(key)) return true;
    if (value && typeof value === 'object' && hasSecretShapedKey(value)) return true;
  }
  return false;
}

/**
 * Capture the agent binary + node version into `agent-version.txt`. `claude --version` is
 * best-effort (may be absent in CI); node's `process.version` always lands.
 * @param {string} dir
 */
function captureAgentVersion(dir) {
  let claudeVersion = 'unavailable';
  try {
    const res = spawnSync('claude', ['--version'], {
      encoding: 'utf8',
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    if (!res.error && res.status === 0 && typeof res.stdout === 'string' && res.stdout.trim()) {
      claudeVersion = res.stdout.trim();
    }
  } catch {
    /* best-effort */
  }
  writeText(path.join(dir, 'agent-version.txt'), `claude: ${claudeVersion}\nnode: ${process.version}\n`);
}

/**
 * Assemble the full RunSnapshot for `task_id` under `<repoRoot>/.data/run-snapshots/`.
 *
 * @param {string} task_id run/task identifier (sanitized for the dir name)
 * @param {object} [opts]
 * @param {string} [opts.repoRoot] repo working tree root (default: cwd)
 * @param {string} [opts.dataDir] live LLM_PROXY_DATA_DIR (default: `<repoRoot>/.data`)
 * @param {string} [opts.prompt] the run's prompt text → prompt.txt
 * @returns {{ snapshot_id: string, dir: string, clock_base: number }}
 */
export function captureSnapshot(task_id, opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const dataDir = opts.dataDir || path.join(repoRoot, '.data');
  const prompt = typeof opts.prompt === 'string' ? opts.prompt : '';

  const snapshot_id = sanitizeTaskId(task_id);
  const dir = path.join(repoRoot, '.data', 'run-snapshots', snapshot_id);
  // clock_base = span-open baseline (Pattern 3) — recorded BEFORE any capture I/O so replay
  // virtualizes from the earliest possible instant.
  const clock_base = Date.now();

  fs.mkdirSync(dir, { recursive: true });

  // --- Git workspace state (D-03) ------------------------------------------------------
  let gitSha = null;
  let kbCaveat = '';
  try {
    const gitState = captureGitState(repoRoot);
    gitSha = gitState.sha;
    writeText(path.join(dir, 'git-sha.txt'), (gitState.sha || '') + '\n');
    writeText(path.join(dir, 'dirty.patch'), gitState.dirtyPatch || '');
    writeJson(path.join(dir, 'submodules.json'), gitState.submodules || []);
    // untracked/: a list plus a best-effort copy of each untracked file (the dirty patch
    // does NOT carry untracked content — git-state.mjs).
    const untrackedDir = path.join(dir, 'untracked');
    fs.mkdirSync(untrackedDir, { recursive: true });
    writeText(path.join(untrackedDir, 'list.txt'), (gitState.untracked || []).join('\n') + '\n');
    for (const rel of gitState.untracked || []) {
      try {
        const src = path.join(repoRoot, rel);
        const dst = path.join(untrackedDir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      } catch {
        /* best-effort per file */
      }
    }
  } catch (err) {
    process.stderr.write(`[capture-snapshot] git capture failed: ${err?.message || err}\n`);
  }

  // --- KB (D-02, filesystem copy only) -------------------------------------------------
  try {
    const kb = captureKb(dataDir, dir);
    kbCaveat = kb.caveat;
  } catch (err) {
    process.stderr.write(`[capture-snapshot] kb capture failed: ${err?.message || err}\n`);
  }

  // --- Env allowlist (D-05) ------------------------------------------------------------
  try {
    writeJson(path.join(dir, 'env-allowlist.json'), captureEnvAllowlist(process.env));
  } catch (err) {
    process.stderr.write(`[capture-snapshot] env capture failed: ${err?.message || err}\n`);
  }

  // --- MCP inventory -------------------------------------------------------------------
  try {
    writeJson(path.join(dir, 'mcp-inventory.json'), captureMcpInventory());
  } catch (err) {
    process.stderr.write(`[capture-snapshot] mcp capture failed: ${err?.message || err}\n`);
  }

  // --- Routing config (processOverrides) — secret-gated copy (FLAG T-67-03-04) ---------
  let llmSettingsCaptured = false;
  let llmSettingsOmittedReason = null;
  try {
    const src = path.join(dataDir, 'llm-proxy', 'llm-settings.json');
    if (fs.existsSync(src)) {
      const raw = fs.readFileSync(src, 'utf8');
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      if (parsed && hasSecretShapedKey(parsed)) {
        // A key/token/secret-shaped field is present — DO NOT copy; note in manifest.
        llmSettingsOmittedReason =
          'llm-settings.json omitted: a secret-shaped field (KEY|TOKEN|SECRET|PASSWORD) was ' +
          'detected; routing config must hold processOverrides only (T-67-04-03 / T-67-03-04).';
      } else {
        fs.copyFileSync(src, path.join(dir, 'llm-settings.json'));
        llmSettingsCaptured = true;
      }
    } else {
      llmSettingsOmittedReason = 'llm-settings.json not found at <dataDir>/llm-proxy/.';
    }
  } catch (err) {
    llmSettingsOmittedReason = `llm-settings.json copy failed: ${err?.message || err}`;
    process.stderr.write(`[capture-snapshot] ${llmSettingsOmittedReason}\n`);
  }

  // --- Agent + node version ------------------------------------------------------------
  captureAgentVersion(dir);

  // --- .planning/ state ----------------------------------------------------------------
  try {
    const planSrc = path.join(repoRoot, '.planning');
    if (fs.existsSync(planSrc)) {
      fs.cpSync(planSrc, path.join(dir, 'planning'), { recursive: true });
    }
  } catch (err) {
    process.stderr.write(`[capture-snapshot] planning copy failed: ${err?.message || err}\n`);
  }

  // --- Prompt text ---------------------------------------------------------------------
  writeText(path.join(dir, 'prompt.txt'), prompt);

  // --- Manifest (honest per-channel capability map + clock_base) -----------------------
  const manifest = {
    snapshot_id,
    task_id: String(task_id ?? ''),
    created_at: new Date(clock_base).toISOString(),
    clock_base,
    git_sha: gitSha,
    kb_caveat: kbCaveat,
    llm_settings_captured: llmSettingsCaptured,
    // Only present when the routing config was NOT copied (secret-gated or missing).
    ...(llmSettingsOmittedReason ? { llm_settings_omitted_reason: llmSettingsOmittedReason } : {}),
    channels: {
      // LLM is fully record/replayable through rapid-llm-proxy (REPRO-02 §LLM Channel).
      llm: 'record',
      // Harness channels: record-interface-present, replay-hard-fails (D-06/D-08, SC-4).
      WebSearch: 'record-only',
      WebFetch: 'record-only',
      MCP: 'record-only',
      // Clock virtualized on replay via the freeze-at-base + monotonic-offset shim.
      clock: 'virtualized',
    },
  };
  writeJson(path.join(dir, 'manifest.json'), manifest);

  return { snapshot_id, dir, clock_base };
}
