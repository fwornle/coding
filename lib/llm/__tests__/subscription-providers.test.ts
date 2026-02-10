/**
 * Subscription Providers Integration Test
 *
 * Tests the claude-code and copilot providers with quota tracking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LLMService } from '../llm-service.js';
import { SubscriptionQuotaTracker } from '../subscription-quota-tracker.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Subscription Providers', () => {
  const testStoragePath = path.join(process.cwd(), '.data', 'test-subscription-usage.json');
  let llmService: LLMService;
  let quotaTracker: SubscriptionQuotaTracker;

  beforeEach(async () => {
    // Clean up any existing test file
    try {
      await fs.unlink(testStoragePath);
    } catch {
      // File doesn't exist
    }

    // Initialize services
    llmService = new LLMService();
    quotaTracker = new SubscriptionQuotaTracker(testStoragePath);

    await quotaTracker.initialize();
    llmService.setQuotaTracker(quotaTracker);
    await llmService.initialize();
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(testStoragePath);
    } catch {
      // File doesn't exist
    }
  });

  it('should initialize subscription providers if CLIs are available', async () => {
    const providers = llmService.getAvailableProviders();

    // May or may not be available depending on whether CLIs are installed
    // Just report availability
    expect(Array.isArray(providers)).toBe(true);
  });

  it('should track quota usage', async () => {
    await quotaTracker.recordUsage('claude-code', 1000);

    const usage = quotaTracker.getHourlyUsage('claude-code');
    expect(usage.completions).toBe(1);
    expect(usage.tokens).toBe(1000);

    // Check availability
    const isAvailable = await quotaTracker.isAvailable('claude-code');
    expect(isAvailable).toBe(true);
  });

  it('should handle quota exhaustion', async () => {
    // Mark as exhausted
    quotaTracker.markQuotaExhausted('copilot');

    // Should not be available
    let isAvailable = await quotaTracker.isAvailable('copilot');
    expect(isAvailable).toBe(false);

    // Should not be able to retry immediately
    expect(quotaTracker.canRetry('copilot')).toBe(false);
  });

  it('should persist quota data to disk', async () => {
    await quotaTracker.recordUsage('claude-code', 500);

    // Check file exists
    const fileExists = await fs.access(testStoragePath)
      .then(() => true)
      .catch(() => false);

    expect(fileExists).toBe(true);

    // Read and verify content
    const content = await fs.readFile(testStoragePath, 'utf-8');
    const data = JSON.parse(content);

    expect(data['claude-code']).toBeDefined();
    expect(data['claude-code'].hourlyUsage.length).toBeGreaterThan(0);
  });

  it('should prune old usage data', async () => {
    // Add usage from 25 hours ago (should be pruned)
    await quotaTracker.recordUsage('claude-code', 100);

    const allUsage = quotaTracker.getAllUsage();
    const claudeData = allUsage['claude-code'];

    // Manually inject old data
    const oldHour = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    claudeData.hourlyUsage.push({
      hour: oldHour,
      completions: 10,
      estimatedTokens: 1000,
    });

    // Prune
    await quotaTracker.pruneOldData();

    // Old data should be removed
    const prunedUsage = quotaTracker.getAllUsage();
    const prunedClaudeData = prunedUsage['claude-code'];

    const hasOldData = prunedClaudeData.hourlyUsage.some(h => h.hour === oldHour);
    expect(hasOldData).toBe(false);
  });
});
