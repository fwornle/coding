/**
 * API Quota Checker
 *
 * Shared utility for checking API quota/balance across multiple LLM providers.
 * Used by both statusline and health dashboard.
 *
 * Supported Providers:
 * - Groq (free tier or monthly billing - no public usage API)
 *   - Free tier: Shows pie symbol (Gq●)
 *   - Monthly billing: Shows spend + month (Gq$2JAN)
 * - Google Gemini (free tier - no public usage API)
 * - Anthropic Claude (real-time via Admin API - requires ANTHROPIC_ADMIN_API_KEY)
 * - OpenAI (real-time via Admin API - requires OPENAI_ADMIN_API_KEY)
 * - X.AI (estimated - no public usage API)
 *
 * Configuration (config/live-logging-config.json):
 * - Groq: Set billingType to "monthly" and update monthlySpend from console.groq.com
 * - Anthropic/OpenAI: Set prepaidCredits for remaining balance display
 * - X.AI: Default $25 free credits
 *
 * Admin API Keys:
 * - Anthropic: Create at console.anthropic.com -> Settings -> Admin API Keys
 *   Key format: sk-ant-admin-...
 * - OpenAI: Create at platform.openai.com/settings/organization/admin-keys
 * - Groq: No public billing API yet (feature request pending)
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { createLogger } from './logging/Logger.js';

const logger = createLogger('billing');

// Provider abbreviations for statusline display
// Note: Groq = Gq (not G) to avoid collision with Google = Ggl
const PROVIDER_ABBREV = {
  groq: 'Gq',
  google: 'Ggl',
  anthropic: 'A',
  openai: 'O',
  xai: 'X'
};

// Pie chart symbols for percentage display (Unicode geometric shapes)
// Used to visually represent remaining credit percentage
const PIE_SYMBOLS = {
  empty: '○',      // U+25CB - 0% (empty circle)
  quarter: '◔',    // U+25D4 - ~25% (quarter filled)
  half: '◐',       // U+25D0 - ~50% (half filled)
  threeQuarter: '◕', // U+25D5 - ~75% (three-quarters filled)
  full: '●'        // U+25CF - 100% (full circle)
};

/**
 * Get pie chart symbol based on percentage
 * @param {number} percent - Percentage remaining (0-100)
 * @returns {string} Unicode pie chart symbol
 */
function getPieSymbol(percent) {
  if (percent >= 87.5) return PIE_SYMBOLS.full;        // 87.5-100%
  if (percent >= 62.5) return PIE_SYMBOLS.threeQuarter; // 62.5-87.5%
  if (percent >= 37.5) return PIE_SYMBOLS.half;         // 37.5-62.5%
  if (percent >= 12.5) return PIE_SYMBOLS.quarter;      // 12.5-37.5%
  return PIE_SYMBOLS.empty;                             // 0-12.5%
}

// Cache for quota data (reduce API calls)
const quotaCache = new Map();

// Provider pricing (USD per million tokens)
const PROVIDER_PRICING = {
  anthropic: {
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
    'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
    'claude-3-opus-20240229': { input: 15.00, output: 75.00 }
  },
  openai: {
    'gpt-4o': { input: 5.00, output: 15.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 }
  },
  groq: {
    // Groq has free tier AND paid plans
    // Free: 7.2M tokens/day, paid: per-token pricing
    'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
    'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
    'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
    free: true // Also has free tier
  },
  google: { free: true }, // Free tier (15 RPM, 1M TPD)
  xai: { free_credits: 25.0 }
};

/**
 * Check quota for all active providers
 *
 * @param {Object} config - Configuration from live-logging-config.json
 * @param {Object} options - { useCache: boolean, timeout: number }
 * @returns {Promise<Array>} Array of provider status objects
 */
