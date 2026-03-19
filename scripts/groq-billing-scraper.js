#!/usr/bin/env node

/**
 * Groq Billing Scraper (Stagehand)
 *
 * Uses Stagehand's AI-powered extraction to scrape current month's spend from
 * console.groq.com/settings/billing/manage. Unlike the previous Playwright
 * approach with brittle CSS selectors, this uses LLM-based page understanding
 * to reliably extract billing data regardless of DOM structure changes.
 *
 * Requires:
 *   - ANTHROPIC_API_KEY in environment (for Stagehand's LLM calls)
 *   - Either a running Chrome with --remote-debugging-port=9222 (CDP),
 *     or it launches its own Chromium with stored cookies from groq-state.json
 *
 * Usage:
 *   node groq-billing-scraper.js [--force] [--login]
 *
 * Options:
 *   --force  Skip interval check, scrape immediately
 *   --login  Force headed mode for re-authentication
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CODING_REPO = process.env.CODING_REPO || path.resolve(__dirname, '..');

// Resolve Stagehand and zod from browser-access integration (where they're installed)
const browserAccessDir = path.join(CODING_REPO, 'integrations', 'browser-access');
const require = createRequire(path.join(browserAccessDir, 'package.json'));
const { Stagehand } = require('@browserbasehq/stagehand');
const { z } = require('zod');

const CONFIG_PATH = path.join(CODING_REPO, 'config', 'live-logging-config.json');
const LOG_PATH = path.join(CODING_REPO, 'logs', 'billing-scraper.log');
const STORAGE_STATE_PATH = path.join(CODING_REPO, '.browser-profiles', 'groq-state.json');
const BILLING_URL = 'https://console.groq.com/settings/billing/manage';
const LLM_PROVIDERS_PATH = path.join(CODING_REPO, 'config', 'llm-providers.yaml');

// Default fallback if YAML config is unreadable
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';

/**
 * Read the Anthropic standard model name from config/llm-providers.yaml.
 * Uses a lightweight regex parse to avoid requiring a YAML dependency.
 */
function getAnthropicModel() {
  try {
    const yaml = fs.readFileSync(LLM_PROVIDERS_PATH, 'utf8');
    // Match the anthropic provider block's standard model
    const anthropicMatch = yaml.match(/^\s*anthropic:\s*$/m);
    if (anthropicMatch) {
      const afterAnthropic = yaml.slice(anthropicMatch.index + anthropicMatch[0].length);
      const standardMatch = afterAnthropic.match(/^\s+standard:\s*"?([^"\s\n]+)"?/m);
      if (standardMatch) {
        return standardMatch[1];
      }
    }
  } catch {
    // Config unreadable — use default
  }
  return DEFAULT_ANTHROPIC_MODEL;
}

/**
 * Output JSON result to stdout (for caller)
 */
function outputResult(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

/**
 * Log message to file and optionally stderr
 */
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level}] ${message}`;

  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, entry + '\n');
  } catch {
    // Ignore logging errors
  }

  if (level === 'ERROR' || process.env.DEBUG) {
    process.stderr.write(entry + '\n');
  }
}

/**
 * Load config from live-logging-config.json
 */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    log(`Failed to load config: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Save config to live-logging-config.json
 */
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    log(`Failed to save config: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Check if we should scrape based on interval
 */
function shouldScrape(groqConfig, force = false) {
  if (force) return true;
  if (!groqConfig.autoScrape) return false;

  const intervalMs = (groqConfig.scrapeIntervalMinutes || 15) * 60 * 1000;
  const lastScraped = groqConfig.lastScraped ? new Date(groqConfig.lastScraped).getTime() : 0;
  const now = Date.now();

  return (now - lastScraped) >= intervalMs;
}

/**
 * Load cookies from Playwright storageState JSON file.
 * Returns array of Cookie objects compatible with Stagehand/Playwright.
 */
function loadStoredCookies() {
  try {
    if (!fs.existsSync(STORAGE_STATE_PATH)) return [];
    const state = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf8'));
    return state.cookies || [];
  } catch {
    return [];
  }
}

/**
 * Get browser WebSocket URL from CDP endpoint
 */
async function getBrowserWebSocketUrl(cdpUrl) {
  try {
    const port = cdpUrl.split(':').pop();
    const response = await fetch(`http://localhost:${port}/json/version`);
    const data = await response.json();
    return data.webSocketDebuggerUrl;
  } catch {
    return null;
  }
}

