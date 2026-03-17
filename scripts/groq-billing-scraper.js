#!/usr/bin/env node

/**
 * Groq Billing Scraper
 *
 * Uses Playwright to scrape current month's spend from console.groq.com/settings/billing/manage
 * Called by the health monitoring system during active coding sessions.
 *
 * Uses a persistent browser profile so you only need to log in once.
 * On first run (or when session expires), launches headed for interactive login.
 * Subsequent runs use headless mode with the stored session.
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
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CODING_REPO = process.env.CODING_REPO || path.resolve(__dirname, '..');

const CONFIG_PATH = path.join(CODING_REPO, 'config', 'live-logging-config.json');
const LOG_PATH = path.join(CODING_REPO, 'logs', 'billing-scraper.log');
const STORAGE_STATE_PATH = path.join(CODING_REPO, '.browser-profiles', 'groq-state.json');

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
 * Check if the page is showing a login/auth screen
 */
function isLoginPage(page) {
  const url = page.url();
  return url.includes('login') || url.includes('auth') || url.includes('signin');
}

/**
 * Extract spend amount from the billing page
 * Returns spend text or null
 */
async function extractSpendFromPage(page) {
  // Wait for page to be fully loaded and stable
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  let spendText = null;

  // Try to find by looking for text near "Total Amount" in the Current Monthly Usage section
  try {
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
    const spendMatch = content.match(/Total\s*Amount[^$]*\$([0-9]+\.?[0-9]*)/i) ||
                       content.match(/Current Monthly Usage[^$]*\$([0-9]+\.?[0-9]*)/i);
    if (spendMatch) {
      spendText = '$' + spendMatch[1];
    }
  }

  return spendText;
}

/**
 * Scrape billing data from console.groq.com
 * Uses storageState (JSON cookie file) to maintain login session.
 * When auth is needed, launches in headed mode for interactive login via GitHub.
 * (Google OAuth blocks automation browsers, so GitHub is used instead.)
 *
 * Returns { spend: number, success: boolean, error?: string }
 */
async function scrapeGroqBilling(forceLogin = false) {
  let browser = null;

  try {
    log('Starting Groq billing scrape...');

    // Ensure profile directory exists
    fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

    const hasStoredSession = fs.existsSync(STORAGE_STATE_PATH);

    // First attempt: headless with stored cookies (unless --login forced)
    if (!forceLogin && hasStoredSession) {
      log('Trying headless scrape with stored session...');
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        storageState: STORAGE_STATE_PATH
      });

      const page = await context.newPage();
      await page.goto('https://console.groq.com/settings/billing/manage', {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      if (!isLoginPage(page)) {
        const spendText = await extractSpendFromPage(page);
        if (spendText) {
          const match = spendText.match(/\$([0-9]+\.?[0-9]*)/);
          if (match) {
            const spend = parseFloat(match[1]);
            log(`Scraped Groq spend: $${spend}`);
            // Refresh stored cookies
            await context.storageState({ path: STORAGE_STATE_PATH });
            return { success: true, spend };
          }
        }
        const screenshotPath = path.join(CODING_REPO, 'logs', 'groq-billing-debug.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        log('Authenticated but could not find spend amount on page', 'WARN');
        return { success: false, error: 'Could not find spend amount on page' };
      }

      // Session expired — close and fall through to headed login
      log('Session expired, switching to headed mode for login...');
      await browser.close();
      browser = null;
    }

    // Headed mode: interactive login via GitHub
    log('Launching headed browser for Groq login via GitHub...');
    process.stderr.write('\n[Groq Billing] Opening browser — use "Continue with GitHub" to log in.\n');
    process.stderr.write('[Groq Billing] (Google login is blocked in automation browsers.)\n');

    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://console.groq.com/settings/billing/manage', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // If on login page, try to click "Continue with GitHub" automatically
    if (isLoginPage(page)) {
      try {
        // Dismiss cookie banner if present
        const acceptBtn = page.locator('text=Accept All');
        if (await acceptBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await acceptBtn.click();
          await page.waitForTimeout(500);
        }
      } catch { /* no cookie banner */ }

      try {
        const githubBtn = page.locator('text=Continue with GitHub');
        await githubBtn.waitFor({ timeout: 5000 });
        await githubBtn.click();
        log('Clicked "Continue with GitHub"');
      } catch {
        log('Could not find GitHub login button, waiting for manual login...', 'WARN');
        process.stderr.write('[Groq Billing] Please click "Continue with GitHub" to log in.\n');
      }
    }

    // Wait for the user to complete login (poll every 2s for up to 3 minutes)
    let authenticated = false;
    for (let i = 0; i < 90; i++) {
      const url = page.url();
      if (!isLoginPage(page) && !url.includes('github.com')) {
        authenticated = true;
        break;
      }
      await page.waitForTimeout(2000);
    }

    if (!authenticated) {
      log('Login timed out after 3 minutes', 'WARN');
      return { success: false, error: 'Login timed out. Run again with --login to retry.', needsAuth: true };
    }

    // Wait for page to fully settle after login redirect
    log('Login detected, waiting for page to settle...');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);

    // Navigate to billing page (login may have redirected elsewhere)
    await page.goto('https://console.groq.com/settings/billing/manage', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.waitForTimeout(2000);

    log('Login successful, extracting billing data...');

    // Save session cookies for future headless scrapes
    await context.storageState({ path: STORAGE_STATE_PATH });
    log(`Session saved to ${STORAGE_STATE_PATH}`);

    const spendText = await extractSpendFromPage(page);

    if (!spendText) {
      const screenshotPath = path.join(CODING_REPO, 'logs', 'groq-billing-debug.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log('Could not find spend on page after login', 'WARN');
      return { success: false, error: 'Could not find spend amount on page' };
    }

    const match = spendText.match(/\$([0-9]+\.?[0-9]*)/);
    if (!match) {
      return { success: false, error: `Could not parse spend from: ${spendText}` };
    }

    const spend = parseFloat(match[1]);
    log(`Scraped Groq spend: $${spend}`);
    process.stderr.write(`[Groq Billing] Got spend: $${spend}. You can close the browser window.\n`);

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
