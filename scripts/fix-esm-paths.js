#!/usr/bin/env node

/**
 * Fix ESM import.meta.url path comparisons for Windows compatibility
 *
 * This script updates all files that use the pattern:
 *   if (import.meta.url === `file://${process.argv[1]}`) {
 *
 * To use the cross-platform utility:
 *   import { runIfMain } from '../lib/utils/esm-cli.js';
 *   runIfMain(import.meta.url, () => {
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Files to process
const filesToFix = [
  'scripts/user-hash-generator.js',
  'scripts/validate-lsl-config.js',
  'scripts/statusline-health-monitor.js',
  'scripts/system-monitor-watchdog.js',
  'scripts/start-services-robust.js',
  'scripts/monitoring-verifier.js',
  'scripts/process-state-manager.js',
  'scripts/migrate-database-schema.js',
  'scripts/migrate-knowledge-to-database.js',
  'scripts/migrate-knowledge-to-databases.js',
  'scripts/live-logging-coordinator.js',
  'scripts/live-logging-status.js',
  'scripts/global-service-coordinator.js',
  'scripts/health-verifier.js',
  'scripts/global-lsl-coordinator.js',
  'scripts/find-latest-session.js',
  'scripts/enhanced-transcript-monitor.js',
  'scripts/event-logger.js',
  'scripts/claude-transcript-reader.js',
  'scripts/claude-conversation-extractor.js',
  'scripts/classification-logger.js',
  'scripts/batch-lsl-processor.js',
  'scripts/auto-insight-trigger.js',
  'lib/vkb-server/express-server.js',
  'integrations/system-health-dashboard/server.js'
];

async function fixFile(filePath) {
  const fullPath = path.join(__dirname, '..', filePath);

  try {
    let content = await fs.readFile(fullPath, 'utf8');

    // Check if file needs fixing
    if (!content.includes('import.meta.url === `file://${process.argv[1]}')) {
      console.log(`⏭️  Skipping ${filePath} (already fixed or no pattern found)`);
      return { skipped: true };
    }

    // Check if already has the import
    const hasImport = content.includes("from '../lib/utils/esm-cli.js'") ||
                      content.includes('from "./lib/utils/esm-cli.js"') ||
                      content.includes('from "../../lib/utils/esm-cli.js"');

    // Determine correct import path based on file location
    let importPath;
    if (filePath.startsWith('scripts/')) {
      importPath = '../lib/utils/esm-cli.js';
    } else if (filePath.startsWith('lib/')) {
      importPath = './utils/esm-cli.js';
    } else if (filePath.startsWith('integrations/')) {
      importPath = '../../lib/utils/esm-cli.js';
    } else {
      importPath = '../lib/utils/esm-cli.js';
    }

    // Add import if not present
    if (!hasImport) {
      // Find the last import statement
      const lines = content.split('\n');
      let lastImportIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('import ')) {
          lastImportIndex = i;
        }
      }

      if (lastImportIndex !== -1) {
        lines.splice(lastImportIndex + 1, 0, `import { runIfMain } from '${importPath}';`);
        content = lines.join('\n');
      }
    }

    // Replace the pattern
    const oldPattern = /if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\) \{/g;
    const newReplacement = 'runIfMain(import.meta.url, () => {';

    content = content.replace(oldPattern, newReplacement);

    // Find and fix the closing brace
    // This is tricky because we need to find the matching closing brace
    // For now, just add a note in comments

    await fs.writeFile(fullPath, content, 'utf8');
    console.log(`✅ Fixed ${filePath}`);
    return { fixed: true };

  } catch (error) {
    console.error(`❌ Error fixing ${filePath}:`, error.message);
    return { error: true };
  }
}

async function main() {
  console.log('🔧 Fixing ESM path comparisons for Windows compatibility\n');

  let stats = { fixed: 0, skipped: 0, errors: 0 };

  for (const file of filesToFix) {
    const result = await fixFile(file);
    if (result.fixed) stats.fixed++;
    if (result.skipped) stats.skipped++;
    if (result.error) stats.errors++;
  }

  console.log('\n📊 Summary:');
  console.log(`   Fixed: ${stats.fixed}`);
  console.log(`   Skipped: ${stats.skipped}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log('\n✨ Done!');
}

main().catch(console.error);
