// lib/repro/mcp-inventory.mjs
//
// Phase 67, Plan 67-03 (Wave 1) — REPRO-01 internal-state capture, primitive #3:
// MCP server inventory. Enumerates the MCP servers configured for the agent at
// snapshot time so a repeat run can verify the same tool surface is present.
//
// Strategy (RESEARCH Assumption A3): the LIVE `claude mcp list` is authoritative at
// snapshot time; if the CLI is absent/errors, fall back to reading the MCP config
// file (~/.claude.json `mcpServers`). BEST-EFFORT — never throws: if both fail it
// returns `{ servers: [], source: 'unavailable' }`.
//
// SECURITY (T-67-03-03): the CLI is spawned with a FIXED argv array (no shell string).
// The config fallback reads only server NAMES (metadata), never command args/env that
// might carry secrets. PURE stdlib (child_process + fs), no network, no km-core.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI_TIMEOUT_MS = 20_000;

/**
 * Parse `claude mcp list` stdout into `[{ name, version }]`. Each line looks like:
 *   "semantic-analysis: node /path/to/index.js - ✔ Connected"
 * `claude mcp list` does not emit a version, so `version` is null (best-effort;
 * versions are metadata, not restore-critical — RESEARCH A3).
 * @param {string} stdout
 * @returns {{ name: string, version: string|null }[]}
 */
function parseMcpListOutput(stdout) {
  const servers = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // "<name>: <command...> - <status>" — name is the token before the first colon,
    // and must look like an MCP server id (no spaces).
    const m = line.match(/^([A-Za-z0-9._-]+):\s+\S/);
    if (m) servers.push({ name: m[1], version: null });
  }
  return servers;
}

/**
 * Live enumeration via `claude mcp list` (fixed argv). Returns parsed servers or null
 * on any spawn error / non-zero exit / empty parse.
 * @returns {{ name: string, version: string|null }[]|null}
 */
function fromLiveCli() {
  try {
    const res = spawnSync('claude', ['mcp', 'list'], {
      encoding: 'utf8',
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (res.error || res.status !== 0 || typeof res.stdout !== 'string') return null;
    const servers = parseMcpListOutput(res.stdout);
    return servers.length > 0 ? servers : null;
  } catch {
    return null;
  }
}

/**
 * Config fallback: read `mcpServers` keys from the first available MCP config file.
 * Reads NAMES only (no command/env — those may carry secrets). Returns null on any
 * read/parse failure or empty config.
 * @returns {{ name: string, version: string|null }[]|null}
 */
function fromConfigFile() {
  const candidates = [
    path.join(os.homedir(), '.claude.json'),
    path.join(process.cwd(), '.mcp.json'),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const json = JSON.parse(text);
      const mcp = json && typeof json === 'object' ? json.mcpServers : null;
      if (mcp && typeof mcp === 'object') {
        const names = Object.keys(mcp);
        if (names.length > 0) {
          return names.map((name) => ({ name, version: null }));
        }
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Capture the MCP server inventory, best-effort and never-throwing.
 *
 * @returns {{ servers: { name: string, version: string|null }[], source: 'live'|'config'|'unavailable' }}
 */
export function captureMcpInventory() {
  try {
    const live = fromLiveCli();
    if (live) return { servers: live, source: 'live' };

    const config = fromConfigFile();
    if (config) return { servers: config, source: 'config' };
  } catch {
    // fall through to unavailable
  }
  return { servers: [], source: 'unavailable' };
}