/**
 * Check if a CDP-enabled browser is running
 */
async function isCdpBrowserRunning(port = 9222) {
  try {
    const response = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Build Stagehand configuration.
 * Prefers connecting to an existing Chrome via CDP; falls back to launching
 * its own headless Chromium with stored cookies.
 */
async function buildStagehandConfig(options = {}) {
  const { headed = false } = options;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY is required for Stagehand AI extraction');
  }

  const baseConfig = {
    env: 'LOCAL',
    enableCaching: false,
    domSettleTimeoutMs: 30_000,
    modelName: getAnthropicModel(),
    modelClientOptions: {
      apiKey: anthropicKey,
    },
    disablePino: true,
    verbose: 0,
    logger: (msg) => log(`[stagehand] ${msg.message || JSON.stringify(msg)}`),
  };

  // Try CDP first (fastest — reuses running browser with existing session)
  const cdpPort = process.env.LOCAL_CDP_PORT || 9222;
  if (!headed && await isCdpBrowserRunning(cdpPort)) {
    const wsUrl = await getBrowserWebSocketUrl(`ws://localhost:${cdpPort}`);
    if (wsUrl) {
      log(`Connecting to existing Chrome via CDP at port ${cdpPort}`);
      return {
        ...baseConfig,
        localBrowserLaunchOptions: { cdpUrl: wsUrl },
      };
    }
  }

  // Fall back: launch own Chromium
  log(`Launching ${headed ? 'headed' : 'headless'} Chromium...`);
  const cookies = loadStoredCookies();
  return {
    ...baseConfig,
    localBrowserLaunchOptions: {
      headless: !headed,
      cookies: cookies.length > 0 ? cookies : undefined,
    },
  };
}

/**
 * Zod schema for billing data extraction
 */
const BillingSchema = z.object({
  currentMonthSpend: z.string().describe(
    'The current month total spend/usage amount in dollars (e.g. "$15.23" or "15.23"). Look for "Total Amount", "Current Monthly Usage", "Usage this month", or similar billing/spend indicators.'
  ),
  billingPeriod: z.string().optional().describe(
    'The billing period label if visible (e.g. "March 2026")'
  ),
  isLoginPage: z.boolean().describe(
    'True if the page is showing a login/authentication screen rather than billing data'
  ),
});

/**
 * Scrape billing data using Stagehand's AI-powered extraction.
 *
 * Returns { spend: number, success: boolean, error?: string }
 */
async function scrapeGroqBilling(forceLogin = false) {
  let stagehand = null;

  try {
    log('Starting Groq billing scrape (Stagehand)...');

    const config = await buildStagehandConfig({ headed: forceLogin });
    stagehand = new Stagehand(config);
    await stagehand.init();

    const page = stagehand.page;

    // Navigate to billing page
    log(`Navigating to ${BILLING_URL}...`);
    await page.goto(BILLING_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for the page to settle
    await page.waitForLoadState('networkidle').catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Use AI extraction to understand the page
    log('Extracting billing data with AI...');
    const extracted = await page.extract({
      instruction: 'Extract the current monthly billing spend amount in US dollars from this page. Look for the total usage/spend amount for the current billing period. If this is a login page, indicate that instead.',
      schema: BillingSchema,
    });

    log(`Extraction result: ${JSON.stringify(extracted)}`);

    // Check if we hit a login page
    if (extracted.isLoginPage) {
      log('On login page — attempting login flow...');

      if (forceLogin) {
        // Headed mode: try to click GitHub login and wait for user
        try {
          await page.act({ action: 'Click the "Continue with GitHub" button' });
          log('Clicked GitHub login button');
        } catch {
          log('Could not auto-click GitHub login', 'WARN');
          process.stderr.write('[Groq Billing] Please click "Continue with GitHub" to log in.\n');
        }

        // Wait for user to complete login
        let authenticated = false;
        for (let i = 0; i < 90; i++) {
          const url = page.url();
          if (!url.includes('login') && !url.includes('auth') && !url.includes('github.com')) {
            authenticated = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (!authenticated) {
          return { success: false, error: 'Login timed out after 3 minutes', needsAuth: true };
        }

        // Navigate back to billing after login
        await page.goto(BILLING_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Save cookies for next time
        try {
          const context = page.context();
          const cookies = await context.cookies();
          const storageState = { cookies };
          fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
          fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2));
          log(`Saved session cookies to ${STORAGE_STATE_PATH}`);
        } catch (e) {
          log(`Failed to save cookies: ${e.message}`, 'WARN');
        }

        // Re-extract after login
        const postLoginData = await page.extract({
          instruction: 'Extract the current monthly billing spend amount in US dollars from this page.',
          schema: BillingSchema,
        });

        log(`Post-login extraction: ${JSON.stringify(postLoginData)}`);

        if (postLoginData.isLoginPage) {
          return { success: false, error: 'Still on login page after authentication attempt', needsAuth: true };
        }

        return parseSpendResult(postLoginData);
      }

      // Headless mode and on login page: session expired
      return { success: false, error: 'Session expired. Run with --login to re-authenticate.', needsAuth: true };
    }

    // Got billing data
    return parseSpendResult(extracted);

  } catch (error) {
    log(`Scrape failed: ${error.message}`, 'ERROR');
    return { success: false, error: error.message };
  } finally {
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        // Ignore close errors (especially for CDP connections)
      }
    }
  }
}

/**
 * Parse the extracted spend amount into a numeric result
 */
function parseSpendResult(extracted) {
  const spendText = extracted.currentMonthSpend;
  if (!spendText) {
    return { success: false, error: 'No spend amount found in extraction' };
  }

  // Extract numeric value from text like "$15.23" or "15.23"
  const match = spendText.match(/\$?([0-9]+\.?[0-9]*)/);
  if (!match) {
    return { success: false, error: `Could not parse spend from: ${spendText}` };
  }

  const spend = parseFloat(match[1]);
  log(`Scraped Groq spend: $${spend}${extracted.billingPeriod ? ` (${extracted.billingPeriod})` : ''}`);
  return { success: true, spend };
}

/**
 * Main function - check interval and scrape if needed
 */
async function main() {
  const force = process.argv.includes('--force');
  const forceLogin = process.argv.includes('--login');

  // Load config
  const config = loadConfig();
  if (!config) {
    process.exit(1);
  }

  const groqConfig = config.provider_credits?.groq;
  if (!groqConfig) {
    log('No Groq config found', 'ERROR');
    process.exit(1);
  }

  // Check if billing type is monthly
  if (groqConfig.billingType !== 'monthly') {
    log('Groq billing type is not monthly, skipping scrape');
    process.exit(0);
  }

  // Check if we should scrape (--login always scrapes)
  if (!forceLogin && !shouldScrape(groqConfig, force)) {
    const lastScraped = groqConfig.lastScraped || 'never';
    const intervalMins = groqConfig.scrapeIntervalMinutes || 15;
    log(`Skipping scrape - last scraped: ${lastScraped}, interval: ${intervalMins}m`);

    // Output current values for caller
    outputResult({
      scraped: false,
      reason: 'interval_not_reached',
      currentSpend: groqConfig.monthlySpend,
      lastScraped: groqConfig.lastScraped
    });
    process.exit(0);
  }

  // Perform scrape
  const result = await scrapeGroqBilling(forceLogin);

  if (result.success) {
    // Update config with new spend
    groqConfig.monthlySpend = result.spend;
    groqConfig.lastScraped = new Date().toISOString();

    if (saveConfig(config)) {
      log(`Updated Groq spend to $${result.spend}`);
      outputResult({
        scraped: true,
        spend: result.spend,
        lastScraped: groqConfig.lastScraped
      });
    }
  } else {
    log(`Scrape failed: ${result.error}`, 'ERROR');
    outputResult({
      scraped: false,
      error: result.error,
      needsAuth: result.needsAuth || false
    });

    // Don't fail the process for auth issues - just report
    if (result.needsAuth) {
      process.exit(0);
    }
    process.exit(1);
  }
}

// Run if called directly
main().catch(error => {
  log(`Fatal error: ${error.message}`, 'ERROR');
  process.exit(1);
});

export { scrapeGroqBilling, shouldScrape };