export async function checkAllProviders(config, options = {}) {
  const { useCache = true, timeout = 5000 } = options;

  const providers = ['groq', 'google', 'anthropic', 'openai', 'xai'];
  const activeProviders = providers.filter(p => hasApiKey(p));

  if (activeProviders.length === 0) {
    return [];
  }

  // Check all providers in parallel
  const results = await Promise.allSettled(
    activeProviders.map(provider =>
      checkSingleProvider(provider, config, { useCache, timeout })
    )
  );

  // Extract successful results
  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}

/**
 * Check quota for a single provider
 *
 * @param {string} provider - Provider name (groq, google, anthropic, openai, xai)
 * @param {Object} config - Configuration object
 * @param {Object} options - { useCache: boolean, timeout: number }
 * @returns {Promise<Object|null>} Provider status object or null if unavailable
 */
export async function checkSingleProvider(provider, config, options = {}) {
  const { useCache = true, timeout = 5000 } = options;

  // Check cache first
  if (useCache) {
    const cached = getCachedQuota(provider);
    if (cached) {
      return cached;
    }
  }

  // Provider-specific checking logic
  let result = null;

  try {
    switch (provider) {
      case 'groq':
        result = await checkGroqQuota(config, timeout);
        break;
      case 'google':
        result = await checkGoogleQuota(config, timeout);
        break;
      case 'anthropic':
        result = await checkAnthropicQuota(config, timeout);
        break;
      case 'openai':
        result = await checkOpenAIQuota(config, timeout);
        break;
      case 'xai':
        result = await checkXAIQuota(config, timeout);
        break;
      default:
        logger.warn(`Unknown provider: ${provider}`);
        return null;
    }

    if (result) {
      // Cache the result
      setCachedQuota(provider, result);
    }

    return result;

  } catch (error) {
    logger.error(`Failed to check ${provider} quota`, { error: error.message });

    // Return last cached value if available
    const cached = quotaCache.get(provider);
    if (cached) {
      return { ...cached.data, status: 'degraded', error: 'Using cached data' };
    }

    return null;
  }
}

/**
 * Check Groq API quota
 * Free tier: 7.2M tokens/day, 14.4K requests/min
 * Paid tier: Monthly billing (no public usage API yet)
 *
 * Note: Groq doesn't have a public billing API yet (feature request pending).
 * For paid plans, we use config-based monthly spend tracking.
 * Set provider_credits.groq.monthlySpend and billingMonth in live-logging-config.json
 */
async function checkGroqQuota(config, timeout) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const groqConfig = config?.provider_credits?.groq;
  const billingType = groqConfig?.billingType || 'free';

  if (billingType === 'monthly') {
    // Monthly billing - auto-update month if needed
    const configuredMonth = groqConfig?.billingMonth || getCurrentMonthAbbrev();
    const autoUpdate = autoUpdateGroqBillingMonth(configuredMonth);

    // Use updated values if month changed, otherwise use config values
    const billingMonth = autoUpdate.month;
    const monthlySpend = autoUpdate.wasUpdated ? 0 : (groqConfig?.monthlySpend || 0);
    const spendLimit = groqConfig?.spendLimit;

    // Calculate status based on spend limit if configured
    let status = 'healthy';
    let remaining = null;
    if (spendLimit && spendLimit > 0) {
      remaining = Math.round(((spendLimit - monthlySpend) / spendLimit) * 100);
      status = remaining > 20 ? 'healthy' : remaining > 5 ? 'low' : 'critical';
    }

    return {
      provider: 'groq',
      name: 'Groq',
      abbrev: PROVIDER_ABBREV.groq,
      status,
      quota: {
        remaining: remaining,
        monthlySpend: monthlySpend,
        billingMonth: billingMonth,
        used: `$${monthlySpend.toFixed(2)}`,
        limit: spendLimit ? `$${spendLimit}` : null,
        unit: 'USD'
      },
      cost: {
        total: monthlySpend,
        currency: 'USD',
        period: billingMonth,
        note: 'Monthly billing (update from console.groq.com)'
      },
      rateLimit: null, // Paid plans have higher limits
      lastChecked: new Date().toISOString(),
      cacheStrategy: 'config-monthly'
    };
  }

  // Free tier - show rate limit status with pie symbol
  return {
    provider: 'groq',
    name: 'Groq',
    abbrev: PROVIDER_ABBREV.groq,
    status: 'healthy',
    quota: {
      remaining: 100, // Assume full availability for free tier
      used: 'free',
      limit: '7.2M tokens/day',
      unit: 'rate-limited'
    },
    cost: null, // Free tier
    rateLimit: {
      requestsPerMinute: 14400,
      tokensPerDay: 7200000
    },
    lastChecked: new Date().toISOString(),
    cacheStrategy: 'free-tier'
  };
}

