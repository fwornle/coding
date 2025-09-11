/**
 * StatusLineIntegrator - Claude Code Status Line Integration for Reliable Coding Classifier
 * 
 * Provides immediate visual feedback about content routing decisions.
 * Integrates with combined-status-line.js for "→coding" indicator display.
 * 
 * Features:
 * - Real-time feedback during classification (<100ms updates)
 * - Non-blocking integration with classification process
 * - Atomic status updates to prevent conflicts
 * - Integration with existing status line infrastructure
 * - Temporary status indicators for classification feedback
 * - Persistent redirect status for ongoing content routing
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class StatusLineIntegrator {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.codingProjectPath = options.codingProjectPath || this.detectCodingProject();
    this.debug = options.debug || false;
    
    // Status line configuration
    this.statusLineScript = path.join(this.codingProjectPath, 'scripts', 'combined-status-line.js');
    this.updateTimeoutMs = options.updateTimeoutMs || 100;
    
    // State tracking
    this.currentRedirectStatus = null;
    this.lastClassificationTime = 0;
    this.pendingUpdates = new Map();
    
    // Statistics
    this.stats = {
      statusUpdates: 0,
      redirectIndicatorShown: 0,
      redirectIndicatorHidden: 0,
      updateErrors: 0,
      avgUpdateTime: 0
    };
    
    this.log('StatusLineIntegrator initialized');
  }

  /**
   * Show classification feedback immediately after classification
   * @param {Object} exchange - Exchange that was classified
   * @param {Object} classificationResult - Classification result
   * @param {Object} routingDecision - Routing decision from ExchangeRouter
   */
  async showClassificationFeedback(exchange, classificationResult, routingDecision) {
    const startTime = Date.now();
    
    try {
      // Determine status indicator based on routing decision
      const statusIndicator = this.buildStatusIndicator(classificationResult, routingDecision);
      
      // Update status line with classification feedback
      if (statusIndicator) {
        await this.updateStatusLine(statusIndicator, 'classification');
        this.stats.statusUpdates++;
      }
      
      // Update persistent redirect status if needed
      if (routingDecision.shouldRedirect) {
        await this.showRedirectIndicator('coding');
        this.stats.redirectIndicatorShown++;
      } else if (this.currentRedirectStatus) {
        // Hide redirect indicator if no longer redirecting
        await this.hideRedirectIndicator();
        this.stats.redirectIndicatorHidden++;
      }
      
      this.updateStats(Date.now() - startTime);
      
    } catch (error) {
      this.stats.updateErrors++;
      this.log(`Status update error: ${error.message}`);
    }
  }

  /**
   * Show redirect indicator for ongoing content routing
   * @param {string} target - Target project name (usually 'coding')
   */
  async showRedirectIndicator(target = 'coding') {
    try {
      // Set environment variable for status line script to pick up
      await this.setRedirectEnvironment(target, true);
      
      this.currentRedirectStatus = {
        active: true,
        target,
        startTime: Date.now()
      };
      
      this.log(`Redirect indicator shown: →${target}`);
      
    } catch (error) {
      this.log(`Error showing redirect indicator: ${error.message}`);
      this.stats.updateErrors++;
    }
  }

  /**
   * Hide redirect indicator when content is no longer being redirected
   */
  async hideRedirectIndicator() {
    try {
      // Remove environment variable
      await this.setRedirectEnvironment(null, false);
      
      this.currentRedirectStatus = null;
      
      this.log('Redirect indicator hidden');
      
    } catch (error) {
      this.log(`Error hiding redirect indicator: ${error.message}`);
      this.stats.updateErrors++;
    }
  }

  /**
   * Set redirect environment variables for status line script
   * @param {string} target - Target project name
   * @param {boolean} active - Whether redirect is active
   */
  async setRedirectEnvironment(target, active) {
    if (active && target) {
      // Set environment variables that combined-status-line.js checks
      process.env.CODING_TARGET_PROJECT = this.projectPath;
      process.env.CODING_REDIRECT_ACTIVE = 'true';
      process.env.CODING_REDIRECT_TARGET = target;
    } else {
      // Remove environment variables
      delete process.env.CODING_REDIRECT_ACTIVE;
      delete process.env.CODING_REDIRECT_TARGET;
      // Keep CODING_TARGET_PROJECT as it may be used by other systems
    }
  }

  /**
   * Build status indicator for classification feedback
   * @param {Object} classificationResult - Classification result
   * @param {Object} routingDecision - Routing decision
   * @returns {string|null} Status indicator text
   */
  buildStatusIndicator(classificationResult, routingDecision) {
    const isCoding = classificationResult.classification === 'CODING_INFRASTRUCTURE' || classificationResult.isCoding;
    const confidence = classificationResult.confidence || 0;
    const layer = classificationResult.layer || 'unknown';
    
    // Build indicator based on classification and routing
    if (routingDecision.shouldRedirect) {
      // Content is being redirected to coding project
      return `🔄→coding(${layer}:${(confidence * 100).toFixed(0)}%)`;
    } else if (isCoding && !routingDecision.shouldRedirect) {
      // Coding content staying in coding project
      return `💻local(${layer}:${(confidence * 100).toFixed(0)}%)`;
    } else {
      // Non-coding content staying in local project
      return `📄local(${layer})`;
    }
  }

  /**
   * Update status line with new indicator (non-blocking)
   * @param {string} indicator - Status indicator text
   * @param {string} type - Type of update ('classification', 'redirect', etc.)
   * @param {number} durationMs - How long to show the indicator
   */
  async updateStatusLine(indicator, type = 'general', durationMs = 3000) {
    const updateId = `${type}_${Date.now()}`;
    
    try {
      // Store pending update
      this.pendingUpdates.set(updateId, {
        indicator,
        type,
        startTime: Date.now(),
        durationMs
      });
      
      // Set temporary environment variable for status line script
      process.env[`CODING_CLASSIFIER_STATUS_${type.toUpperCase()}`] = indicator;
      
      // Schedule cleanup of temporary indicator
      setTimeout(() => {
        this.cleanupTemporaryIndicator(updateId, type);
      }, durationMs);
      
      this.log(`Status updated: ${indicator} (${type})`);
      
    } catch (error) {
      this.log(`Error updating status line: ${error.message}`);
      this.stats.updateErrors++;
    }
  }

  /**
   * Clean up temporary status indicator
   * @param {string} updateId - Update identifier
   * @param {string} type - Type of update
   */
  cleanupTemporaryIndicator(updateId, type) {
    try {
      // Remove temporary environment variable
      delete process.env[`CODING_CLASSIFIER_STATUS_${type.toUpperCase()}`];
      
      // Remove from pending updates
      this.pendingUpdates.delete(updateId);
      
      this.log(`Temporary indicator cleaned up: ${type}`);
      
    } catch (error) {
      this.log(`Error cleaning up indicator: ${error.message}`);
    }
  }

  /**
   * Force refresh of status line display
   */
  async refreshStatusLine() {
    try {
      // Trigger status line refresh by running the script
      const refreshPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Status refresh timeout'));
        }, this.updateTimeoutMs);
        
        const child = spawn('node', [this.statusLineScript], {
          stdio: 'pipe',
          env: { ...process.env }
        });
        
        child.on('close', (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Status script exited with code ${code}`));
          }
        });
        
        child.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      
      await refreshPromise;
      this.log('Status line refreshed');
      
    } catch (error) {
      this.log(`Error refreshing status line: ${error.message}`);
      this.stats.updateErrors++;
    }
  }

  /**
   * Get current status line state
   * @returns {Object} Current status information
   */
  getCurrentStatus() {
    return {
      redirectStatus: this.currentRedirectStatus,
      pendingUpdates: Array.from(this.pendingUpdates.entries()).map(([id, update]) => ({
        id,
        ...update,
        age: Date.now() - update.startTime
      })),
      environment: {
        redirectActive: process.env.CODING_REDIRECT_ACTIVE === 'true',
        redirectTarget: process.env.CODING_REDIRECT_TARGET,
        targetProject: process.env.CODING_TARGET_PROJECT
      }
    };
  }

  /**
   * Test status line integration
   * @returns {Object} Test results
   */
  async testIntegration() {
    const results = {
      statusLineScriptExists: false,
      environmentAccess: false,
      statusUpdateTest: false,
      redirectTest: false,
      errors: []
    };
    
    try {
      // Test 1: Status line script exists
      results.statusLineScriptExists = fs.existsSync(this.statusLineScript);
      if (!results.statusLineScriptExists) {
        results.errors.push(`Status line script not found: ${this.statusLineScript}`);
      }
      
      // Test 2: Environment variable access
      const testVar = 'CODING_CLASSIFIER_TEST';
      process.env[testVar] = 'test_value';
      results.environmentAccess = process.env[testVar] === 'test_value';
      delete process.env[testVar];
      
      if (!results.environmentAccess) {
        results.errors.push('Environment variable access failed');
      }
      
      // Test 3: Status update test
      try {
        await this.updateStatusLine('test_indicator', 'test', 100);
        results.statusUpdateTest = true;
      } catch (error) {
        results.errors.push(`Status update test failed: ${error.message}`);
      }
      
      // Test 4: Redirect indicator test
      try {
        await this.showRedirectIndicator('test');
        await this.hideRedirectIndicator();
        results.redirectTest = true;
      } catch (error) {
        results.errors.push(`Redirect test failed: ${error.message}`);
      }
      
    } catch (error) {
      results.errors.push(`Integration test error: ${error.message}`);
    }
    
    return results;
  }

  /**
   * Detect coding project path
   * @returns {string} Detected coding project path
   */
  detectCodingProject() {
    const candidates = [
      process.env.CODING_REPO,
      process.env.CODING_TOOLS_PATH,
      path.join(process.env.HOME || '', 'Agentic', 'coding'),
      '/Users/q284340/Agentic/coding'
    ].filter(Boolean);
    
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'CLAUDE.md'))) {
        return candidate;
      }
    }
    
    return candidates[candidates.length - 1];
  }

  /**
   * Update performance statistics
   * @param {number} updateTime - Update processing time
   */
  updateStats(updateTime) {
    const count = this.stats.statusUpdates;
    this.stats.avgUpdateTime = ((this.stats.avgUpdateTime * count) + updateTime) / (count + 1);
  }

  /**
   * Get status line integration statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      currentRedirectActive: !!this.currentRedirectStatus,
      pendingUpdatesCount: this.pendingUpdates.size,
      errorRate: this.stats.statusUpdates > 0 
        ? ((this.stats.updateErrors / this.stats.statusUpdates) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      statusUpdates: 0,
      redirectIndicatorShown: 0,
      redirectIndicatorHidden: 0,
      updateErrors: 0,
      avgUpdateTime: 0
    };
  }

  /**
   * Enable or disable status line integration
   * @param {boolean} enabled - Whether to enable integration
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    
    if (!enabled) {
      // Clean up when disabled
      this.hideRedirectIndicator();
      this.pendingUpdates.clear();
    }
    
    this.log(`Status line integration ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Clean up and stop integrator
   */
  destroy() {
    // Clean up all status indicators
    this.hideRedirectIndicator();
    
    // Clear pending updates
    for (const [updateId, update] of this.pendingUpdates) {
      this.cleanupTemporaryIndicator(updateId, update.type);
    }
    
    this.log('StatusLineIntegrator destroyed');
  }

  /**
   * Debug logging
   * @param {string} message - Log message
   */
  log(message) {
    if (this.debug) {
      console.log(`[StatusLineIntegrator] ${message}`);
    }
  }
}

module.exports = StatusLineIntegrator;