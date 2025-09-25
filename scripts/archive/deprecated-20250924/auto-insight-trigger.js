#!/usr/bin/env node
/**
 * Auto Insight Trigger
 * 
 * Integrates with the post-session logger to automatically trigger
 * insight extraction when new sessions are detected.
 * 
 * This can be called:
 * 1. Manually after a coding session
 * 2. Automatically via post-session-logger.js
 * 3. Via cron job for periodic analysis
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { InsightOrchestrator } from './insight-orchestrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

// Configuration
const CODING_ROOT = path.join(__dirname, '..');
const TRIGGER_STATE_FILE = path.join(CODING_ROOT, 'tmp', 'insight-trigger-state.json');

class AutoInsightTrigger {
  constructor(options = {}) {
    this.config = {
      enabled: process.env.AUTO_INSIGHT_ENABLED !== 'false',
      significanceThreshold: parseInt(process.env.INSIGHT_SIGNIFICANCE_THRESHOLD) || 7,
      cooldownMinutes: parseInt(process.env.INSIGHT_COOLDOWN_MINUTES) || 30,
      maxConcurrentAnalysis: 1,
      ...options
    };
    
    this.logger = this.createLogger();
    this.state = {};
  }
  
  createLogger() {
    return {
      info: (msg) => console.log(`[${new Date().toISOString()}] TRIGGER INFO: ${msg}`),
      warn: (msg) => console.log(`[${new Date().toISOString()}] TRIGGER WARN: ${msg}`),
      error: (msg) => console.error(`[${new Date().toISOString()}] TRIGGER ERROR: ${msg}`),
      debug: (msg) => {
        if (process.env.DEBUG) {
          console.log(`[${new Date().toISOString()}] TRIGGER DEBUG: ${msg}`);
        }
      }
    };
  }
  
  /**
   * Load trigger state
   */
  async loadState() {
    try {
      const stateData = await fs.readFile(TRIGGER_STATE_FILE, 'utf8');
      this.state = JSON.parse(stateData);
    } catch (error) {
      this.state = {
        lastTriggered: null,
        runningAnalysis: false,
        totalRuns: 0,
        lastSuccessfulRun: null,
        errors: []
      };
    }
  }
  
  /**
   * Save trigger state
   */
  async saveState() {
    try {
      await fs.mkdir(path.dirname(TRIGGER_STATE_FILE), { recursive: true });
      await fs.writeFile(TRIGGER_STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (error) {
      this.logger.error(`Failed to save trigger state: ${error.message}`);
    }
  }
  
  /**
   * Check if analysis should be triggered
   */
  shouldTrigger() {
    if (!this.config.enabled) {
      this.logger.debug('Auto insight triggering is disabled');
      return false;
    }
    
    if (this.state.runningAnalysis) {
      this.logger.debug('Analysis already running, skipping trigger');
      return false;
    }
    
    // Check cooldown period
    if (this.state.lastTriggered) {
      const timeSinceLastTrigger = Date.now() - new Date(this.state.lastTriggered).getTime();
      const cooldownMs = this.config.cooldownMinutes * 60 * 1000;
      
      if (timeSinceLastTrigger < cooldownMs) {
        this.logger.debug(`Cooldown period active (${Math.round((cooldownMs - timeSinceLastTrigger) / 60000)} minutes remaining)`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Main trigger method - check and run analysis if needed
   */
  async trigger(options = {}) {
    await this.loadState();
    
    if (!this.shouldTrigger()) {
      return { triggered: false, reason: 'Conditions not met' };
    }
    
    this.logger.info('Triggering automated insight analysis...');
    
    try {
      // Update state to indicate analysis is running
      this.state.runningAnalysis = true;
      this.state.lastTriggered = new Date().toISOString();
      await this.saveState();
      
      // Run the insight orchestrator
      const result = await this.runInsightOrchestrator(options);
      
      // Update state on success
      this.state.runningAnalysis = false;
      this.state.totalRuns += 1;
      this.state.lastSuccessfulRun = new Date().toISOString();
      await this.saveState();
      
      this.logger.info('Automated insight analysis completed successfully');
      return { triggered: true, result };
      
    } catch (error) {
      // Update state on error
      this.state.runningAnalysis = false;
      this.state.errors.push({
        timestamp: new Date().toISOString(),
        message: error.message
      });
      
      // Keep only last 5 errors
      if (this.state.errors.length > 5) {
        this.state.errors = this.state.errors.slice(-5);
      }
      
      await this.saveState();
      
      this.logger.error(`Automated insight analysis failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Run the insight orchestrator
   */
  async runInsightOrchestrator(options = {}) {
    const orchestrator = new InsightOrchestrator({
      significanceThreshold: options.significanceThreshold || this.config.significanceThreshold,
      webSearchEnabled: options.webSearchEnabled !== false,
      maxSessionsToAnalyze: options.maxSessionsToAnalyze || 5
    });
    
    await orchestrator.start();
    return { message: 'Insight orchestrator completed' };
  }
  
  /**
   * Check for new sessions and trigger if needed
   */
  async checkAndTrigger() {
    const hasNewSessions = await this.detectNewSessions();
    
    if (hasNewSessions) {
      return await this.trigger();
    }
    
    return { triggered: false, reason: 'No new sessions detected' };
  }
  
  /**
   * Detect if there are new sessions since last analysis
   */
  async detectNewSessions() {
    try {
      const specstoryPath = path.join(CODING_ROOT, '.specstory', 'history');
      
      // Check if specstory directory exists
      try {
        await fs.access(specstoryPath);
      } catch {
        this.logger.debug('No .specstory/history directory found');
        return false;
      }
      
      // Get latest session file
      const files = await fs.readdir(specstoryPath);
      const sessionFiles = files
        .filter(file => file.endsWith('.md'))
        .sort()
        .reverse();
      
      if (sessionFiles.length === 0) {
        this.logger.debug('No session files found');
        return false;
      }
      
      const latestFile = sessionFiles[0];
      const latestFilePath = path.join(specstoryPath, latestFile);
      const stats = await fs.stat(latestFilePath);
      
      // Check if the latest file is newer than our last successful run
      if (this.state.lastSuccessfulRun) {
        const lastRunTime = new Date(this.state.lastSuccessfulRun).getTime();
        if (stats.mtime.getTime() <= lastRunTime) {
          this.logger.debug('No new sessions since last analysis');
          return false;
        }
      }
      
      this.logger.debug(`New session detected: ${latestFile}`);
      return true;
      
    } catch (error) {
      this.logger.warn(`Failed to detect new sessions: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get current status
   */
  async getStatus() {
    await this.loadState();
    
    return {
      enabled: this.config.enabled,
      runningAnalysis: this.state.runningAnalysis,
      lastTriggered: this.state.lastTriggered,
      lastSuccessfulRun: this.state.lastSuccessfulRun,
      totalRuns: this.state.totalRuns,
      recentErrors: this.state.errors.slice(-3),
      cooldownMinutes: this.config.cooldownMinutes,
      significanceThreshold: this.config.significanceThreshold
    };
  }
  
  /**
   * Force trigger (bypass cooldown and conditions)
   */
  async forceTrigger(options = {}) {
    this.logger.info('Force triggering insight analysis...');
    
    await this.loadState();
    
    // Check if already running
    if (this.state.runningAnalysis) {
      throw new Error('Analysis is already running');
    }
    
    // Temporarily bypass conditions
    const originalEnabled = this.config.enabled;
    this.config.enabled = true;
    
    try {
      const result = await this.trigger(options);
      return result;
    } finally {
      this.config.enabled = originalEnabled;
    }
  }
  
  /**
   * Integration hook for post-session logger
   */
  static async onSessionCompleted(sessionInfo = {}) {
    const trigger = new AutoInsightTrigger();
    
    try {
      // Small delay to ensure session file is fully written
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const result = await trigger.checkAndTrigger();
      
      if (result.triggered) {
        console.log('🧠 Automated insight analysis triggered after session completion');
      }
      
      return result;
    } catch (error) {
      console.error('Failed to trigger insight analysis:', error.message);
      return { triggered: false, error: error.message };
    }
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  const trigger = new AutoInsightTrigger();
  
  switch (command) {
    case 'check':
      trigger.checkAndTrigger().then(result => {
        console.log('Check result:', result);
        process.exit(result.triggered ? 0 : 1);
      }).catch(error => {
        console.error('Check failed:', error);
        process.exit(1);
      });
      break;
      
    case 'force':
      trigger.forceTrigger().then(result => {
        console.log('Force trigger result:', result);
        process.exit(0);
      }).catch(error => {
        console.error('Force trigger failed:', error);
        process.exit(1);
      });
      break;
      
    case 'status':
      trigger.getStatus().then(status => {
        console.log('Trigger status:', JSON.stringify(status, null, 2));
        process.exit(0);
      }).catch(error => {
        console.error('Status check failed:', error);
        process.exit(1);
      });
      break;
      
    default:
      console.log(`
Usage: auto-insight-trigger.js [command]

Commands:
  check   - Check for new sessions and trigger if needed
  force   - Force trigger analysis (bypass cooldown)
  status  - Show current trigger status
  
Environment Variables:
  AUTO_INSIGHT_ENABLED=true|false         (default: true)
  INSIGHT_SIGNIFICANCE_THRESHOLD=1-10     (default: 7)
  INSIGHT_COOLDOWN_MINUTES=number         (default: 30)
  DEBUG=true                              (enable debug logging)
`);
      process.exit(0);
  }
}

export { AutoInsightTrigger };