/**
 * Get current month as 3-letter abbreviation
 */
function getCurrentMonthAbbrev() {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return months[new Date().getMonth()];
}

/**
 * Auto-update Groq billing month in config when month changes
 * Resets monthlySpend to 0 on month rollover
 *
 * @param {string} configuredMonth - The month currently in config (e.g., "JAN")
 * @returns {{ month: string, spend: number, wasUpdated: boolean }}
 */
function autoUpdateGroqBillingMonth(configuredMonth) {
  const currentMonth = getCurrentMonthAbbrev();

  // If month matches, no update needed
  if (configuredMonth === currentMonth) {
    return { month: currentMonth, spend: null, wasUpdated: false };
  }

  // Month has changed - update config file
  try {
    const configPath = path.join(
      process.env.CODING_REPO || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
      'config',
      'live-logging-config.json'
    );

    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      if (config.provider_credits?.groq) {
        const oldMonth = config.provider_credits.groq.billingMonth;
        const oldSpend = config.provider_credits.groq.monthlySpend;

        // Update to current month and reset spend
        config.provider_credits.groq.billingMonth = currentMonth;
        config.provider_credits.groq.monthlySpend = 0;

        // Write back to config
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        // Log the auto-update (visible in health dashboard logs)
        const timestamp = new Date().toISOString();
        const logMsg = `[${timestamp}] Groq billing month auto-updated: ${oldMonth} ($${oldSpend}) -> ${currentMonth} ($0)`;

        // Append to a billing log for audit trail
        const logPath = path.join(path.dirname(configPath), '..', 'logs', 'billing-updates.log');
        try {
          fs.mkdirSync(path.dirname(logPath), { recursive: true });
          fs.appendFileSync(logPath, logMsg + '\n');
        } catch {
          // Ignore logging errors
        }

        return { month: currentMonth, spend: 0, wasUpdated: true };
      }
    }
  } catch (error) {
    // If we can't update config, just use current month
    // This can happen if config is read-only or path issues
  }

  return { month: currentMonth, spend: 0, wasUpdated: false };
}

/**
 * Check Google Gemini API quota (free tier, rate-limited)
 * Free tier: 15 requests/min, 1M tokens/day
 */
async function checkGoogleQuota(config, timeout) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  try {
    // Google doesn't expose quota usage directly
    // Check if API is accessible (minimal request)
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    const response = await makeHttpRequest(endpoint, {
      method: 'GET',
      timeout
    });

    if (response.statusCode === 200) {
      return {
        provider: 'google',
        name: 'Google Gemini',
        abbrev: PROVIDER_ABBREV.google,
        status: 'healthy',
        quota: {
          remaining: null, // No credit tracking for free tier
          used: 'free',
          limit: '15 RPM, 1M TPD',
          unit: 'rate-limited'
        },
        cost: null, // Free tier
        rateLimit: {
          requestsPerMinute: 15,
          tokensPerDay: 1000000
        },
        lastChecked: new Date().toISOString(),
        cacheStrategy: 'free-tier'
      };
    }
  } catch (error) {
    logger.error('Google API check failed', { error: error.message });
  }

  return null;
}

