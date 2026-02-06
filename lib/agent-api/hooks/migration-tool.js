#!/usr/bin/env node

/**
 * Hook Migration Tool - Migrate hooks to unified format
 *
 * Usage: coding migrate-hooks [options]
 *
 * Migrates existing agent-specific hook configurations to the unified format:
 * - Claude: ~/.claude/settings.json → ~/.coding-tools/hooks.json
 * - Copilot: .github/hooks/hooks.json → .coding/hooks.json
 *
 * Options:
 *   --dry-run     Show what would be migrated without making changes
 *   --backup      Create backup of existing configs (default: true)
 *   --force       Overwrite existing unified config
 *   --source      Source type: claude, copilot, or all (default: all)
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createLogger } from '../../logging/Logger.js';
import { HookEvent } from '../hooks-api.js';
import { DEFAULT_CONFIG } from './hook-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger('hook-migration');

/**
 * Parse command line arguments
 */
function parseArgs(argv) {
  const args = {
    dryRun: false,
    backup: true,
    force: false,
    source: 'all',
    projectPath: process.cwd()
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--no-backup') {
      args.backup = false;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--source' && argv[i + 1]) {
      args.source = argv[++i];
    } else if (arg === '--project' && argv[i + 1]) {
      args.projectPath = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  return args;
}

/**
 * Show help message
 */
function showHelp() {
  process.stdout.write(`
Hook Migration Tool - Migrate hooks to unified format

Usage: coding migrate-hooks [options]

Options:
  --dry-run       Show what would be migrated without making changes
  --no-backup     Don't create backup of existing configs
  --force         Overwrite existing unified config
  --source TYPE   Source type: claude, copilot, or all (default: all)
  --project PATH  Project path for project-level migration
  --help, -h      Show this help message

Examples:
  coding migrate-hooks                    # Migrate all hooks
  coding migrate-hooks --dry-run          # Preview migration
  coding migrate-hooks --source claude    # Only migrate Claude hooks
`);
}

/**
 * Map Claude native events to unified events
 */
const CLAUDE_EVENT_MAP = {
  'PreToolUse': 'pre-tool',
  'PostToolUse': 'post-tool',
  'Startup': 'startup',
  'Shutdown': 'shutdown'
};

/**
 * Map Copilot native events to unified events
 */
const COPILOT_EVENT_MAP = {
  'sessionStart': 'startup',
  'sessionEnd': 'shutdown',
  'preToolUse': 'pre-tool',
  'postToolUse': 'post-tool',
  'userPromptSubmitted': 'pre-prompt',
  'errorOccurred': 'error'
};

/**
 * Migrate Claude hooks from ~/.claude/settings.json
 */
async function migrateClaudeHooks(args) {
  const results = {
    source: 'claude',
    found: false,
    migrated: 0,
    skipped: 0,
    errors: []
  };

  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  if (!fsSync.existsSync(settingsPath)) {
    results.errors.push('Claude settings.json not found');
    return results;
  }

  try {
    const content = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(content);

    if (!settings.hooks || Object.keys(settings.hooks).length === 0) {
      results.errors.push('No hooks found in Claude settings.json');
      return results;
    }

    results.found = true;
    const migratedHooks = {};

    for (const [nativeEvent, handlers] of Object.entries(settings.hooks)) {
      const unifiedEvent = CLAUDE_EVENT_MAP[nativeEvent];

      if (!unifiedEvent) {
        logger.warn(`Unknown Claude event: ${nativeEvent}, skipping`);
        results.skipped++;
        continue;
      }

      if (!migratedHooks[unifiedEvent]) {
        migratedHooks[unifiedEvent] = [];
      }

      const handlerList = Array.isArray(handlers) ? handlers : [handlers];

      for (const handler of handlerList) {
        if (!handler.command && !handler.script) {
          results.skipped++;
          continue;
        }

        migratedHooks[unifiedEvent].push({
          id: `claude-migrated-${nativeEvent}-${Date.now()}`,
          type: 'script',
          path: handler.command || handler.script,
          args: handler.args || [],
          priority: 100,
          enabled: true,
          agents: ['claude'],
          description: `Migrated from Claude ${nativeEvent}`,
          _migrated: {
            source: 'claude',
            originalEvent: nativeEvent,
            timestamp: new Date().toISOString()
          }
        });

        results.migrated++;
      }
    }

    results.hooks = migratedHooks;
  } catch (error) {
    results.errors.push(`Failed to read Claude settings: ${error.message}`);
  }

  return results;
}

/**
 * Migrate Copilot hooks from .github/hooks/hooks.json
 */
async function migrateCopilotHooks(args) {
  const results = {
    source: 'copilot',
    found: false,
    migrated: 0,
    skipped: 0,
    errors: []
  };

  const hooksPath = path.join(args.projectPath, '.github', 'hooks', 'hooks.json');

  if (!fsSync.existsSync(hooksPath)) {
    results.errors.push('Copilot hooks.json not found');
    return results;
  }

  try {
    const content = await fs.readFile(hooksPath, 'utf8');
    const hooksConfig = JSON.parse(content);

    results.found = true;
    const migratedHooks = {};

    for (const [nativeEvent, handler] of Object.entries(hooksConfig)) {
      if (nativeEvent.startsWith('_')) {
        continue; // Skip metadata fields
      }

      const unifiedEvent = COPILOT_EVENT_MAP[nativeEvent];

      if (!unifiedEvent) {
        logger.warn(`Unknown Copilot event: ${nativeEvent}, skipping`);
        results.skipped++;
        continue;
      }

      if (!handler.command) {
        results.skipped++;
        continue;
      }

      if (!migratedHooks[unifiedEvent]) {
        migratedHooks[unifiedEvent] = [];
      }

      migratedHooks[unifiedEvent].push({
        id: `copilot-migrated-${nativeEvent}-${Date.now()}`,
        type: 'command',
        path: handler.command,
        args: handler.args || [],
        priority: 100,
        enabled: true,
        agents: ['copilot'],
        description: `Migrated from Copilot ${nativeEvent}`,
        _migrated: {
          source: 'copilot',
          originalEvent: nativeEvent,
          timestamp: new Date().toISOString()
        }
      });

      results.migrated++;
    }

    results.hooks = migratedHooks;
  } catch (error) {
    results.errors.push(`Failed to read Copilot hooks: ${error.message}`);
  }

  return results;
}

/**
 * Write unified configuration
 */
async function writeUnifiedConfig(args, hooks, targetPath) {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // Merge migrated hooks
  for (const [event, handlers] of Object.entries(hooks)) {
    if (!config.hooks[event]) {
      config.hooks[event] = [];
    }
    config.hooks[event].push(...handlers);
  }

  // Add migration metadata
  config._migrated = {
    timestamp: new Date().toISOString(),
    sources: Object.keys(hooks).length > 0 ? ['claude', 'copilot'].filter(s =>
      Object.values(hooks).some(h => h.some(handler => handler.agents?.includes(s)))
    ) : []
  };

  if (args.dryRun) {
    logger.info('Would write to:', targetPath);
    logger.info('Config:', JSON.stringify(config, null, 2));
    return;
  }

  // Create directory if needed
  const dir = path.dirname(targetPath);
  if (!fsSync.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }

  // Backup existing config
  if (args.backup && fsSync.existsSync(targetPath)) {
    const backupPath = `${targetPath}.backup.${Date.now()}`;
    await fs.copyFile(targetPath, backupPath);
    logger.info(`Created backup: ${backupPath}`);
  }

  await fs.writeFile(targetPath, JSON.stringify(config, null, 2));
  logger.info(`Written unified config: ${targetPath}`);
}

/**
 * Main migration function
 */
async function migrate(args) {
  logger.info('Starting hook migration...');
  logger.info(`Options: dry-run=${args.dryRun}, source=${args.source}, backup=${args.backup}`);

  const allHooks = {};
  const results = [];

  // Migrate Claude hooks (user-level)
  if (args.source === 'all' || args.source === 'claude') {
    const claudeResults = await migrateClaudeHooks(args);
    results.push(claudeResults);

    if (claudeResults.hooks) {
      for (const [event, handlers] of Object.entries(claudeResults.hooks)) {
        if (!allHooks[event]) {
          allHooks[event] = [];
        }
        allHooks[event].push(...handlers);
      }
    }

    logger.info(`Claude: found=${claudeResults.found}, migrated=${claudeResults.migrated}, skipped=${claudeResults.skipped}`);
    if (claudeResults.errors.length > 0) {
      logger.warn('Claude errors:', claudeResults.errors);
    }
  }

  // Migrate Copilot hooks (project-level)
  if (args.source === 'all' || args.source === 'copilot') {
    const copilotResults = await migrateCopilotHooks(args);
    results.push(copilotResults);

    if (copilotResults.hooks) {
      for (const [event, handlers] of Object.entries(copilotResults.hooks)) {
        if (!allHooks[event]) {
          allHooks[event] = [];
        }
        allHooks[event].push(...handlers);
      }
    }

    logger.info(`Copilot: found=${copilotResults.found}, migrated=${copilotResults.migrated}, skipped=${copilotResults.skipped}`);
    if (copilotResults.errors.length > 0) {
      logger.warn('Copilot errors:', copilotResults.errors);
    }
  }

  // Write user-level unified config
  const userConfigPath = path.join(os.homedir(), '.coding-tools', 'hooks.json');

  if (!args.force && fsSync.existsSync(userConfigPath)) {
    logger.warn(`User config already exists: ${userConfigPath}`);
    logger.warn('Use --force to overwrite');
  } else {
    await writeUnifiedConfig(args, allHooks, userConfigPath);
  }

  // Summary
  const totalMigrated = results.reduce((sum, r) => sum + r.migrated, 0);
  const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);

  logger.info('');
  logger.info('Migration Summary:');
  logger.info(`  Total migrated: ${totalMigrated}`);
  logger.info(`  Total skipped: ${totalSkipped}`);

  if (args.dryRun) {
    logger.info('');
    logger.info('(Dry run - no changes made)');
  }

  return { results, totalMigrated, totalSkipped };
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv);
  migrate(args)
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Migration failed:', error.message);
      process.exit(1);
    });
}

export { migrate, parseArgs, migrateClaudeHooks, migrateCopilotHooks };
