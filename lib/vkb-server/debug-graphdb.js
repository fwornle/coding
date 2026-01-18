#!/usr/bin/env node
/**
 * Debug GraphDB Contents
 *
 * Queries the GraphDB to show what entities exist and their source fields
 */

import { DatabaseManager } from '../../src/databases/DatabaseManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// This file is at: lib/vkb-server/debug-graphdb.js
// Coding root is 2 levels up
const codingRoot = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || path.resolve(__dirname, '../..');

async function main() {
  // Point to actual coding project .data directory
  const graphDbPath = path.join(codingRoot, '.data', 'knowledge-graph');

  console.log('='.repeat(80));
  console.log('GraphDB Debug Report');
  console.log('='.repeat(80));
  console.log(`GraphDB Path: ${graphDbPath}\n`);

  const databaseManager = new DatabaseManager({
    sqlite: { enabled: false },
    qdrant: { enabled: false },
    graphDb: {
      enabled: true,
      path: graphDbPath,
      exportDir: path.join(codingRoot, '.data', 'knowledge-export')
    }
  });

  await databaseManager.initialize();

  if (!databaseManager.graphDB) {
    console.error('ERROR: GraphDB not available!');
    process.exit(1);
  }

  // Query all teams
  const teams = ['coding', 'ui', 'resi'];

  for (const team of teams) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TEAM: ${team}`);
    console.log('='.repeat(80));

    const entities = await databaseManager.graphDB.queryEntities({
      team,
      limit: 10000
    });

    console.log(`\nTotal entities: ${entities.length}`);

    // Source distribution
    const sourceCount = entities.reduce((acc, e) => {
      const src = e.source || 'undefined';
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    }, {});

    console.log('\nSource Distribution:');
    Object.entries(sourceCount).forEach(([source, count]) => {
      console.log(`  ${source}: ${count}`);
    });

    // Entity type distribution
    const typeCount = entities.reduce((acc, e) => {
      const type = e.entity_type || 'undefined';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    console.log('\nEntity Type Distribution:');
    Object.entries(typeCount).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    // Check for TestOnlinePattern
    const testOnline = entities.find(e => e.entity_name === 'TestOnlinePattern');
    if (testOnline) {
      console.log('\n✓ TestOnlinePattern FOUND:');
      console.log(`  Name: ${testOnline.entity_name}`);
      console.log(`  Type: ${testOnline.entity_type}`);
      console.log(`  Source: ${testOnline.source}`);
      console.log(`  Team: ${testOnline.team}`);
      console.log(`  Observations: ${testOnline.observations?.length || 0}`);
    } else {
      console.log('\n✗ TestOnlinePattern NOT FOUND');
    }

    // List all Projects
    const projects = entities.filter(e => e.entity_type === 'Project');
    if (projects.length > 0) {
      console.log(`\nProjects (${projects.length}):`);
      projects.forEach(p => {
        console.log(`  - ${p.entity_name} (source=${p.source})`);
      });
    } else {
      console.log('\n✗ No Project entities found');
    }

    // List entities with 'auto' source
    const autoEntities = entities.filter(e => e.source === 'auto');
    if (autoEntities.length > 0) {
      console.log(`\nAuto-learned entities (${autoEntities.length}):`);
      autoEntities.forEach(e => {
        console.log(`  - ${e.entity_name} (${e.entity_type})`);
      });
    } else {
      console.log('\n✗ No auto-learned entities found (all are manual)');
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('End of Report');
  console.log('='.repeat(80));

  await databaseManager.close();
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