/**
 * Check Anthropic API quota using Admin API
 * Requires ANTHROPIC_ADMIN_API_KEY (sk-ant-admin-...)
 * Endpoints:
 * - GET /v1/organizations/cost_report - Cost breakdown
 * - GET /v1/organizations/usage_report/messages - Usage metrics
 */
async function checkAnthropicQuota(config, timeout) {
  const regularApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  const adminApiKey = process.env.ANTHROPIC_ADMIN_API_KEY;

  if (!regularApiKey && !adminApiKey) return null;

  // If we have an Admin API key, fetch real usage data
  if (adminApiKey) {
    try {
      // Get cost report for the current month using RFC 3339 timestamps
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      // End of current day (to include today's usage)
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

      // RFC 3339 format (ISO 8601)
      const startingAt = startOfMonth.toISOString();
      const endingAt = endOfToday.toISOString();

      const costResponse = await makeHttpRequest(
        `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(startingAt)}&ending_at=${encodeURIComponent(endingAt)}`,
        {
          method: 'GET',
          headers: {
            'x-api-key': adminApiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          },
          timeout
        }
      );

      if (costResponse.statusCode === 200) {
        const costData = JSON.parse(costResponse.body);

        // Calculate total cost for the period from buckets
        let totalCost = 0;
        if (costData.data && Array.isArray(costData.data)) {
          // Each bucket has cost_cents field
          totalCost = costData.data.reduce((sum, bucket) => {
            const bucketCost = bucket.cost_cents || bucket.cost_usd * 100 || 0;
            return sum + bucketCost;
          }, 0) / 100; // Convert cents to dollars
        } else if (typeof costData.total_cost_usd === 'number') {
          totalCost = costData.total_cost_usd;
        }

        // Use prepaid credits if configured, otherwise show just the spent amount
        const prepaidCredits = config?.provider_credits?.anthropic?.prepaidCredits;
        const hasPrepaidConfig = prepaidCredits !== null && prepaidCredits !== undefined && prepaidCredits > 0;

        let remaining = null;
        let remainingCredits = null;
        if (hasPrepaidConfig) {
          remainingCredits = Math.max(0, prepaidCredits - totalCost);
          remaining = Math.round((remainingCredits / prepaidCredits) * 100);
        }

        return {
          provider: 'anthropic',
          name: 'Anthropic Claude',
          abbrev: PROVIDER_ABBREV.anthropic,
          status: hasPrepaidConfig
            ? (remaining > 10 ? 'healthy' : remaining > 0 ? 'low' : 'critical')
            : 'healthy',
          quota: {
            remaining: remaining, // null if no prepaid config
            remainingCredits: remainingCredits, // actual $ remaining
            used: `$${totalCost.toFixed(2)}`,
            limit: hasPrepaidConfig ? `$${prepaidCredits}` : null,
            unit: 'USD'
          },
          cost: {
            total: totalCost,
            currency: 'USD',
            period: 'current month'
          },
          rateLimit: null,
          lastChecked: new Date().toISOString(),
          cacheStrategy: 'real-time'
        };
      } else if (costResponse.statusCode === 401 || costResponse.statusCode === 403) {
        logger.warn('Anthropic Admin API key invalid or lacks permissions. Set ANTHROPIC_ADMIN_API_KEY with admin privileges.');
      } else if (costResponse.statusCode === 429) {
        // Rate limit - use prepaid credits from config as fallback estimate
        logger.warn('Anthropic Admin API rate limited, using config estimate');
        const prepaidCredits = config?.provider_credits?.anthropic?.prepaidCredits;
        if (prepaidCredits && prepaidCredits > 0) {
          // Use prepaid credits as estimate (assume minimal usage for now)
          return {
            provider: 'anthropic',
            name: 'Anthropic Claude',
            abbrev: PROVIDER_ABBREV.anthropic,
            status: 'healthy',
            quota: {
              remaining: 100, // Assume full credits available when rate limited
              remainingCredits: prepaidCredits, // Show configured prepaid amount
              used: '$0.00 (estimated)',
              limit: `$${prepaidCredits}`,
              unit: 'USD'
            },
            cost: {
              total: 0,
              currency: 'USD',
              period: 'estimated (rate limited)'
            },
            rateLimit: null,
            lastChecked: new Date().toISOString(),
            cacheStrategy: 'rate-limited-estimate'
          };
        }
      } else {
        logger.warn(`Anthropic cost API returned ${costResponse.statusCode}`, { body: costResponse.body });
      }
    } catch (error) {
      logger.error('Anthropic Admin API check failed', { error: error.message });
    }
  }

  // Fallback: No admin key or API call failed
  // If we have prepaid credits configured, use them as estimate
  const prepaidCredits = config?.provider_credits?.anthropic?.prepaidCredits;
  if (prepaidCredits && prepaidCredits > 0) {
    return {
      provider: 'anthropic',
      name: 'Anthropic Claude',
      abbrev: PROVIDER_ABBREV.anthropic,
      status: 'healthy',
      quota: {
        remaining: 100,
        remainingCredits: prepaidCredits,
        used: '$0.00 (estimated)',
        limit: `$${prepaidCredits}`,
        unit: 'USD'
      },
      cost: {
        total: 0,
        currency: 'USD',
        note: 'Using configured prepaid credits as estimate'
      },
      rateLimit: null,
      lastChecked: new Date().toISOString(),
      cacheStrategy: 'config-estimate'
    };
  }

  // True fallback: No prepaid credits configured
  return {
    provider: 'anthropic',
    name: 'Anthropic Claude',
    abbrev: PROVIDER_ABBREV.anthropic,
    status: 'healthy',
    quota: {
      remaining: 'N/A',
      used: 'N/A',
      limit: 'Set ANTHROPIC_ADMIN_API_KEY for real data',
      unit: 'USD'
    },
    cost: {
      total: 'unknown',
      currency: 'USD',
      note: 'Get Admin API key at console.anthropic.com -> Settings -> Admin API Keys'
    },
    rateLimit: null,
    lastChecked: new Date().toISOString(),
    cacheStrategy: 'estimated'
  };
}

