#!/usr/bin/env node

/**
 * Live Logging Status Line
 * Shows real-time session information in Claude Code status bar
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { runIfMain } from '../lib/utils/esm-cli.js';

/**
 * Get session duration from config file in milliseconds
 */
function getSessionDurationMs() {
  try {
    // Find the coding repository root
    const codingRepo = process.env.CODING_REPO || process.env.CODING_TOOLS_PATH;
    if (!codingRepo) {
      return 3600000; // Default: 1 hour
    }
    
    const configPath = path.join(codingRepo, 'config', 'live-logging-config.json');
    if (!fs.existsSync(configPath)) {
      return 3600000; // Default: 1 hour
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config.live_logging?.session_duration || 3600000; // Default: 1 hour
  } catch (error) {
    return 3600000; // Default: 1 hour
  }
}

class SimpleStatusAnalyzer {
  /**
   * Find the most recent Claude Code transcript
   */
  findTranscriptFile() {
    try {
      const homeDir = os.homedir();
      const transcriptsDir = path.join(homeDir, '.claude', 'conversations');
      
      if (!fs.existsSync(transcriptsDir)) {
        return null;
      }

      const files = fs.readdirSync(transcriptsDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => {
          const filepath = path.join(transcriptsDir, file);
          const stats = fs.statSync(filepath);
          return { 
            path: filepath, 
            name: file,
            mtime: stats.mtime,
            size: stats.size
          };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) {
        return null;
      }

      // Return the most recent file modified in the configured session duration
      const mostRecent = files[0];
      const timeDiff = Date.now() - mostRecent.mtime.getTime();
      
      // Load session duration from config (defaults to 1 hour)
      const sessionDuration = getSessionDurationMs();
      
      if (timeDiff < sessionDuration) {
        return mostRecent;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Count tool interactions in transcript
   */
  countToolInteractions(transcriptPath) {
    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      let toolCount = 0;
      let lastToolName = null;
      
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          
          if (message.type === 'assistant' && message.message?.content) {
            const content = message.message.content;
            
            if (Array.isArray(content)) {
              for (const item of content) {
                if (item.type === 'tool_use') {
                  toolCount++;
                  lastToolName = item.name;
                }
              }
            }
          }
        } catch {
          continue;
        }
      }

      return { toolCount, lastToolName };
    } catch (error) {
      return { toolCount: 0, lastToolName: null };
    }
  }

  /**
   * Get tool icon
   */
  getToolIcon(toolName) {
    if (!toolName) return '⚙️';
    
    const icons = {
      'Edit': '✏️',
      'MultiEdit': '✏️', 
      'Write': '📄',
      'Read': '👀',
      'Bash': '💻',
      'Grep': '🔍',
      'Glob': '📁',
      'WebFetch': '🌐',
      'TodoWrite': '📋'
    };
    
    // Handle MCP tools
    if (toolName.startsWith('mcp__')) {
      const parts = toolName.split('__');
      if (parts[1] === 'memory') return '🧠';
      if (parts[1] === 'semantic-analysis') return '🔬';
      if (parts[1] === 'browser-access') return '🌐';
      if (parts[1] === 'constraint-monitor') return '🛡️';
      return '⚙️';
    }

    return icons[toolName] || '⚙️';
  }

  /**
   * Generate status line
   */
  generateStatus() {
    try {
      const transcript = this.findTranscriptFile();
      
      if (!transcript) {
        return '📝 No active session';
      }

      const { toolCount, lastToolName } = this.countToolInteractions(transcript.path);
      const sessionId = path.basename(transcript.name, '.jsonl').slice(-8);
      
      const parts = ['📝', sessionId];
      
      if (toolCount > 0) {
        parts.push(`🔧${toolCount}`);
      }
      
      if (lastToolName) {
        const toolIcon = this.getToolIcon(lastToolName);
        parts.push(`${toolIcon}`);
      }

      // Session age
      const ageMinutes = Math.floor((Date.now() - transcript.mtime.getTime()) / 60000);
      if (ageMinutes < 5) {
        parts.push('🔄'); // Recently active
      }

      return parts.join(' ');

    } catch (error) {
      return `📝 ❌ ${error.message.slice(0, 20)}`;
    }
  }
}

// Main execution
async function main() {
  try {
    const analyzer = new SimpleStatusAnalyzer();
    const status = analyzer.generateStatus();
    console.log(status);
  } catch (error) {
    console.log(`📝 ❌ Error`);
  }
}

// Handle different execution contexts
runIfMain(import.meta.url, () => {
  main().catch(() => {
    console.log('📝 ❌ Status error');
    process.exit(1);
  });
});

export { SimpleStatusAnalyzer };