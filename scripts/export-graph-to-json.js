#!/usr/bin/env node
/**
 * Export Graph Database to JSON Files
 *
 * Exports the complete graph database (entities and relations) to JSON files per team.
 * Ensures JSON files are always in sync with LevelDB.
 *
 * Usage:
 *   node scripts/export-graph-to-json.js [--team <team-name>]
 *   node scripts/export-graph-to-json.js --all (default)
 */

import { DatabaseManager } from '../src/databases/DatabaseManager.js';
import { KnowledgeQueryService } from '../src/knowledge-management/KnowledgeQueryService.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  const teamIndex = args.indexOf('--team');
  const specificTeam = teamIndex !== -1 ? args[teamIndex + 1] : null;

  console.log('🔄 Exporting graph database to JSON files...');

  // Initialize database
  const projectRoot = path.join(__dirname, '..');
  const sqlitePath = path.join(projectRoot, '.data', 'knowledge.db');
  const graphDbPath = path.join(projectRoot, '.data', 'knowledge-graph');

  const databaseManager = new DatabaseManager({
    sqlite: {
      path: sqlitePath,
      enabled: true
    },
    qdrant: {
      host: 'localhost',
      port: 6333,
      enabled: false
    },
    graphDbPath: graphDbPath,
    debug: false
  });

  try {
    await databaseManager.initialize();

    const health = await databaseManager.getHealth();
    if (!health.graph.available) {
      console.error('❌ Graph database not available');
      process.exit(1);
    }

    const queryService = new KnowledgeQueryService(
      databaseManager,
      databaseManager.graphDB,
      { debug: false }
    );

    // Get all teams
    const teamsResult = await queryService.getTeams();
    const teams = specificTeam ? [specificTeam] : teamsResult.teams;

    console.log(`📋 Teams to export: ${teams.join(', ')}`);

    let totalEntities = 0;
    let totalRelations = 0;

    for (const team of teams) {
      console.log(`\n📦 Exporting team: ${team}`);

      // Query entities
      const entitiesResult = await queryService.queryEntities({ team, limit: 10000 });
      const entities = entitiesResult.map(e => ({
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        observations: e.observations || [],
        team: e.team,
        source: e.source,
        confidence: e.confidence,
        lastModified: e.lastModified
      }));

      // Query relations
      const relationsResult = await queryService.queryRelations({ team, limit: 10000 });
      const relations = relationsResult.map(r => ({
        from: r.from,
        to: r.to,
        relationType: r.relationType,
        team: r.team,
        source: r.source || 'manual',
        createdAt: r.createdAt
      }));

      totalEntities += entities.length;
      totalRelations += relations.length;

      console.log(`   Entities: ${entities.length}`);
      console.log(`   Relations: ${relations.length}`);

      // Write to JSON file
      const outputPath = path.join(projectRoot, '.data', 'knowledge-export', `${team}.json`);
      const data = {
        team,
        entities,
        relations,
        exportedAt: new Date().toISOString(),
        exportedBy: 'export-graph-to-json.js'
      };

      await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
      console.log(`   ✅ Exported to: ${outputPath}`);
    }

    console.log(`\n✅ Export complete!`);
    console.log(`   Total entities: ${totalEntities}`);
    console.log(`   Total relations: ${totalRelations}`);

    await databaseManager.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Export failed:', error.message);
    console.error(error.stack);
    await databaseManager.close();
    process.exit(1);
  }
}

main();
