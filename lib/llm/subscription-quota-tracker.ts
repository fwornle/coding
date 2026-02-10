/**
 * Subscription Quota Tracker
 *
 * Tracks usage and quota exhaustion for subscription-based LLM providers
 * (Claude Code, GitHub Copilot). Implements optimistic tracking with
 * exponential backoff on quota exhaustion.
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { SubscriptionQuotaTrackerInterface } from './types.js';

interface HourlyUsage {
  hour: string; // ISO timestamp rounded to hour
  completions: number;
  estimatedTokens: number;
}

interface ProviderUsage {
  hourlyUsage: HourlyUsage[];
  quotaExhausted: boolean;
  exhaustedAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

interface SubscriptionUsageData {
  [provider: string]: ProviderUsage;
}

export class SubscriptionQuotaTracker implements SubscriptionQuotaTrackerInterface {
  private data: SubscriptionUsageData = {};
  private storagePath: string;
  private initialized = false;

  // Backoff schedule (in milliseconds)
  private readonly backoffSchedule = [
    5 * 60 * 1000,   // 5 minutes
    15 * 60 * 1000,  // 15 minutes
    60 * 60 * 1000,  // 1 hour
  ];

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  /**
   * Initialize the tracker by loading existing data
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const fileContent = await fs.readFile(this.storagePath, 'utf-8');
      this.data = JSON.parse(fileContent);
      this.initialized = true;

      // Prune old data on initialization
      await this.pruneOldData();
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - start fresh
        this.data = {};
        this.initialized = true;
      } else {
        console.warn('[quota-tracker] Failed to load data:', error.message);
        this.data = {};
        this.initialized = true;
      }
    }
  }

  /**
   * Get or create provider usage record
   */
  private getProviderData(provider: string): ProviderUsage {
    if (!this.data[provider]) {
      this.data[provider] = {
        hourlyUsage: [],
        quotaExhausted: false,
        exhaustedAt: null,
        lastError: null,
        consecutiveFailures: 0,
      };
    }
    return this.data[provider];
  }

  /**
   * Get current hour as ISO string (rounded to hour)
   */
  private getCurrentHour(): string {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return now.toISOString();
  }

  /**
   * Record usage for a provider
   */
  async recordUsage(provider: string, tokens: number): Promise<void> {
    if (!this.initialized) await this.initialize();

    const providerData = this.getProviderData(provider);
    const currentHour = this.getCurrentHour();

    // Find or create hourly usage record
    let hourRecord = providerData.hourlyUsage.find(h => h.hour === currentHour);
    if (!hourRecord) {
      hourRecord = {
        hour: currentHour,
        completions: 0,
        estimatedTokens: 0,
      };
      providerData.hourlyUsage.push(hourRecord);
    }

    // Update usage
    hourRecord.completions++;
    hourRecord.estimatedTokens += tokens;

    // Reset failure state on successful usage
    providerData.consecutiveFailures = 0;
    providerData.quotaExhausted = false;
    providerData.exhaustedAt = null;

    await this.persist();
  }

  /**
   * Check if provider is available (not quota exhausted)
   */
  async isAvailable(provider: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();

    const providerData = this.getProviderData(provider);

    // If not exhausted, available
    if (!providerData.quotaExhausted) {
      return true;
    }

    // Check if enough time has passed to retry
    if (this.canRetry(provider)) {
      // Reset exhaustion flag - allow retry
      providerData.quotaExhausted = false;
      providerData.exhaustedAt = null;
      await this.persist();
      return true;
    }

    return false;
  }

  /**
   * Get current hour's usage stats
   */
  getHourlyUsage(provider: string): { completions: number; tokens: number } {
    const providerData = this.getProviderData(provider);
    const currentHour = this.getCurrentHour();

    const hourRecord = providerData.hourlyUsage.find(h => h.hour === currentHour);

    return {
      completions: hourRecord?.completions || 0,
      tokens: hourRecord?.estimatedTokens || 0,
    };
  }

  /**
   * Mark provider as quota exhausted (with exponential backoff)
   */
  markQuotaExhausted(provider: string): void {
    const providerData = this.getProviderData(provider);

    providerData.quotaExhausted = true;
    providerData.exhaustedAt = new Date().toISOString();
    providerData.consecutiveFailures++;

    this.persist().catch(err => {
      console.warn('[quota-tracker] Failed to persist exhaustion state:', err);
    });
  }

  /**
   * Check if enough time has passed to retry
   */
  canRetry(provider: string): boolean {
    const providerData = this.getProviderData(provider);

    if (!providerData.exhaustedAt) {
      return true; // Never exhausted
    }

    const exhaustedAt = new Date(providerData.exhaustedAt).getTime();
    const now = Date.now();
    const elapsed = now - exhaustedAt;

    // Determine backoff duration based on consecutive failures
    const failureIndex = Math.min(
      providerData.consecutiveFailures - 1,
      this.backoffSchedule.length - 1
    );
    const backoffDuration = this.backoffSchedule[failureIndex] || this.backoffSchedule[this.backoffSchedule.length - 1];

    return elapsed >= backoffDuration;
  }

  /**
   * Clear old data (keep last 24 hours)
   */
  async pruneOldData(): Promise<void> {
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

    for (const provider in this.data) {
      const providerData = this.data[provider];

      // Filter out old hourly usage records
      providerData.hourlyUsage = providerData.hourlyUsage.filter(h => {
        const hourTime = new Date(h.hour).getTime();
        return hourTime >= cutoffTime;
      });
    }

    await this.persist();
  }

  /**
   * Persist data to disk
   */
  private async persist(): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(dirname(this.storagePath), { recursive: true });

      // Write file
      await fs.writeFile(
        this.storagePath,
        JSON.stringify(this.data, null, 2),
        'utf-8'
      );
    } catch (error: any) {
      console.warn('[quota-tracker] Failed to persist data:', error.message);
    }
  }

  /**
   * Get all usage data (for debugging/monitoring)
   */
  getAllUsage(): SubscriptionUsageData {
    return { ...this.data };
  }

  /**
   * Reset usage for a provider (for testing)
   */
  async resetProvider(provider: string): Promise<void> {
    if (!this.initialized) await this.initialize();

    delete this.data[provider];
    await this.persist();
  }
}
