#!/usr/bin/env node
/**
 * Migrate Live Graph Database Entity Types
 *
 * Updates entity types in the live LevelDB/Graphology database
 * to use consolidated types: System, Project, Pattern
 */

import { GraphDatabaseService } from '../src/knowledge-management/GraphDatabaseService.js';

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

async function migrateGraphDatabase() {
  console.log('🔄 Migrating Live Graph Database Entity Types\n');
  console.log('Target types: System, Project, Pattern\n');

  const dbService = new GraphDatabaseService({
    dbPath: '.data/knowledge-graph',
    config: {
      autoPersist: false, // We'll persist manually at the end
    }
  });

  try {
    // Initialize database
    console.log('📂 Opening graph database...');
    await dbService.initialize();
    console.log('✅ Database opened\n');

    // Get all nodes
    const graph = dbService.graph;
    if (!graph) {
      throw new Error('Graph not initialized');
    }

    console.log(`📊 Total nodes in graph: ${graph.order}`);
    console.log(`📊 Total edges in graph: ${graph.size}\n`);

    let updated = 0;
    let unchanged = 0;
    const typeChanges = {};

    // Iterate through all nodes and update entityType
    graph.forEachNode((nodeId, attributes) => {
      const oldType = attributes.entityType;
      const newType = ENTITY_TYPE_MAPPING[oldType] || 'Pattern';

      if (oldType !== newType) {
        // Update the node's entityType attribute
        graph.setNodeAttribute(nodeId, 'entityType', newType);
        typeChanges[oldType] = (typeChanges[oldType] || 0) + 1;
        updated++;
      } else {
        unchanged++;
      }
    });

    // Report changes
    if (updated > 0) {
      console.log(`✅ Updated ${updated} nodes:`);
      Object.entries(typeChanges).forEach(([oldType, count]) => {
        console.log(`   ${oldType} → Pattern: ${count} nodes`);
      });
      console.log(`✓  ${unchanged} nodes already had correct types\n`);

      // Mark as dirty and persist
      console.log('💾 Persisting changes to database...');
      dbService.isDirty = true;
      await dbService._persistGraphToLevel();
      console.log('✅ Changes persisted successfully\n');
    } else {
      console.log(`✓  No changes needed (${unchanged} nodes already correct)\n`);
    }

    // Final stats
    console.log('📊 Final Statistics:');
    const stats = await dbService.getStatistics();
    console.log(`   Total entities: ${stats.total_entities}`);
    console.log(`   Total relations: ${stats.total_relations}`);

    // Count by entity type
    const typeCounts = {};
    graph.forEachNode((nodeId, attributes) => {
      const type = attributes.entityType || 'Unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    console.log('\n   Entity types:');
    Object.entries(typeCounts).sort().forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`);
    });

    // Close database
    await dbService.close();
    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    await dbService.close();
    process.exit(1);
  }
}

// Run
migrateGraphDatabase();
