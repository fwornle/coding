/**
 * BudgetTracker
 *
 * Tracks LLM API costs in real-time and enforces configurable budget limits.
 * Integrates with DuckDB for cost persistence and analytics.
 *
 * Key Features:
 * - Real-time cost tracking in DuckDB budget_events table
 * - Configurable monthly budget limits ($100/year default = $8.33/month)
 * - Cost estimation before API calls using token counting
 * - Alerts at 80% threshold
 * - Cost analytics by project/provider/operation
 * - Automatic fallback to local models when budget exceeded
 */

import { EventEmitter } from 'events';
import { encode } from 'gpt-tokenizer'; // For token estimation
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Pricing per 1M tokens (input + output averaged)
const PRICING = {
  groq: {
    'llama-3.3-70b-versatile': 0.59 / 1000000, // $0.59 per 1M tokens
    'qwen-2.5-32b-instruct': 0.40 / 1000000,   // $0.40 per 1M tokens
    'default': 0.50 / 1000000
  },
  anthropic: {
    'claude-3-haiku-20240307': 1.00 / 1000000,  // $1.00 per 1M tokens
    'default': 1.00 / 1000000
  },
  openai: {
    'gpt-4o-mini': 0.30 / 1000000,              // $0.30 per 1M tokens
    'default': 0.30 / 1000000
  },
  gemini: {
    'gemini-1.5-flash': 0.15 / 1000000,         // $0.15 per 1M tokens
    'default': 0.15 / 1000000
  },
  local: {
    'default': 0 // Local models are free
  }
};

