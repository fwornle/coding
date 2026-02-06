#!/usr/bin/env node

/**
 * Unified /sl Command Handler
 *
 * Provides a unified implementation of the /sl (session log) command
 * that works across all supported agents (Claude Code, GitHub Copilot CLI).
 *
 * Usage:
 *   /sl              - Show recent session history
 *   /sl today        - Show today's sessions
 *   /sl <hours>      - Show sessions from last N hours
 *   /sl --stats      - Show session statistics
 *   /sl --format md  - Output as markdown
 *   /sl --format json - Output as JSON
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import path from 'path';
import os from 'os';
import { createLogger } from '../../logging/Logger.js';
import { getCurrentAdapter } from '../index.js';
import { LSLConverter } from '../transcripts/lsl-converter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger('sl-handler');

/**
 * Parse command arguments
 */
function parseArgs(argv) {
  const args = {
    hours: 24,
    today: false,
    stats: false,
    format: 'text',
    limit: 10,
    projectPath: process.env.TRANSCRIPT_SOURCE_PROJECT || process.cwd(),
    verbose: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === 'today') {
      args.today = true;
    } else if (arg === '--stats') {
      args.stats = true;
    } else if (arg === '--format' && argv[i + 1]) {
      args.format = argv[++i];
    } else if (arg === '--limit' && argv[i + 1]) {
      args.limit = parseInt(argv[++i], 10);
    } else if (arg === '--project' && argv[i + 1]) {
      args.projectPath = argv[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (!isNaN(parseInt(arg, 10))) {
      args.hours = parseInt(arg, 10);
    }
  }

  return args;
}

/**
 * Show help message
 */
function showHelp() {
  const help = `
Session Log (/sl) - View recent session history

Usage:
  /sl              Show recent session history (last 24h)
  /sl today        Show today's sessions
  /sl <hours>      Show sessions from last N hours
  /sl --stats      Show session statistics
  /sl --format md  Output as markdown
  /sl --format json Output as JSON-Lines
  /sl --limit N    Limit to N sessions (default: 10)
  /sl --verbose    Show detailed output
  /sl --help       Show this help

Examples:
  /sl              # Recent sessions
  /sl 4            # Last 4 hours
  /sl --stats      # Session statistics
  /sl --format md  # Markdown output
`;
  process.stdout.write(help);
}

/**
 * Main handler function
 */
async function handleSlCommand(argv = []) {
  const args = parseArgs(argv);

  try {
    // Detect current agent
    const agentType = process.env.CODING_AGENT || 'claude';

    if (args.verbose) {
      logger.info(`Agent: ${agentType}`);
      logger.info(`Project: ${args.projectPath}`);
    }

    // Get the adapter for current agent
    const adapter = await getCurrentAdapter({
      projectPath: args.projectPath
    }).catch(async () => {
      // Fallback: try to create adapter directly
      const { getAdapter } = await import('../index.js');
      return getAdapter(agentType, { projectPath: args.projectPath });
    });

    // Get transcript adapter
    const transcriptAdapter = adapter.getTranscriptAdapter();

    // Calculate time range
    let since = null;
    if (args.today) {
      const now = new Date();
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (args.hours > 0) {
      since = new Date(Date.now() - args.hours * 60 * 60 * 1000);
    }

    // Read sessions
    const sessions = await transcriptAdapter.readTranscripts({
      limit: args.limit,
      since: since?.toISOString()
    });

    if (sessions.length === 0) {
      process.stdout.write('No sessions found for the specified time range.\n');
      return;
    }

    // Output based on format
    if (args.stats) {
      outputStats(sessions, args);
    } else if (args.format === 'json') {
      outputJSON(sessions, args);
    } else if (args.format === 'md' || args.format === 'markdown') {
      outputMarkdown(sessions, args);
    } else {
      outputText(sessions, args);
    }
  } catch (error) {
    logger.error('Failed to handle /sl command', { error: error.message });
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

/**
 * Output as plain text
 */
function outputText(sessions, args) {
  const lines = [];

  lines.push(`\n📋 Session History (${sessions.length} sessions)`);
  lines.push('═'.repeat(50));

  for (const session of sessions) {
    const startTime = new Date(session.metadata.startTime);
    const timeStr = startTime.toLocaleString();
    const agent = session.metadata.agent || 'unknown';

    lines.push('');
    lines.push(`🕐 ${timeStr} [${agent}]`);
    lines.push(`   Session: ${session.metadata.sessionId.substring(0, 8)}...`);

    // Count entries by type
    const counts = {
      user: 0,
      assistant: 0,
      tool: 0
    };

    for (const entry of session.entries) {
      if (entry.type === 'user') counts.user++;
      else if (entry.type === 'assistant') counts.assistant++;
      else if (entry.type === 'tool_use') counts.tool++;
    }

    lines.push(`   Messages: ${counts.user} user, ${counts.assistant} assistant, ${counts.tool} tools`);

    // Show first user message if verbose
    if (args.verbose) {
      const firstUser = session.entries.find(e => e.type === 'user');
      if (firstUser) {
        const preview = firstUser.content.substring(0, 100).replace(/\n/g, ' ');
        lines.push(`   First: "${preview}${firstUser.content.length > 100 ? '...' : ''}"`);
      }
    }
  }

  lines.push('');
  process.stdout.write(lines.join('\n'));
}

/**
 * Output as markdown
 */
function outputMarkdown(sessions, args) {
  const converter = new LSLConverter();
  const lines = [];

  lines.push('# Session History');
  lines.push('');
  lines.push(`*${sessions.length} sessions found*`);
  lines.push('');

  for (const session of sessions) {
    lines.push(converter.toMarkdown(session));
    lines.push('---');
    lines.push('');
  }

  process.stdout.write(lines.join('\n'));
}

/**
 * Output as JSON-Lines
 */
function outputJSON(sessions, args) {
  for (const session of sessions) {
    process.stdout.write(JSON.stringify({
      metadata: session.metadata,
      entryCount: session.entries.length,
      entries: args.verbose ? session.entries : undefined
    }) + '\n');
  }
}

/**
 * Output statistics
 */
function outputStats(sessions, args) {
  const converter = new LSLConverter();
  const lines = [];

  lines.push('\n📊 Session Statistics');
  lines.push('═'.repeat(50));

  let totalEntries = 0;
  let totalUser = 0;
  let totalAssistant = 0;
  let totalTools = 0;
  let totalDuration = 0;
  const toolsUsed = new Set();
  const agentCounts = {};

  for (const session of sessions) {
    const stats = converter.getStats(session);

    totalEntries += stats.entryCount;
    totalUser += stats.userMessages;
    totalAssistant += stats.assistantMessages;
    totalTools += stats.toolCalls;

    if (stats.duration) {
      totalDuration += stats.duration;
    }

    for (const tool of stats.toolsUsed) {
      toolsUsed.add(tool);
    }

    const agent = session.metadata.agent || 'unknown';
    agentCounts[agent] = (agentCounts[agent] || 0) + 1;
  }

  lines.push('');
  lines.push(`Sessions: ${sessions.length}`);
  lines.push(`Total Entries: ${totalEntries}`);
  lines.push(`User Messages: ${totalUser}`);
  lines.push(`Assistant Messages: ${totalAssistant}`);
  lines.push(`Tool Calls: ${totalTools}`);
  lines.push(`Unique Tools: ${toolsUsed.size}`);

  if (totalDuration > 0) {
    const hours = Math.floor(totalDuration / 3600000);
    const minutes = Math.floor((totalDuration % 3600000) / 60000);
    lines.push(`Total Duration: ${hours}h ${minutes}m`);
  }

  lines.push('');
  lines.push('By Agent:');
  for (const [agent, count] of Object.entries(agentCounts)) {
    lines.push(`  ${agent}: ${count} sessions`);
  }

  if (toolsUsed.size > 0) {
    lines.push('');
    lines.push('Tools Used:');
    for (const tool of Array.from(toolsUsed).slice(0, 10)) {
      lines.push(`  - ${tool}`);
    }
    if (toolsUsed.size > 10) {
      lines.push(`  ... and ${toolsUsed.size - 10} more`);
    }
  }

  lines.push('');
  process.stdout.write(lines.join('\n'));
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  handleSlCommand(process.argv.slice(2));
}

export { handleSlCommand, parseArgs };
export default handleSlCommand;