/**
 * Check OpenAI API quota using Admin API
 * Requires OPENAI_ADMIN_API_KEY
 * Endpoints:
 * - GET /v1/organization/costs - Cost data
 * - GET /v1/organization/usage/completions - Usage metrics
 */
async function checkOpenAIQuota(config, timeout) {
  const regularApiKey = process.env.OPENAI_API_KEY;
  const adminApiKey = process.env.OPENAI_ADMIN_API_KEY;

  if (!regularApiKey && !adminApiKey) return null;

  // If we have an Admin API key, fetch real usage data
  if (adminApiKey) {
    try {
      // Get cost data for today (API only supports 1d bucket_width for costs)
      const now = new Date();
      const startOfMonth = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

      const costResponse = await makeHttpRequest(
        `https://api.openai.com/v1/organization/costs?start_time=${startOfMonth}&bucket_width=1d&limit=31`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${adminApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout
        }
      );

      if (costResponse.statusCode === 200) {
        const costData = JSON.parse(costResponse.body);

        // Sum up costs from all buckets
        let totalCost = 0;
        if (costData.data && Array.isArray(costData.data)) {
          for (const bucket of costData.data) {
            if (bucket.results && Array.isArray(bucket.results)) {
              totalCost += bucket.results.reduce((sum, item) => sum + (item.amount?.value || 0), 0);
            }
          }
        }

        // Use prepaid credits if configured, otherwise show just the spent amount
        const prepaidCredits = config?.provider_credits?.openai?.prepaidCredits;
        const hasPrepaidConfig = prepaidCredits !== null && prepaidCredits !== undefined && prepaidCredits > 0;

        let remaining = null;
        let remainingCredits = null;
        if (hasPrepaidConfig) {
          remainingCredits = Math.max(0, prepaidCredits - totalCost);
          remaining = Math.round((remainingCredits / prepaidCredits) * 100);
        }

        return {
          provider: 'openai',
          name: 'OpenAI',
          abbrev: PROVIDER_ABBREV.openai,
          status: hasPrepaidConfig
            ? (remaining > 10 ? 'healthy' : remaining > 0 ? 'low' : 'critical')
            : 'healthy',
          quota: {
            remaining: remaining, // null if no prepaid config
            remainingCredits: remainingCredits, // actual $ remaining
            used: `$${totalCost.toFixed(2)}`,
            limit: hasPrepaidConfig ? `$${prepaidCredits}` : null,
            unit: 'USD'
          },
          cost: {
            total: totalCost,
            currency: 'USD',
            period: 'current month'
          },
          rateLimit: null,
          lastChecked: new Date().toISOString(),
          cacheStrategy: 'real-time'
        };
      } else if (costResponse.statusCode === 401 || costResponse.statusCode === 403) {
        logger.warn('OpenAI Admin API key invalid or lacks permissions. Set OPENAI_ADMIN_API_KEY with admin privileges.');
      } else {
        logger.warn(`OpenAI cost API returned ${costResponse.statusCode}`, { body: costResponse.body });
      }
    } catch (error) {
      logger.error('OpenAI Admin API check failed', { error: error.message });
    }
  }

  // Fallback: No admin key or API call failed - return estimated status
  return {
    provider: 'openai',
    name: 'OpenAI',
    abbrev: PROVIDER_ABBREV.openai,
    status: 'healthy',
    quota: {
      remaining: 'N/A',
      used: 'N/A',
      limit: 'Set OPENAI_ADMIN_API_KEY for real data',
      unit: 'USD'
    },
    cost: {
      total: 'unknown',
      currency: 'USD',
      note: 'Get Admin API key at platform.openai.com/settings/organization/admin-keys'
    },
    rateLimit: null,
    lastChecked: new Date().toISOString(),
    cacheStrategy: 'estimated'
  };
}

