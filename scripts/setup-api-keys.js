#!/usr/bin/env node
/**
 * Interactive API Admin Key Setup
 *
 * Guides the user through configuring admin/management API keys
 * for real-time spending data in the tmux status bar.
 *
 * Providers:
 * - Anthropic: Admin API key for /v1/organizations/cost_report
 * - OpenAI: Admin API key for /v1/organization/costs
 * - xAI: Management key + team ID for prepaid balance
 * - Groq: No API needed — uses automatic BudgetTracker usage tracking
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

function httpGet(url, headers, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers,
      timeout
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return '';
  return fs.readFileSync(ENV_PATH, 'utf8');
}

function setEnvVar(name, value) {
  let content = readEnv();
  const regex = new RegExp(`^${name}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${name}=${value}`);
  } else {
    content = content.trimEnd() + `\n${name}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, content);
}

function getEnvVar(name) {
  const content = readEnv();
  const match = content.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim() : '';
}

const providers = [
  {
    name: 'Anthropic',
    envKey: 'ANTHROPIC_ADMIN_API_KEY',
    url: 'https://console.anthropic.com/settings/admin-keys',
    validate: async (key) => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      const res = await httpGet(
        `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(start)}&ending_at=${encodeURIComponent(end)}`,
        { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      );
      return res.statusCode === 200;
    }
  },
  {
    name: 'OpenAI',
    envKey: 'OPENAI_ADMIN_API_KEY',
    url: 'https://platform.openai.com/settings/organization/admin-keys',
    validate: async (key) => {
      const start = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
      const res = await httpGet(
        `https://api.openai.com/v1/organization/costs?start_time=${start}&bucket_width=1d&limit=1`,
        { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
      );
      return res.statusCode === 200;
    }
  },
  {
    name: 'xAI',
    envKeys: ['XAI_MANAGEMENT_KEY', 'XAI_TEAM_ID'],
    url: 'https://console.x.ai (Settings > Management Keys)',
    validate: async (key, teamId) => {
      const res = await httpGet(
        `https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`,
        { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
      );
      return res.statusCode === 200;
    }
  }
];

async function setupProvider(provider) {
  process.stdout.write(`\n--- ${provider.name} ---\n`);
  process.stdout.write(`  Get key at: ${provider.url}\n`);

  if (provider.name === 'xAI') {
    const existingKey = getEnvVar('XAI_MANAGEMENT_KEY');
    const existingTeam = getEnvVar('XAI_TEAM_ID');
    if (existingKey && existingTeam) {
      process.stdout.write(`  Current: XAI_MANAGEMENT_KEY=${existingKey.slice(0, 8)}... XAI_TEAM_ID=${existingTeam}\n`);
    }

    const key = await ask('  Management Key (Enter to skip): ');
    if (!key.trim()) return false;

    const teamId = await ask('  Team ID: ');
    if (!teamId.trim()) {
      process.stdout.write('  Skipped (team ID required)\n');
      return false;
    }

    process.stdout.write('  Validating...');
    try {
      const ok = await provider.validate(key.trim(), teamId.trim());
      if (ok) {
        setEnvVar('XAI_MANAGEMENT_KEY', key.trim());
        setEnvVar('XAI_TEAM_ID', teamId.trim());
        process.stdout.write(' OK\n');
        return true;
      } else {
        process.stdout.write(' FAILED (invalid key or team ID)\n');
        return false;
      }
    } catch (e) {
      process.stdout.write(` ERROR: ${e.message}\n`);
      return false;
    }
  }

  // Single-key providers (Anthropic, OpenAI)
  const existing = getEnvVar(provider.envKey);
  if (existing) {
    process.stdout.write(`  Current: ${existing.slice(0, 12)}...\n`);
  }

  const key = await ask(`  ${provider.envKey} (Enter to skip): `);
  if (!key.trim()) return false;

  process.stdout.write('  Validating...');
  try {
    const ok = await provider.validate(key.trim());
    if (ok) {
      setEnvVar(provider.envKey, key.trim());
      process.stdout.write(' OK\n');
      return true;
    } else {
      process.stdout.write(' FAILED (invalid key or missing permissions)\n');
      return false;
    }
  } catch (e) {
    process.stdout.write(` ERROR: ${e.message}\n`);
    return false;
  }
}

async function main() {
  process.stdout.write('\n=== API Admin Key Setup ===\n');
  process.stdout.write('Configure admin/management keys for real-time spend tracking.\n');
  process.stdout.write('Press Enter to skip any provider.\n');

  const results = {};
  for (const provider of providers) {
    results[provider.name] = await setupProvider(provider);
  }

  process.stdout.write('\n--- Groq ---\n');
  process.stdout.write('  No API needed - uses automatic BudgetTracker usage tracking\n');
  results['Groq'] = 'auto';

  process.stdout.write('\n=== Summary ===\n');
  for (const [name, ok] of Object.entries(results)) {
    const status = ok === 'auto' ? 'auto-tracked' : ok ? 'configured' : 'skipped';
    process.stdout.write(`  ${name}: ${status}\n`);
  }

  process.stdout.write('\nDone. Run the status line to verify:\n');
  process.stdout.write('  rm -f .logs/combined-status-line-cache.txt && node scripts/combined-status-line.js\n\n');

  rl.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
