#!/usr/bin/env node

/**
 * Groq Billing Scraper
 *
 * Uses Playwright to scrape current month's spend from console.groq.com/settings/billing/manage
 * Called by the health monitoring system during active coding sessions.
 *
 * Requirements:
 * - GROQ_API_KEY environment variable (used to verify we have Groq access)
 * - Playwright browser automation via MCP or direct
 *
 * Usage:
 *   node groq-billing-scraper.js [--force]
 *
 * Options:
 *   --force  Skip interval check, scrape immediately
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CODING_REPO = process.env.CODING_REPO || path.resolve(__dirname, '..');

const CONFIG_PATH = path.join(CODING_REPO, 'config', 'live-logging-config.json');
const LOG_PATH = path.join(CODING_REPO, 'logs', 'billing-scraper.log');

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
 * Scrape billing data from console.groq.com
 * Returns { spend: number, success: boolean, error?: string }
 */
async function scrapeGroqBilling() {
  let browser = null;

  try {
    log('Starting Groq billing scrape...');

    // Check for Groq API key (indicates we have Groq access)
    if (!process.env.GROQ_API_KEY) {
      return { success: false, error: 'GROQ_API_KEY not set' };
    }

    // Launch browser in headless mode
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    const page = await context.newPage();

    // Navigate to Groq billing manage page (where Current Monthly Usage is shown)
    log('Navigating to console.groq.com/settings/billing/manage...');
    await page.goto('https://console.groq.com/settings/billing/manage', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Check if we need to log in
    const url = page.url();
    if (url.includes('login') || url.includes('auth')) {
      log('Login required - cannot scrape without authentication', 'WARN');
      return {
        success: false,
        error: 'Login required. Please log in to console.groq.com in your browser first.',
        needsAuth: true
      };
    }

    // Wait for billing content to load
    await page.waitForTimeout(2000);

    // Look for "Current Monthly Usage" section with "Total Amount" value
    // Page structure: "Current Monthly Usage" header, then "Total Amount" label, then "$X.XX"
    let spendText = null;

    // Try to find by looking for text near "Total Amount" in the Current Monthly Usage section
    try {
      // Find the Current Monthly Usage section and get the dollar amount
      const usageSection = await page.locator('text=Current Monthly Usage').locator('..').first();
      if (usageSection) {
        const amountElement = await usageSection.locator('text=/^\\$[0-9]+\\.?[0-9]*/').first();
        if (amountElement) {
          spendText = await amountElement.textContent();
        }
      }
    } catch {
      // Try alternative approach
    }

    // Fallback: look for Total Amount pattern
    if (!spendText) {
      try {
        const totalAmountLabel = await page.locator('text=Total Amount').first();
        if (totalAmountLabel) {
          // Get the parent container and find the dollar amount nearby
          const container = await totalAmountLabel.locator('..').first();
          const allText = await container.textContent();
          const match = allText?.match(/\$([0-9]+\.?[0-9]*)/);
          if (match) {
            spendText = '$' + match[1];
          }
        }
      } catch {
        // Try next fallback
      }
    }

    // Fallback: search full page content for spend pattern
    if (!spendText) {
      const content = await page.content();
      // Look for Total Amount followed by dollar value
      const spendMatch = content.match(/Total\s*Amount[^$]*\$([0-9]+\.?[0-9]*)/i) ||
                         content.match(/Current Monthly Usage[^$]*\$([0-9]+\.?[0-9]*)/i);
      if (spendMatch) {
        spendText = '$' + spendMatch[1];
      }
    }

    if (!spendText) {
      // Take a screenshot for debugging
      const screenshotPath = path.join(CODING_REPO, 'logs', 'groq-billing-debug.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`Could not find spend on page. Screenshot saved to ${screenshotPath}`, 'WARN');
      return { success: false, error: 'Could not find spend amount on page' };
    }

    // Parse the spend amount
    const spendMatch = spendText.match(/\$([0-9]+\.?[0-9]*)/);
    if (!spendMatch) {
      return { success: false, error: `Could not parse spend from: ${spendText}` };
    }

    const spend = parseFloat(spendMatch[1]);
    log(`Scraped Groq spend: $${spend}`);

    return { success: true, spend };

  } catch (error) {
    log(`Scrape failed: ${error.message}`, 'ERROR');
    return { success: false, error: error.message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Main function - check interval and scrape if needed
 */
async function main() {
  const force = process.argv.includes('--force');

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

  // Check if we should scrape
  if (!shouldScrape(groqConfig, force)) {
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
  const result = await scrapeGroqBilling();

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
