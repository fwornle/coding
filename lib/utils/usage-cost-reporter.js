/**
 * Usage Cost Reporter
 *
 * Lightweight, standalone module for reporting LLM API usage costs to the
 * central BudgetTracker file (.data/llm-usage-costs.json).
 *
 * Unlike the full BudgetTracker class (which requires EventEmitter, DuckDB,
 * and runs in-process), this module is designed for external consumers that
 * make Groq/LLM API calls outside the main LLMService:
 *
 *   - mcp-constraint-monitor (groq-engine.js)
 *   - code-graph-rag (Python, via subprocess call)
 *   - okb/rapid-automations
 *
 * It performs atomic read-modify-write on the JSON file with basic file
 * locking to avoid clobbering the main BudgetTracker's writes.
 *
 * Usage (Node.js):
 *   import { reportUsageCost } from '../../lib/utils/usage-cost-reporter.js';
 *   await reportUsageCost({
 *     provider: 'groq',
 *     model: 'llama-3.3-70b-versatile',
 *     inputTokens: 500,
 *     outputTokens: 150,
 *     source: 'mcp-constraint-monitor'
 *   });
 *
 * Usage (CLI, for Python callers):
 *   node usage-cost-reporter.js --provider groq --model llama-3.3-70b-versatile \
 *     --input-tokens 500 --output-tokens 150 --source code-graph-rag
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pricing per million tokens (input/output)
// Keep in sync with BudgetTracker.js and api-quota-checker.js
const PRICING = {
  groq: {
    'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
    'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
    'llama-4-scout-17b-16e-instruct': { input: 0.11, output: 0.34 },
    'llama-4-maverick-17b-128e-instruct': { input: 0.20, output: 0.60 },
    'qwen3-32b': { input: 0.29, output: 0.59 },
    'openai/gpt-oss-120b': { input: 0.15, output: 0.60 },
    'openai/gpt-oss-20b': { input: 0.075, output: 0.30 },
    'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
    default: { input: 0.50, output: 0.50 },
  },
  anthropic: {
    default: { input: 3.00, output: 15.00 },
  },
  openai: {
    default: { input: 5.00, output: 15.00 },
  },
};

/**
 * Resolve path to .data/llm-usage-costs.json
 */
function resolveCostFilePath() {
  const repoRoot = process.env.CODING_REPO
    || path.resolve(__dirname, '..', '..');
  return path.join(repoRoot, '.data', 'llm-usage-costs.json');
}

/**
 * Get current month as 3-letter abbreviation
 */
function getCurrentMonthAbbrev() {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return months[new Date().getMonth()];
}

/**
 * Calculate cost from token counts
 *
 * @param {string} provider - Provider name (e.g. 'groq')
 * @param {string} model - Model name (e.g. 'llama-3.3-70b-versatile')
 * @param {number} inputTokens - Input/prompt token count
 * @param {number} outputTokens - Output/completion token count
 * @returns {number} Cost in USD
 */
export function calculateCost(provider, model, inputTokens, outputTokens) {
  const providerPricing = PRICING[provider] || PRICING.groq;
  const modelPricing = providerPricing[model] || providerPricing.default;
  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;
  return inputCost + outputCost;
}

/**
 * Simple file lock using a .lock file with PID
 * Returns unlock function, or null if lock could not be acquired.
 */
function acquireLock(filePath, timeoutMs = 5000) {
  const lockPath = filePath + '.lock';
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      // O_EXCL: fail if file already exists (atomic create)
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);

      // Return unlock function
      return () => {
        try { fs.unlinkSync(lockPath); } catch { /* already removed */ }
      };
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock held by someone else — check if stale (>10s old)
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 10000) {
            // Stale lock, remove and retry
            try { fs.unlinkSync(lockPath); } catch { /* race, retry */ }
          }
        } catch { /* stat failed, retry */ }

        // Brief sleep before retry (10ms)
        const waitUntil = Date.now() + 10;
        while (Date.now() < waitUntil) { /* busy wait */ }
        continue;
      }
      // Unexpected error
      return null;
    }
  }

  // Timeout
  return null;
}