/**
 * Check X.AI (Grok) API quota
 * Free credits: $25 (configurable in provider_credits)
 */
async function checkXAIQuota(config, timeout) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;

  try {
    // X.AI doesn't have a public usage endpoint yet
    // Use prepaid credits from config (default $25 free credits)
    const prepaidCredits = config?.provider_credits?.xai?.prepaidCredits ?? 25;

    // TODO: When X.AI adds a usage API, fetch actual usage here
    // For now, return estimated status based on config
    // Estimated usage - would need to be tracked locally or via future API
    const estimatedUsed = 0; // No way to get actual usage yet
    const remainingCredits = Math.max(0, prepaidCredits - estimatedUsed);
    const remaining = prepaidCredits > 0 ? Math.round((remainingCredits / prepaidCredits) * 100) : null;

    return {
      provider: 'xai',
      name: 'X.AI (Grok)',
      abbrev: PROVIDER_ABBREV.xai,
      status: remaining !== null ? (remaining > 10 ? 'healthy' : remaining > 0 ? 'low' : 'critical') : 'healthy',
      quota: {
        remaining: remaining,
        remainingCredits: remainingCredits,
        used: `$${estimatedUsed.toFixed(2)}`,
        limit: `$${prepaidCredits}`,
        unit: 'USD'
      },
      cost: {
        total: estimatedUsed,
        currency: 'USD'
      },
      rateLimit: null,
      lastChecked: new Date().toISOString(),
      cacheStrategy: 'estimated'
    };
  } catch (error) {
    logger.error('X.AI API check failed', { error: error.message });
  }

  return null;
}

/**
 * Make HTTP/HTTPS request with timeout
 */
function makeHttpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 5000
    };

    const req = protocol.request(requestOptions, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Check if provider has API key configured
 */
function hasApiKey(provider) {
  switch (provider) {
    case 'groq':
      return !!process.env.GROQ_API_KEY;
    case 'google':
      return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    case 'anthropic':
      return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_ADMIN_API_KEY);
    case 'openai':
      return !!(process.env.OPENAI_API_KEY || process.env.OPENAI_ADMIN_API_KEY);
    case 'xai':
      return !!process.env.XAI_API_KEY;
    default:
      return false;
  }
}

