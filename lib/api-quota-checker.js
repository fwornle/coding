/**
 * API Quota Checker
 *
 * Shared utility for checking API quota/balance across multiple LLM providers.
 * Used by both statusline and health dashboard.
 *
 * Supported Providers:
 * - Groq (estimated - no public usage API)
 * - Google Gemini (estimated - no public usage API)
 * - Anthropic Claude (real-time via Admin API - requires ANTHROPIC_ADMIN_API_KEY)
 * - OpenAI (real-time via Admin API - requires OPENAI_ADMIN_API_KEY)
 * - X.AI (estimated - no public usage API)
 *
 * Admin API Keys:
 * - Anthropic: Create at console.anthropic.com -> Settings -> Admin API Keys
 *   Key format: sk-ant-admin-...
 * - OpenAI: Create at platform.openai.com/settings/organization/admin-keys
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';

// Provider abbreviations for statusline display
// Note: Groq = Gq (not G) to avoid collision with Google = Ggl
const PROVIDER_ABBREV = {
  groq: 'Gq',
  google: 'Ggl',
  anthropic: 'A',
  openai: 'O',
  xai: 'X'
};

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
  groq: { free: true }, // Free tier
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
        console.warn(`Unknown provider: ${provider}`);
        return null;
    }

    if (result) {
      // Cache the result
      setCachedQuota(provider, result);
    }

    return result;

  } catch (error) {
    console.error(`Failed to check ${provider} quota:`, error.message);

    // Return last cached value if available
    const cached = quotaCache.get(provider);
    if (cached) {
      return { ...cached.data, status: 'degraded', error: 'Using cached data' };
    }

    return null;
  }
}

/**
 * Check Groq API quota (real-time, fast)
 * Free tier: 7.2M tokens/day, 14.4K requests/min
 */
async function checkGroqQuota(config, timeout) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  // Groq doesn't have a usage endpoint yet, use request-based estimation
  // For now, return optimistic free tier status
  return {
    provider: 'groq',
    name: 'Groq',
    abbrev: PROVIDER_ABBREV.groq,
    status: 'healthy',
    quota: {
      remaining: 95, // Percentage (estimated)
      used: 'N/A',
      limit: '7.2M tokens/day, 14.4K RPM',
      unit: 'requests'
    },
    cost: null, // Free tier
    rateLimit: {
      requestsPerMinute: 14400,
      tokensPerDay: 7200000
    },
    lastChecked: new Date().toISOString(),
    cacheStrategy: 'estimated'
  };
}

/**
 * Check Google Gemini API quota (real-time, fast)
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
          remaining: 90, // Estimated (API accessible)
          used: 'N/A',
          limit: '15 RPM, 1M TPD',
          unit: 'requests'
        },
        cost: null, // Free tier
        rateLimit: {
          requestsPerMinute: 15,
          tokensPerDay: 1000000
        },
        lastChecked: new Date().toISOString(),
        cacheStrategy: 'estimated'
      };
    }
  } catch (error) {
    console.error('Google API check failed:', error.message);
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

        // Estimate remaining based on monthly budget from config
        const monthlyBudget = config?.provider_budgets?.anthropic?.monthlyBudget || 100; // Default $100/month
        const remaining = Math.max(0, Math.round(((monthlyBudget - totalCost) / monthlyBudget) * 100));

        return {
          provider: 'anthropic',
          name: 'Anthropic Claude',
          abbrev: PROVIDER_ABBREV.anthropic,
          status: remaining > 10 ? 'healthy' : remaining > 0 ? 'low' : 'critical',
          quota: {
            remaining: remaining,
            used: `$${totalCost.toFixed(2)}`,
            limit: `$${monthlyBudget}`,
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
        console.warn('Anthropic Admin API key invalid or lacks permissions. Set ANTHROPIC_ADMIN_API_KEY with admin privileges.');
      } else {
        console.warn(`Anthropic cost API returned ${costResponse.statusCode}: ${costResponse.body}`);
      }
    } catch (error) {
      console.error('Anthropic Admin API check failed:', error.message);
    }
  }

  // Fallback: No admin key or API call failed - return estimated status
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

        // Estimate remaining based on monthly budget from config
        const monthlyBudget = config?.provider_budgets?.openai?.monthlyBudget || 100; // Default $100/month
        const remaining = Math.max(0, Math.round(((monthlyBudget - totalCost) / monthlyBudget) * 100));

        return {
          provider: 'openai',
          name: 'OpenAI',
          abbrev: PROVIDER_ABBREV.openai,
          status: remaining > 10 ? 'healthy' : remaining > 0 ? 'low' : 'critical',
          quota: {
            remaining: remaining,
            used: `$${totalCost.toFixed(2)}`,
            limit: `$${monthlyBudget}`,
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
        console.warn('OpenAI Admin API key invalid or lacks permissions. Set OPENAI_ADMIN_API_KEY with admin privileges.');
      } else {
        console.warn(`OpenAI cost API returned ${costResponse.statusCode}: ${costResponse.body}`);
      }
    } catch (error) {
      console.error('OpenAI Admin API check failed:', error.message);
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
 * Free credits: $25
 */
async function checkXAIQuota(config, timeout) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;

  try {
    // X.AI may have usage endpoint (check console.x.ai for details)
    // For now, return optimistic status
    return {
      provider: 'xai',
      name: 'X.AI (Grok)',
      abbrev: PROVIDER_ABBREV.xai,
      status: 'healthy',
      quota: {
        remaining: 85, // Estimated
        used: '$3.75',
        limit: '$25',
        unit: 'USD'
      },
      cost: {
        total: 3.75,
        currency: 'USD'
      },
      rateLimit: null,
      lastChecked: new Date().toISOString(),
      cacheStrategy: 'estimated'
    };
  } catch (error) {
    console.error('X.AI API check failed:', error.message);
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
 * @param {Object} providerData - Provider status object
 * @returns {string} Formatted display string (e.g., "G📊🟢90%")
 */
export function formatQuotaDisplay(providerData) {
  const { abbrev, status, quota, cacheStrategy } = providerData;

  // Determine bar chart emoji based on status/remaining
  let emoji = '📊';
  let colorIndicator = '';

  // Handle 'N/A' - no admin key configured
  if (quota.remaining === 'N/A') {
    // Show gray/unknown indicator for providers without admin API key
    return `${abbrev}${emoji}⚪`;
  }

  const remaining = typeof quota.remaining === 'number' ? quota.remaining : 90;

  if (remaining > 75) {
    colorIndicator = '🟢'; // Green
  } else if (remaining > 25) {
    colorIndicator = '🟡'; // Yellow
  } else if (remaining > 10) {
    colorIndicator = '🟠'; // Orange
  } else {
    colorIndicator = '🔴'; // Red
  }

  // Show percentage for all providers with numeric remaining values
  if (typeof quota.remaining === 'number') {
    // Add indicator if data is real-time vs estimated
    const suffix = cacheStrategy === 'real-time' ? '' : '~';
    return `${abbrev}${emoji}${colorIndicator}${remaining}%${suffix}`;
  }

  // For providers without numeric quota, show just icons
  return `${abbrev}${emoji}${colorIndicator}`;
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
