#!/usr/bin/env node
/**
 * Consolidate Relationship Types Migration Script
 *
 * Consolidates all relationship types in the graph database to a clean semantic set:
 * - implemented_in
 * - contributes_to
 * - contains
 * - extends
 * - related_to
 * - uses
 *
 * Semantic Groupings:
 * 1. Project/Pattern location: "implemented in", "originally developed in" → implemented_in
 * 2. Contribution: "contributes to", "contributes_to", "contributed patterns to" → contributes_to
 * 3. Containment: "contains", "belongs_to" → contains
 * 4. Extension: "extends", "enhances" → extends
 * 5. Relatedness: "related_to", "similar_to" → related_to
 * 6. Dependency: "uses" → uses
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Relationship type consolidation mapping
const RELATIONSHIP_TYPE_MAPPING = {
  // Project/Pattern location
  'implemented in': 'implemented_in',
  'originally developed in': 'implemented_in',

  // Contribution relationships
  'contributes to': 'contributes_to',
  'contributes_to': 'contributes_to',
  'contributed patterns to': 'contributes_to',

  // Containment relationships
  'contains': 'contains',
  'belongs_to': 'contains',

  // Extension relationships
  'extends': 'extends',
  'enhances': 'extends',

  // Relatedness
  'related_to': 'related_to',
  'similar_to': 'related_to',

  // Dependency
  'uses': 'uses',
};

/**
 * Consolidate relationship types in a JSON export file
 */
function consolidateJsonFile(filePath) {
  console.log(`\n📄 Processing: ${filePath}`);

  // Read the file
  const content = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);

  if (!data.relations || !Array.isArray(data.relations)) {
    console.log('⚠️  No relations array found, skipping');
    return { changed: 0, unchanged: 0 };
  }

  let changed = 0;
  let unchanged = 0;
  const typeChanges = {};

  // Update each relation's type
  data.relations.forEach(relation => {
    const oldType = relation.relationType;
    const newType = RELATIONSHIP_TYPE_MAPPING[oldType] || oldType;

    if (oldType !== newType) {
      relation.relationType = newType;
      const changeKey = `${oldType} → ${newType}`;
      typeChanges[changeKey] = (typeChanges[changeKey] || 0) + 1;
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
    console.log(`✅ Updated ${changed} relations:`);
    Object.entries(typeChanges).forEach(([change, count]) => {
      console.log(`   ${change}: ${count} relations`);
    });
  } else {
    console.log(`✓  No changes needed (${unchanged} relations already correct)`);
  }

  return { changed, unchanged };
}

/**
 * Main execution
 */
async function main() {
  console.log('🔄 Relationship Type Consolidation Migration\n');
  console.log('Target types: implemented_in, contributes_to, contains, extends, related_to, uses\n');

  const exportDir = path.join(__dirname, '..', '.data', 'knowledge-export');

  // Find all JSON files in export directory (excluding backups)
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
  console.log(`   Total relations changed: ${totalChanged}`);
  console.log(`   Total relations unchanged: ${totalUnchanged}`);
  console.log(`   Total files processed: ${files.length}`);
  console.log('='.repeat(60));

  if (totalChanged > 0) {
    console.log('\n✅ Migration complete!');
    console.log('💡 Next steps:');
    console.log('   1. Review the changes in the JSON files');
    console.log('   2. Restart VKB server to load updated data');
    console.log('   3. Test memory visualizer filters');
  } else {
    console.log('\n✓  All relationship types already consolidated');
  }
}

// Run if called directly
main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});

export { consolidateJsonFile, RELATIONSHIP_TYPE_MAPPING };
