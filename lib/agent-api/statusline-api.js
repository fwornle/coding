/**
 * Statusline API - Interface for agent status line providers
 *
 * Defines the contract for providing status line information
 * that can be displayed in tmux, CLI, or other interfaces.
 */

import { createLogger } from '../logging/Logger.js';

const logger = createLogger('statusline-api');

/**
 * @typedef {Object} StatusIndicator
 * @property {string} icon - Emoji or icon representing the status
 * @property {'healthy'|'warning'|'error'|'offline'|'initializing'} status - Status level
 * @property {string} [label] - Optional label for the indicator
 * @property {string} [tooltip] - Detailed tooltip text
 */

/**
 * @typedef {Object} StatusData
 * @property {string} text - Formatted status text for display
 * @property {'green'|'yellow'|'red'} color - Overall status color
 * @property {Object.<string, StatusIndicator>} indicators - Named status indicators
 * @property {Object} health - Health status object
 * @property {number} timestamp - Status timestamp
 */

/**
 * @typedef {Object} StatuslineConfig
 * @property {number} [cacheTimeout=5000] - Cache timeout in milliseconds
 * @property {number} [apiCheckInterval=30000] - API check interval in milliseconds
 * @property {boolean} [enableTooltips=false] - Enable tooltip generation
 * @property {string} [format='default'] - Output format (default, compact, verbose)
 */

/**
 * Abstract base class for status line providers
 * Implement this class to provide agent-specific status line functionality
 */
class StatuslineProvider {
  /**
   * @param {StatuslineConfig} config - Provider configuration
   */
  constructor(config = {}) {
    if (new.target === StatuslineProvider) {
      throw new Error('StatuslineProvider is abstract and cannot be instantiated directly');
    }

    this.config = {
      cacheTimeout: 5000,
      apiCheckInterval: 30000,
      enableTooltips: false,
      format: 'default',
      ...config
    };

    this.statusCache = null;
    this.lastUpdate = 0;
  }

  // ============================================
  // Abstract Methods - MUST be implemented
  // ============================================

  /**
   * Get the current status data
   * @returns {Promise<StatusData>}
   * @abstract
   */
  async getStatus() {
    throw new Error('getStatus() must be implemented by subclass');
  }

  /**
   * Format status for tmux status line
   * @param {StatusData} [statusData] - Optional pre-fetched status data
   * @returns {Promise<string>}
   * @abstract
   */
  async formatForTmux(statusData) {
    throw new Error('formatForTmux() must be implemented by subclass');
  }

  /**
   * Format status for CLI output
   * @param {StatusData} [statusData] - Optional pre-fetched status data
   * @returns {Promise<string>}
   * @abstract
   */
  async formatForCLI(statusData) {
    throw new Error('formatForCLI() must be implemented by subclass');
  }

  // ============================================
  // Optional Methods - CAN be overridden
  // ============================================

  /**
   * Get cached status or fetch new if cache expired
   * @returns {Promise<StatusData>}
   */
  async getCachedStatus() {
    const now = Date.now();

    if (this.statusCache && (now - this.lastUpdate) < this.config.cacheTimeout) {
      return this.statusCache;
    }

    try {
      this.statusCache = await this.getStatus();
      this.lastUpdate = now;
      return this.statusCache;
    } catch (error) {
      logger.error('Failed to get status', { error: error.message });
      return this.getErrorStatus(error);
    }
  }

  /**
   * Generate an error status object
   * @param {Error} error - The error that occurred
   * @returns {StatusData}
   */
  getErrorStatus(error) {
    return {
      text: '⚠️ SYS:ERR',
      color: 'red',
      indicators: {
        system: {
          icon: '❌',
          status: 'error',
          tooltip: error.message
        }
      },
      health: { status: 'error', error: error.message },
      timestamp: Date.now()
    };
  }

  /**
   * Invalidate the status cache
   */
  invalidateCache() {
    this.statusCache = null;
    this.lastUpdate = 0;
  }

  /**
   * Generate tooltip text for the status
   * @param {StatusData} statusData - Status data
   * @returns {string}
   */
  generateTooltip(statusData) {
    if (!statusData || !statusData.indicators) {
      return 'Status unavailable';
    }

    const lines = ['⚙️ System Status'];

    for (const [name, indicator] of Object.entries(statusData.indicators)) {
      const statusEmoji = indicator.status === 'healthy' ? '✅' :
                          indicator.status === 'warning' ? '⚠️' :
                          indicator.status === 'error' ? '❌' :
                          indicator.status === 'offline' ? '💤' : '🔄';

      lines.push(`${statusEmoji} ${name}: ${indicator.label || indicator.status}`);

      if (indicator.tooltip) {
        lines.push(`   ${indicator.tooltip}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a status indicator for display
   * @param {StatusIndicator} indicator - Indicator to format
   * @param {'compact'|'full'} format - Format style
   * @returns {string}
   */
  formatIndicator(indicator, format = 'compact') {
    if (format === 'compact') {
      return indicator.icon;
    }

    return `${indicator.icon}${indicator.label ? ` ${indicator.label}` : ''}`;
  }
}

/**
 * Factory function to create a status line provider for a specific agent
 * @param {string} agentType - Agent type ('claude', 'copilot', etc.)
 * @param {StatuslineConfig} config - Provider configuration
 * @returns {Promise<StatuslineProvider>}
 */
async function createStatuslineProvider(agentType, config = {}) {
  switch (agentType) {
    case 'claude':
      const { ClaudeStatuslineProvider } = await import('./adapters/claude-adapter.js');
      return new ClaudeStatuslineProvider(config);

    case 'copilot':
      const { CopilotStatuslineProvider } = await import('./adapters/copilot-adapter.js');
      return new CopilotStatuslineProvider(config);

    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

export { StatuslineProvider, createStatuslineProvider };
export default StatuslineProvider;