/**
 * Check if provider has Admin API key for real usage data
 */
export function hasAdminApiKey(provider) {
  switch (provider) {
    case 'anthropic':
      return !!process.env.ANTHROPIC_ADMIN_API_KEY;
    case 'openai':
      return !!process.env.OPENAI_ADMIN_API_KEY;
    default:
      return false;
  }
}

/**
 * Get cached quota data
 */
function getCachedQuota(provider) {
  const cached = quotaCache.get(provider);
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  const maxAge = cached.data.cacheStrategy === 'real-time' ? 30000 : 300000; // 30s or 5min

  if (age < maxAge) {
    return cached.data;
  }

  return null;
}

/**
 * Set cached quota data
 */
function setCachedQuota(provider, data) {
  quotaCache.set(provider, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Format quota for statusline display
 *
 * Format:
 * - Free tier: "Gq●" (pie symbol showing availability)
 * - Monthly billing: "Gq$2JAN" (spent dollars + month)
 * - Prepaid credits: "A$15" (remaining dollars)
 *
 * Pie symbols: ● (full) → ◕ → ◐ → ◔ → ○ (empty)
 *
 * @param {Object} providerData - Provider status object
 * @returns {string} Formatted display string
 */
export function formatQuotaDisplay(providerData) {
  const { abbrev, quota } = providerData;

  // Monthly billing - show spent amount + month (e.g., "$2JAN")
  if (typeof quota.monthlySpend === 'number' && quota.billingMonth) {
    return `${abbrev}$${Math.round(quota.monthlySpend)}${quota.billingMonth}`;
  }

  // If we have remaining credits in $, show that
  if (typeof quota.remainingCredits === 'number') {
    return `${abbrev}$${Math.round(quota.remainingCredits)}`;
  }

  // If we have a percentage remaining, show pie symbol
  if (typeof quota.remaining === 'number') {
    return `${abbrev}${getPieSymbol(quota.remaining)}`;
  }

  // No data available (no admin key)
  if (quota.remaining === 'N/A') {
    return `${abbrev}○`;
  }

  // Free tier / rate-limited only - show as fully available
  return `${abbrev}●`;
}

/**
 * Calculate estimated cost for a provider
 *
 * @param {string} provider - Provider name
 * @param {Object} usage - Usage data { input_tokens, output_tokens, model }
 * @returns {number|null} Estimated cost in USD
 */
export function calculateCost(provider, usage) {
  const { input_tokens = 0, output_tokens = 0, model } = usage;

  const pricing = PROVIDER_PRICING[provider];
  if (!pricing) return null;

  // Free tier providers
  if (pricing.free || pricing.free_credits) {
    return 0;
  }

  // Paid providers with model-specific pricing
  const modelPricing = pricing[model];
  if (!modelPricing) {
    // Use first available model pricing as fallback
    const fallback = Object.values(pricing)[0];
    if (!fallback) return null;

    const inputCost = (input_tokens / 1000000) * fallback.input;
    const outputCost = (output_tokens / 1000000) * fallback.output;
    return inputCost + outputCost;
  }

  const inputCost = (input_tokens / 1000000) * modelPricing.input;
  const outputCost = (output_tokens / 1000000) * modelPricing.output;

  return inputCost + outputCost;
}

/**
 * Get overall status from multiple providers
 *
 * @param {Array} providers - Array of provider status objects
 * @returns {string} Overall status: 'healthy', 'degraded', 'unhealthy'
 */
export function getOverallStatus(providers) {
  if (providers.length === 0) return 'unknown';

  const statuses = providers.map(p => p.status);

  if (statuses.some(s => s === 'critical')) return 'unhealthy';
  if (statuses.some(s => s === 'low' || s === 'degraded')) return 'degraded';

  return 'healthy';
}