export class BudgetTracker extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Budget limits (configurable per-developer, per-project)
    // Default: $100/year = $8.33/month
    this.monthlyLimit = config.monthlyLimit || 8.33;
    this.yearlyLimit = config.yearlyLimit || 100.00;

    // Alert thresholds
    this.alertThresholds = config.alertThresholds || [0.5, 0.8, 0.9]; // 50%, 80%, 90%
    this.alertedAt = new Set(); // Track which thresholds we've alerted at

    // In-memory cache of current month's usage
    // Will be loaded from DuckDB on initialize
    this.currentMonthUsage = 0;
    this.currentMonth = this.getCurrentMonth();

    // DuckDB connection (will be initialized later)
    this.db = null;

    // File persistence for cost summary
    this._flushTimer = null;
    this._flushDebounceMs = 30000; // Max once per 30s
    this._costFilePath = this._resolveCostFilePath();

    // Stats
    this.stats = {
      totalCost: 0,
      totalTokens: 0,
      byProvider: {},
      byProject: {},
      byOperationType: {},
      estimations: 0,
      recordings: 0
    };
  }

  /**
   * Initialize budget tracker
   * Loads DuckDB connection and current month's usage
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    // Load persisted cost data from disk (survives Docker restarts)
    this._loadPersistedCosts();

    // Load DuckDB (will be implemented when DatabaseManager is ready)
    await this.initializeDuckDB();

    // Load current month's usage from database
    await this.loadCurrentMonthUsage();

    this.initialized = true;
    this.emit('initialized', { monthlyLimit: this.monthlyLimit, currentUsage: this.currentMonthUsage });
    console.log('[BudgetTracker] Initialized - Monthly limit: $' + this.monthlyLimit.toFixed(2) + ', Current usage: $' + this.currentMonthUsage.toFixed(4));
  }

  /**
   * Initialize DuckDB connection
   * Placeholder - will be replaced when DatabaseManager is implemented
   */
  async initializeDuckDB() {
    try {
      // Temporary: Use in-memory storage until DatabaseManager is ready
      // TODO: Replace with actual DuckDB connection via DatabaseManager
      this.db = {
        query: async () => ({ rows: [] }),
        execute: async () => ({ changes: 1 })
      };
      console.log('[BudgetTracker] Using in-memory storage (DuckDB pending)');
    } catch (error) {
      console.warn('[BudgetTracker] Failed to initialize DuckDB:', error);
      // Continue with in-memory only
    }
  }

  /**
   * Load current month's usage from DuckDB
   */
  async loadCurrentMonthUsage() {
    if (!this.db) {
      return;
    }

    try {
      const currentMonth = this.getCurrentMonth();
      const query = `
        SELECT SUM(cost_usd) as total_cost
        FROM budget_events
        WHERE strftime('%Y-%m', timestamp) = '${currentMonth}'
      `;

      const result = await this.db.query(query);

      if (result.rows && result.rows.length > 0 && result.rows[0].total_cost) {
        this.currentMonthUsage = parseFloat(result.rows[0].total_cost);
      }

      console.log('[BudgetTracker] Loaded current month usage: $' + this.currentMonthUsage.toFixed(4));
    } catch (error) {
      console.warn('[BudgetTracker] Failed to load current month usage:', error);
    }
  }

  /**
   * Estimate tokens in a prompt
   * Uses gpt-tokenizer for consistent estimation across providers
   */
  estimateTokens(prompt) {
    try {
      // Encode prompt to tokens
      const tokens = encode(prompt);

      // Add estimated response tokens (assume ~50% of prompt length as response)
      const estimatedResponseTokens = Math.ceil(tokens.length * 0.5);

      return tokens.length + estimatedResponseTokens;
    } catch (error) {
      console.warn('[BudgetTracker] Token estimation failed:', error);
      // Fallback: rough estimate (1 token ≈ 4 characters)
      return Math.ceil(prompt.length / 4) * 1.5;
    }
  }

  /**
   * Estimate cost for a prompt
   *
   * @param {string} prompt - The prompt to estimate
   * @param {string} provider - Provider name (groq, anthropic, openai, etc.)
   * @param {string} model - Model name
   * @returns {number} Estimated cost in USD
   */
  estimateCost(prompt, provider = 'groq', model = 'default') {
    this.stats.estimations++;

    const tokens = this.estimateTokens(prompt);

    // Get pricing for provider/model
    const providerPricing = PRICING[provider] || PRICING.groq;
    const pricePerToken = providerPricing[model] || providerPricing.default;

    const cost = tokens * pricePerToken;

    this.emit('cost-estimated', { provider, model, tokens, cost });

    return cost;
  }

  /**
   * Check if we can afford this inference
   *
   * @param {string} prompt - The prompt to check
   * @param {object} context - Additional context (provider, model, etc.)
   * @returns {Promise<boolean>} True if we can afford this inference
   */
  async canAfford(prompt, context = {}) {
    // Check if month rolled over
    await this.checkMonthRollover();

    const provider = context.provider || 'groq';
    const model = context.model || 'default';

    // Estimate cost
    const estimatedCost = this.estimateCost(prompt, provider, model);

    // Check if adding this cost would exceed monthly limit
    const projectedUsage = this.currentMonthUsage + estimatedCost;

    if (projectedUsage > this.monthlyLimit) {
      this.emit('budget-exceeded', {
        currentUsage: this.currentMonthUsage,
        estimatedCost,
        projectedUsage,
        monthlyLimit: this.monthlyLimit
      });
      console.warn(`[BudgetTracker] Budget would be exceeded: $${projectedUsage.toFixed(4)} > $${this.monthlyLimit.toFixed(2)}`);
      return false;
    }

    // Check alert thresholds
    const usagePercentage = projectedUsage / this.monthlyLimit;
    for (const threshold of this.alertThresholds) {
      if (usagePercentage >= threshold && !this.alertedAt.has(threshold)) {
        this.alertedAt.add(threshold);
        this.emit('budget-alert', {
          threshold: threshold * 100,
          currentUsage: this.currentMonthUsage,
          projectedUsage,
          monthlyLimit: this.monthlyLimit
        });
        console.warn(`[BudgetTracker] Budget alert: ${(threshold * 100).toFixed(0)}% of monthly limit ($${projectedUsage.toFixed(4)}/$${this.monthlyLimit.toFixed(2)})`);
      }
    }

    return true;
  }

  /**
   * Record actual cost after inference
   *
   * @param {number} tokens - Actual tokens used
   * @param {string} provider - Provider name
   * @param {object} metadata - Additional metadata (operationType, model, project, etc.)
   */
  async recordCost(tokens, provider, metadata = {}) {
    this.stats.recordings++;

    // Check if month rolled over
    await this.checkMonthRollover();

    const model = metadata.model || 'default';
    const operationType = metadata.operationType || 'unknown';
    const project = metadata.project || 'unknown';

    // Calculate actual cost
    const providerPricing = PRICING[provider] || PRICING.groq;
    const pricePerToken = providerPricing[model] || providerPricing.default;
    const cost = tokens * pricePerToken;

    // Update in-memory stats
    this.currentMonthUsage += cost;
    this.stats.totalCost += cost;
    this.stats.totalTokens += tokens;

    // Update provider stats
    if (!this.stats.byProvider[provider]) {
      this.stats.byProvider[provider] = { cost: 0, tokens: 0, count: 0 };
    }
    this.stats.byProvider[provider].cost += cost;
    this.stats.byProvider[provider].tokens += tokens;
    this.stats.byProvider[provider].count++;

    // Update project stats
    if (!this.stats.byProject[project]) {
      this.stats.byProject[project] = { cost: 0, tokens: 0, count: 0 };
    }
    this.stats.byProject[project].cost += cost;
    this.stats.byProject[project].tokens += tokens;
    this.stats.byProject[project].count++;

    // Update operation type stats
    if (!this.stats.byOperationType[operationType]) {
      this.stats.byOperationType[operationType] = { cost: 0, tokens: 0, count: 0 };
    }
    this.stats.byOperationType[operationType].cost += cost;
    this.stats.byOperationType[operationType].tokens += tokens;
    this.stats.byOperationType[operationType].count++;

    // Schedule flush to disk (debounced, max once per 30s)
    this._scheduleFlush();

    // Persist to DuckDB
    await this.persistCostEvent({
      tokens,
      cost,
      provider,
      model,
      operationType,
      project,
      metadata
    });

    this.emit('cost-recorded', {
      tokens,
      cost,
      provider,
      model,
      operationType,
      currentMonthUsage: this.currentMonthUsage,
      monthlyLimit: this.monthlyLimit
    });

    console.log(`[BudgetTracker] Recorded $${cost.toFixed(6)} (${tokens} tokens) - Monthly usage: $${this.currentMonthUsage.toFixed(4)}/$${this.monthlyLimit.toFixed(2)}`);
  }

  /**
   * Persist cost event to DuckDB
   */
  async persistCostEvent(event) {
    if (!this.db) {
      return;
    }

    try {
      const query = `
        INSERT INTO budget_events (
          id, timestamp, operation_type, provider, tokens_used, cost_usd, project, metadata
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?
        )
      `;

      const id = this.generateId();
      const timestamp = new Date().toISOString();
      const metadata = JSON.stringify(event.metadata || {});

      await this.db.execute(query, [
        id,
        timestamp,
        event.operationType,
        event.provider,
        event.tokens,
        event.cost,
        event.project,
        metadata
      ]);
    } catch (error) {
      console.warn('[BudgetTracker] Failed to persist cost event:', error);
      // Don't throw - in-memory tracking still works
    }
  }

  /**
   * Check if month rolled over and reset if needed
   */
  async checkMonthRollover() {
    const currentMonth = this.getCurrentMonth();

    if (currentMonth !== this.currentMonth) {
      console.log(`[BudgetTracker] Month rolled over: ${this.currentMonth} → ${currentMonth}`);

      // Reset monthly usage
      this.currentMonth = currentMonth;
      this.currentMonthUsage = 0;
      this.alertedAt.clear();

      // Reset per-provider stats for new month
      this.stats.byProvider = {};
      this.stats.totalCost = 0;
      this.stats.totalTokens = 0;

      // Flush reset to disk
      this._flushCostSummary();

      // Reload from database (in case of restart)
      await this.loadCurrentMonthUsage();

      this.emit('month-rollover', { newMonth: currentMonth, usage: this.currentMonthUsage });
    }
  }

  /**
   * Resolve path to .data/llm-usage-costs.json
   */
  _resolveCostFilePath() {
    const repoRoot = process.env.CODING_REPO
      || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    return path.join(repoRoot, '.data', 'llm-usage-costs.json');
  }

  /**
   * Load persisted cost data from disk on startup
   */
  _loadPersistedCosts() {
    try {
      if (!fs.existsSync(this._costFilePath)) return;
      const data = JSON.parse(fs.readFileSync(this._costFilePath, 'utf8'));
      const currentMonthAbbrev = this._getCurrentMonthAbbrev();

      // Only restore if same billing month
      if (data.billingMonth !== currentMonthAbbrev) return;

      // Restore per-provider stats
      if (data.providers) {
        for (const [provider, stats] of Object.entries(data.providers)) {
          if (!this.stats.byProvider[provider]) {
            this.stats.byProvider[provider] = { cost: 0, tokens: 0, count: 0 };
          }
          this.stats.byProvider[provider].cost = stats.cost || 0;
          this.stats.byProvider[provider].tokens = stats.tokens || 0;
          this.stats.byProvider[provider].count = stats.count || 0;
        }
        // Recalculate totals from restored providers
        this.stats.totalCost = Object.values(this.stats.byProvider)
          .reduce((sum, p) => sum + p.cost, 0);
        this.stats.totalTokens = Object.values(this.stats.byProvider)
          .reduce((sum, p) => sum + p.tokens, 0);
      }

      process.stdout.write(`[BudgetTracker] Restored costs from disk: $${this.stats.totalCost.toFixed(4)}\n`);
    } catch (error) {
      console.warn('[BudgetTracker] Failed to load persisted costs:', error.message);
    }
  }

  /**
   * Get current month as 3-letter abbreviation (JAN, FEB, etc.)
   */
  _getCurrentMonthAbbrev() {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return months[new Date().getMonth()];
  }

  /**
   * Flush cost summary to disk (debounced)
   * Writes .data/llm-usage-costs.json atomically (write .tmp, rename)
   */
  _scheduleFlush() {
    if (this._flushTimer) return; // Already scheduled
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flushCostSummary();
    }, this._flushDebounceMs);
  }

  /**
   * Write cost summary to disk immediately
   */
  _flushCostSummary() {
    try {
      const dir = path.dirname(this._costFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        billingMonth: this._getCurrentMonthAbbrev(),
        lastUpdated: new Date().toISOString(),
        providers: {}
      };

      for (const [provider, stats] of Object.entries(this.stats.byProvider)) {
        data.providers[provider] = {
          cost: Math.round(stats.cost * 1000000) / 1000000, // 6 decimal places
          tokens: stats.tokens,
          count: stats.count
        };
      }

      // Atomic write: write to tmp, then rename
      const tmpPath = this._costFilePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
      fs.renameSync(tmpPath, this._costFilePath);
    } catch (error) {
      console.warn('[BudgetTracker] Failed to flush costs to disk:', error.message);
    }
  }

  /**
   * Get current month in YYYY-MM format
   */
  getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Generate unique ID for events
   */
  generateId() {
    return `budget_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get cost analytics
   */
  async getAnalytics(options = {}) {
    const startDate = options.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
    const endDate = options.endDate || new Date();
    const groupBy = options.groupBy || 'day'; // day, week, month

    if (!this.db) {
      // Return in-memory stats if DuckDB not available
      return {
        currentMonth: {
          usage: this.currentMonthUsage,
          limit: this.monthlyLimit,
          percentage: (this.currentMonthUsage / this.monthlyLimit) * 100,
          remaining: this.monthlyLimit - this.currentMonthUsage
        },
        byProvider: this.stats.byProvider,
        byProject: this.stats.byProject,
        byOperationType: this.stats.byOperationType,
        totalCost: this.stats.totalCost,
        totalTokens: this.stats.totalTokens
      };
    }

    try {
      // Query DuckDB for historical analytics
      const dateFormat = groupBy === 'day' ? '%Y-%m-%d' :
                        groupBy === 'week' ? '%Y-W%W' :
                        '%Y-%m';

      const query = `
        SELECT
          strftime('${dateFormat}', timestamp) as period,
          provider,
          SUM(cost_usd) as total_cost,
          SUM(tokens_used) as total_tokens,
          COUNT(*) as count
        FROM budget_events
        WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY period, provider
        ORDER BY period DESC
      `;

      const result = await this.db.query(query, [
        startDate.toISOString(),
        endDate.toISOString()
      ]);

      return {
        currentMonth: {
          usage: this.currentMonthUsage,
          limit: this.monthlyLimit,
          percentage: (this.currentMonthUsage / this.monthlyLimit) * 100,
          remaining: this.monthlyLimit - this.currentMonthUsage
        },
        historical: result.rows || [],
        byProvider: this.stats.byProvider,
        byProject: this.stats.byProject,
        byOperationType: this.stats.byOperationType,
        totalCost: this.stats.totalCost,
        totalTokens: this.stats.totalTokens
      };
    } catch (error) {
      console.warn('[BudgetTracker] Failed to get analytics:', error);
      return this.getAnalytics({ ...options, skipDB: true });
    }
  }

  /**
   * Get budget status
   */
  getStatus() {
    return {
      currentMonth: this.currentMonth,
      usage: this.currentMonthUsage,
      limit: this.monthlyLimit,
      percentage: (this.currentMonthUsage / this.monthlyLimit) * 100,
      remaining: this.monthlyLimit - this.currentMonthUsage,
      withinBudget: this.currentMonthUsage < this.monthlyLimit,
      alertThresholds: this.alertThresholds.map(t => ({
        threshold: t * 100,
        triggered: this.alertedAt.has(t)
      }))
    };
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      currentMonth: this.getStatus()
    };
  }
}

export default BudgetTracker;
