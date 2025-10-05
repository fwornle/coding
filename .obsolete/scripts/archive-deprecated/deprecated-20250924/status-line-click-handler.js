#!/usr/bin/env node

/**
 * Claude Code Status Line Click Handler
 * 
 * Handles click actions from the status line
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

class StatusLineClickHandler {
  constructor() {
    this.actions = {
      'open-dashboard': this.openDashboard.bind(this),
      'open-constraint-dashboard': this.openDashboard.bind(this)
    };
  }

  async openDashboard() {
    try {
      // Check if dashboard server is running
      const dashboardScript = join(rootDir, 'integrations/mcp-constraint-monitor/bin/dashboard');
      
      // Launch dashboard (this will start server if needed and open browser)
      execSync(`"${dashboardScript}"`, { 
        stdio: 'inherit',
        timeout: 5000 
      });
      
      return { success: true, message: 'Dashboard opened' };
    } catch (error) {
      // Fallback: try to open URL directly
      try {
        execSync('open http://localhost:3001/dashboard', { 
          timeout: 3000 
        });
        return { success: true, message: 'Dashboard URL opened' };
      } catch (fallbackError) {
        return { 
          success: false, 
          message: `Failed to open dashboard: ${error.message}` 
        };
      }
    }
  }

  async handleClick(action) {
    if (!action) {
      return { success: false, message: 'No action specified' };
    }

    const handler = this.actions[action];
    if (!handler) {
      return { 
        success: false, 
        message: `Unknown action: ${action}` 
      };
    }

    try {
      return await handler();
    } catch (error) {
      return { 
        success: false, 
        message: `Handler error: ${error.message}` 
      };
    }
  }
}

// Main execution
async function main() {
  try {
    const action = process.argv[2];
    
    if (!action) {
      console.error('Usage: node status-line-click-handler.js <action>');
      process.exit(1);
    }

    const handler = new StatusLineClickHandler();
    const result = await handler.handleClick(action);
    
    if (result.success) {
      console.log(`✅ ${result.message}`);
      process.exit(0);
    } else {
      console.error(`❌ ${result.message}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Click handler error: ${error.message}`);
    process.exit(1);
  }
}

// Only run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { StatusLineClickHandler };