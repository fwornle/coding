#!/usr/bin/env node
/**
 * Database Query CLI
 *
 * Command-line interface for querying knowledge database.
 * Called by Python API server to proxy database requests.
 *
 * Usage:
 *   node db-query-cli.js entities '{"team":"coding","limit":1000}'
 *   node db-query-cli.js relations '{"entityId":"abc123"}'
 *   node db-query-cli.js stats '{"team":"coding"}'
 */

import { DatabaseManager } from '../../src/databases/DatabaseManager.js';
import { KnowledgeQueryService } from '../../src/knowledge-management/KnowledgeQueryService.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const queryType = process.argv[2];
  const paramsJson = process.argv[3] || '{}';

  if (!queryType) {
    process.stderr.write('Usage: db-query-cli.js <queryType> <paramsJson>\n');
    process.stderr.write('Query types: entities, relations, teams, stats\n');
    process.exit(1);
  }

  let params;
  try {
    params = JSON.parse(paramsJson);
  } catch (error) {
    process.stderr.write(`Invalid JSON parameters: ${error.message}\n`);
    process.exit(1);
  }

  // Initialize database
  const projectRoot = path.join(__dirname, '..', '..');
  const sqlitePath = process.env.SQLITE_PATH || path.join(projectRoot, '.data', 'knowledge.db');
  const graphDbPath = process.env.GRAPH_DB_PATH || path.join(projectRoot, '.data', 'knowledge-graph');

  const databaseManager = new DatabaseManager({
    sqlite: {
      path: sqlitePath,
      enabled: true
    },
    qdrant: {
      host: 'localhost',
      port: 6333,
      enabled: false // Not needed for basic queries
    },
    graphDbPath: graphDbPath, // Enable graph database
    debug: false // Disable debug output for clean JSON
  });

  try {
    // Suppress console output during initialization for clean JSON output
    const originalLog = console.log;
    console.log = () => {};

    await databaseManager.initialize();

    // Restore console.log
    console.log = originalLog;

    // Check database health
    const health = await databaseManager.getHealth();
    if (!health.sqlite.available && !health.graph.available) {
      throw new Error('No database available (SQLite and Graph both unavailable)');
    }

    // Pass graph database to query service for delegation
    const queryService = new KnowledgeQueryService(
      databaseManager,
      databaseManager.graphDB, // Pass graph DB for delegation
      { debug: false }
    );

    let result;

    switch (queryType) {
      case 'entities':
        const entities = await queryService.queryEntities(params);
        result = {
          entities,
          count: entities.length,
          limit: params.limit || 1000,
          offset: params.offset || 0
        };
        break;

      case 'relations':
        const relations = await queryService.queryRelations(params);
        result = {
          relations,
          count: relations.length
        };
        break;

      case 'teams':
        const teams = await queryService.getTeams();
        result = {
          available: teams,
          count: teams.length
        };
        break;

      case 'stats':
        result = await queryService.getStatistics(params);
        break;

      case 'health':
        const healthStatus = await databaseManager.getHealth();
        // GraphDB returns {status: "healthy", graph: {nodes, edges}} not {available: boolean}
        const graphAvailable = healthStatus.graph?.status === 'healthy';
        const hasDatabase = healthStatus.sqlite?.available || graphAvailable;
        result = {
          status: hasDatabase ? 'healthy' : 'degraded',
          sqlite: healthStatus.sqlite?.available || false,
          qdrant: healthStatus.qdrant?.available || false,
          graph: graphAvailable
        };
        break;

      default:
        throw new Error(`Unknown query type: ${queryType}`);
    }

    // Output JSON result
    console.log(JSON.stringify(result, null, 0));

    await databaseManager.close();
    process.exit(0);
  } catch (error) {
    process.stderr.write(`Query failed: ${error.message}\n`);
    if (databaseManager) {
      await databaseManager.close();
    }
    process.exit(1);
  }
}

main();
