/**
 * Integration Tests for VKB HTTP API with Graph Backend
 *
 * Verifies that VKB HTTP API endpoints work correctly with graph database
 * and maintain backward compatibility with SQLite response format.
 */

import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { DatabaseManager } from '../../src/databases/DatabaseManager.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = '.cache/test-http-api-integration';
const GRAPH_PATH = path.join(TEST_DB_PATH, 'knowledge-graph');
const API_PORT = 8081; // Use different port to avoid conflicts
const API_URL = `http://localhost:${API_PORT}`;

describe('VKB HTTP API Integration', () => {
  let dbManager;
  let apiServer;

  beforeAll(async () => {
    // Clean up
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DB_PATH, { recursive: true });

    // Setup graph database with test data
    dbManager = new DatabaseManager({
      sqlite: { enabled: false },
      qdrant: { enabled: false },
      graphDbPath: GRAPH_PATH
    });

    await dbManager.initialize();

    // Populate with test data
    await dbManager.graphDB.storeEntity({
      name: 'APITestPattern',
      entityType: 'Pattern',
      observations: ['API test observation'],
      confidence: 0.9,
      source: 'manual'
    }, { team: 'coding' });

    await dbManager.graphDB.storeEntity({
      name: 'APITestSolution',
      entityType: 'Solution',
      observations: ['Solution observation'],
      confidence: 0.95,
      source: 'manual'
    }, { team: 'coding' });

    await dbManager.graphDB.storeRelationship(
      'APITestPattern',
      'APITestSolution',
      'uses',
      { team: 'coding', confidence: 0.92 }
    );

    await dbManager.close();

    // Start VKB API server
    // Note: This requires the VKB server to be implemented
    // For now, we'll test the db-query-cli.js interface
  });

  afterAll(async () => {
    if (apiServer) {
      apiServer.kill();
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    }
  });

  describe('Graph Database Queries via CLI', () => {
    it('should query entities from graph database', async () => {
      const result = await new Promise((resolve, reject) => {
        const cli = spawn('node', ['lib/vkb-server/db-query-cli.js', 'entities'], {
          env: {
            ...process.env,
            GRAPH_DB_PATH: GRAPH_PATH,
            SQLITE_ENABLED: 'false'
          }
        });

        let stdout = '';
        let stderr = '';

        cli.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        cli.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        cli.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`CLI failed with code ${code}: ${stderr}`));
          } else {
            try {
              resolve(JSON.parse(stdout));
            } catch (err) {
              reject(new Error(`Failed to parse JSON: ${stdout}`));
            }
          }
        });
      });

      expect(result.entities).toBeDefined();
      expect(Array.isArray(result.entities)).toBe(true);
      expect(result.entities.length).toBeGreaterThan(0);

      // Verify SQL-compatible format
      const entity = result.entities[0];
      expect(entity).toHaveProperty('id');
      expect(entity).toHaveProperty('entity_name');
      expect(entity).toHaveProperty('entity_type');
      expect(entity).toHaveProperty('team');
      expect(entity).toHaveProperty('source');
    });

    it('should query relations from graph database', async () => {
      const result = await new Promise((resolve, reject) => {
        const cli = spawn('node', ['lib/vkb-server/db-query-cli.js', 'relations'], {
          env: {
            ...process.env,
            GRAPH_DB_PATH: GRAPH_PATH,
            SQLITE_ENABLED: 'false'
          }
        });

        let stdout = '';
        let stderr = '';

        cli.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        cli.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        cli.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`CLI failed with code ${code}: ${stderr}`));
          } else {
            try {
              resolve(JSON.parse(stdout));
            } catch (err) {
              reject(new Error(`Failed to parse JSON: ${stdout}`));
            }
          }
        });
      });

      expect(result.relations).toBeDefined();
      expect(Array.isArray(result.relations)).toBe(true);

      // Verify SQL-compatible format
      if (result.relations.length > 0) {
        const relation = result.relations[0];
        expect(relation).toHaveProperty('from_name');
        expect(relation).toHaveProperty('to_name');
        expect(relation).toHaveProperty('relation_type');
        expect(relation).toHaveProperty('team');
      }
    });

    it('should get statistics from graph database', async () => {
      const result = await new Promise((resolve, reject) => {
        const cli = spawn('node', ['lib/vkb-server/db-query-cli.js', 'stats'], {
          env: {
            ...process.env,
            GRAPH_DB_PATH: GRAPH_PATH,
            SQLITE_ENABLED: 'false'
          }
        });

        let stdout = '';
        let stderr = '';

        cli.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        cli.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        cli.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`CLI failed with code ${code}: ${stderr}`));
          } else {
            try {
              resolve(JSON.parse(stdout));
            } catch (err) {
              reject(new Error(`Failed to parse JSON: ${stdout}`));
            }
          }
        });
      });

      expect(result).toHaveProperty('totalEntities');
      expect(result).toHaveProperty('entitiesByTeamAndSource');
      expect(result.totalEntities).toBeGreaterThan(0);
    });
  });

  describe('Response Format Compatibility', () => {
    it('should return entities in SQL-compatible format', async () => {
      const result = await new Promise((resolve, reject) => {
        const cli = spawn('node', ['lib/vkb-server/db-query-cli.js', 'entities', '--team', 'coding'], {
          env: {
            ...process.env,
            GRAPH_DB_PATH: GRAPH_PATH,
            SQLITE_ENABLED: 'false'
          }
        });

        let stdout = '';

        cli.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        cli.on('close', (code) => {
          if (code === 0) {
            try {
              resolve(JSON.parse(stdout));
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error('CLI failed'));
          }
        });
      });

      expect(result.entities).toBeDefined();

      // Check that each entity has SQL-compatible fields
      result.entities.forEach(entity => {
        expect(entity.id).toBeDefined();
        expect(entity.entity_name).toBeDefined();
        expect(entity.entity_type).toBeDefined();
        expect(entity.team).toBeDefined();
        expect(Array.isArray(entity.observations)).toBe(true);
      });
    });
  });
});