/**
 * Report usage cost to the central BudgetTracker file.
 *
 * Performs atomic read-modify-write with file locking.
 *
 * @param {Object} usage
 * @param {string} usage.provider - Provider name (e.g. 'groq')
 * @param {string} usage.model - Model name (e.g. 'llama-3.3-70b-versatile')
 * @param {number} usage.inputTokens - Input/prompt tokens
 * @param {number} usage.outputTokens - Output/completion tokens
 * @param {number} [usage.totalTokens] - Total tokens (if inputTokens/outputTokens unavailable)
 * @param {string} [usage.source] - Source identifier for debugging (e.g. 'mcp-constraint-monitor')
 * @returns {Promise<{cost: number, totalProviderCost: number}>}
 */
export async function reportUsageCost(usage) {
  const {
    provider = 'groq',
    model = 'default',
    inputTokens = 0,
    outputTokens = 0,
    totalTokens,
    source = 'external',
  } = usage;

  const actualInputTokens = inputTokens || 0;
  const actualOutputTokens = outputTokens || 0;
  const actualTotalTokens = totalTokens || (actualInputTokens + actualOutputTokens);

  const cost = calculateCost(provider, model, actualInputTokens, actualOutputTokens);

  const costFilePath = resolveCostFilePath();
  const currentMonth = getCurrentMonthAbbrev();

  // Acquire lock for atomic read-modify-write
  const unlock = acquireLock(costFilePath);
  if (!unlock) {
    // Could not acquire lock; log warning but still return cost for caller awareness
    process.stderr.write(`[usage-cost-reporter] WARNING: Could not acquire lock for ${costFilePath}, cost not persisted\n`);
    return { cost, totalProviderCost: cost };
  }

  try {
    // Read existing data
    let data = { billingMonth: currentMonth, lastUpdated: null, providers: {} };

    try {
      if (fs.existsSync(costFilePath)) {
        const existing = JSON.parse(fs.readFileSync(costFilePath, 'utf8'));
        if (existing.billingMonth === currentMonth) {
          data = existing;
        }
        // Different month: start fresh (month rollover)
      }
    } catch {
      // Corrupt file; start fresh
    }

    // Ensure provider entry exists
    if (!data.providers[provider]) {
      data.providers[provider] = { cost: 0, tokens: 0, count: 0 };
    }

    // Increment
    data.providers[provider].cost = Math.round((data.providers[provider].cost + cost) * 1000000) / 1000000;
    data.providers[provider].tokens += actualTotalTokens;
    data.providers[provider].count += 1;
    data.lastUpdated = new Date().toISOString();

    // Atomic write
    const dir = path.dirname(costFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = costFilePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, costFilePath);

    return {
      cost,
      totalProviderCost: data.providers[provider].cost,
    };
  } finally {
    unlock();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CLI mode: allow Python (or any process) to report usage via subprocess
//
// Usage:
//   node usage-cost-reporter.js --provider groq --model llama-3.3-70b-versatile \
//     --input-tokens 500 --output-tokens 150 --source code-graph-rag
//
// Output (JSON):
//   {"cost":0.000413,"totalProviderCost":2.345678}
// ──────────────────────────────────────────────────────────────────────────────
async function cliMain() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    process.stderr.write(`Usage: node usage-cost-reporter.js --provider <name> --model <name> --input-tokens <n> --output-tokens <n> [--source <name>]\n`);
    process.exit(args.includes('--help') ? 0 : 1);
  }

  function getArg(name) {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  }

  const provider = getArg('--provider') || 'groq';
  const model = getArg('--model') || 'default';
  const inputTokens = parseInt(getArg('--input-tokens') || '0', 10);
  const outputTokens = parseInt(getArg('--output-tokens') || '0', 10);
  const totalTokens = getArg('--total-tokens') ? parseInt(getArg('--total-tokens'), 10) : undefined;
  const source = getArg('--source') || 'cli';

  const result = await reportUsageCost({ provider, model, inputTokens, outputTokens, totalTokens, source });
  process.stdout.write(JSON.stringify(result) + '\n');
}

// Run CLI if invoked directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('usage-cost-reporter.js') ||
  process.argv[1].endsWith('usage-cost-reporter')
);

if (isMain) {
  cliMain().catch(err => {
    process.stderr.write(`[usage-cost-reporter] Fatal: ${err.message}\n`);
    process.exit(1);
  });
}
