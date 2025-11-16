#!/usr/bin/env node

/**
 * Fix runIfMain closing braces
 * Ensures all runIfMain() calls have proper closing });
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const filesToCheck = [
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

    // Look for pattern: runIfMain(..., () => {\n...\n}  (without closing );)
    // We need to find cases where after the closing } there's NOT a );

    const lines = content.split('\n');
    let fixed = false;

    for (let i = 0; i < lines.length - 1; i++) {
      // Check if this line has runIfMain
      if (lines[i].includes('runIfMain(import.meta.url, () => {')) {
        // Find the closing brace
        let braceCount = 1;
        let closingLine = -1;

        for (let j = i + 1; j < lines.length; j++) {
          for (let char of lines[j]) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
            if (braceCount === 0) {
              closingLine = j;
              break;
            }
          }
          if (closingLine !== -1) break;
        }

        if (closingLine !== -1) {
          const closeLine = lines[closingLine].trimEnd();
          // Check if it ends with just } instead of });
          if (closeLine === '}' && closingLine < lines.length - 1) {
            // Make sure next line is not );
            if (!lines[closingLine + 1].trim().startsWith(');')) {
              lines[closingLine] = '});';
              fixed = true;
              console.log(`  Fixed line ${closingLine + 1}: ${filePath}`);
            }
          }
        }
      }
    }

    if (fixed) {
      await fs.writeFile(fullPath, lines.join('\n'), 'utf8');
      return { fixed: true };
    } else {
      return { skipped: true };
    }

  } catch (error) {
    console.error(`❌ Error: ${filePath}:`, error.message);
    return { error: true };
  }
}

async function main() {
  console.log('🔧 Fixing runIfMain closing braces\n');

  let stats = { fixed: 0, skipped: 0, errors: 0 };

  for (const file of filesToCheck) {
    const result = await fixFile(file);
    if (result.fixed) {
      stats.fixed++;
      console.log(`✅ ${file}`);
    } else if (result.skipped) {
      stats.skipped++;
    } else if (result.error) {
      stats.errors++;
    }
  }

  console.log('\n📊 Summary:');
  console.log(`   Fixed: ${stats.fixed}`);
  console.log(`   Skipped: ${stats.skipped}`);
  console.log(`   Errors: ${stats.errors}`);
}

main().catch(console.error);
