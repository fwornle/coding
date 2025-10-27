#!/usr/bin/env node
/**
 * Consolidate Entity Types Migration Script
 *
 * Consolidates all entity types in the graph database to:
 * - System
 * - Project
 * - Pattern
 * - All (for filters only, not stored)
 *
 * Mapping:
 * - System → System (unchanged)
 * - Project → Project (unchanged)
 * - Pattern → Pattern (unchanged)
 * - TransferablePattern → Pattern
 * - WorkflowPattern → Pattern
 * - TechnicalPattern → Pattern
 * - TechnicalIssue → Pattern
 * - SystemImplementation → Pattern
 * - AnalysisInsight → Pattern
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Entity type consolidation mapping
const ENTITY_TYPE_MAPPING = {
  'System': 'System',
  'Project': 'Project',
  'Pattern': 'Pattern',
  'TransferablePattern': 'Pattern',
  'WorkflowPattern': 'Pattern',
  'TechnicalPattern': 'Pattern',
  'TechnicalIssue': 'Pattern',
  'SystemImplementation': 'Pattern',
  'AnalysisInsight': 'Pattern',
};

/**
 * Consolidate entity types in a JSON export file
 */
function consolidateJsonFile(filePath) {
  console.log(`\n📄 Processing: ${filePath}`);

  // Read the file
  const content = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);

  if (!data.entities || !Array.isArray(data.entities)) {
    console.log('⚠️  No entities array found, skipping');
    return { changed: 0, unchanged: 0 };
  }

  let changed = 0;
  let unchanged = 0;
  const typeChanges = {};

  // Update each entity's type
  data.entities.forEach(entity => {
    const oldType = entity.entityType;
    const newType = ENTITY_TYPE_MAPPING[oldType] || 'Pattern'; // Default to Pattern for unknowns

    if (oldType !== newType) {
      entity.entityType = newType;
      typeChanges[oldType] = (typeChanges[oldType] || 0) + 1;
      changed++;
    } else {
      unchanged++;
    }
  });

  // Write back if changes were made
  if (changed > 0) {
    // Create backup
    const backupPath = `${filePath}.backup-${Date.now()}`;
    fs.writeFileSync(backupPath, content, 'utf8');
    console.log(`💾 Backup created: ${backupPath}`);

    // Write updated file
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ Updated ${changed} entities:`);
    Object.entries(typeChanges).forEach(([oldType, count]) => {
      console.log(`   ${oldType} → Pattern: ${count} entities`);
    });
  } else {
    console.log(`✓  No changes needed (${unchanged} entities already correct)`);
  }

  return { changed, unchanged };
}

/**
 * Main execution
 */
async function main() {
  console.log('🔄 Entity Type Consolidation Migration\n');
  console.log('Target types: System, Project, Pattern\n');

  const exportDir = path.join(__dirname, '..', '.data', 'knowledge-export');

  // Find all JSON files in export directory
  const files = fs.readdirSync(exportDir)
    .filter(f => f.endsWith('.json') && !f.includes('.backup'))
    .map(f => path.join(exportDir, f));

  if (files.length === 0) {
    console.log('⚠️  No JSON export files found');
    return;
  }

  console.log(`Found ${files.length} export file(s)\n`);

  let totalChanged = 0;
  let totalUnchanged = 0;

  // Process each file
  for (const file of files) {
    const stats = consolidateJsonFile(file);
    totalChanged += stats.changed;
    totalUnchanged += stats.unchanged;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Migration Summary:');
  console.log(`   Total entities changed: ${totalChanged}`);
  console.log(`   Total entities unchanged: ${totalUnchanged}`);
  console.log(`   Total files processed: ${files.length}`);
  console.log('='.repeat(60));

  if (totalChanged > 0) {
    console.log('\n✅ Migration complete!');
    console.log('💡 Next steps:');
    console.log('   1. Review the changes in the JSON files');
    console.log('   2. Restart VKB server to load updated data');
    console.log('   3. Test memory visualizer');
  } else {
    console.log('\n✓  All entity types already consolidated');
  }
}

// Run if called directly
main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});

export { consolidateJsonFile, ENTITY_TYPE_MAPPING };
