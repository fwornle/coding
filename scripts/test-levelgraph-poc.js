#!/usr/bin/env node
/**
 * LevelGraph Proof-of-Concept Test
 *
 * Verifies LevelGraph installation and basic functionality before full integration.
 * Tests: Installation, triple storage, queries, traversal
 */

import levelgraph from 'levelgraph';
import { Level } from 'level';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPOC() {
  console.log('🔬 LevelGraph Proof-of-Concept Test\n');
  console.log('━'.repeat(60));

  // Step 1: Create test database
  const testDbPath = path.join(__dirname, '..', '.cache', 'test-levelgraph-poc');

  // Clean up previous test
  if (fs.existsSync(testDbPath)) {
    fs.rmSync(testDbPath, { recursive: true, force: true });
  }

  console.log('✓ Test database path:', testDbPath);

  // Step 2: Initialize LevelGraph
  let db, graph;
  try {
    db = new Level(testDbPath, { valueEncoding: 'json' });
    graph = levelgraph(db);
    console.log('✓ LevelGraph initialized successfully\n');
  } catch (error) {
    console.error('✗ Failed to initialize LevelGraph:', error.message);
    process.exit(1);
  }

  // Step 3: Test basic triple storage
  console.log('━'.repeat(60));
  console.log('Test 1: Store triples (entities + relationships)\n');

  const triples = [
    // Entity: JWT Pattern
    { subject: 'pattern:jwt', predicate: 'type', object: 'Pattern' },
    { subject: 'pattern:jwt', predicate: 'name', object: 'JWT Authentication' },
    { subject: 'pattern:jwt', predicate: 'confidence', object: '0.9' },
    { subject: 'pattern:jwt', predicate: 'team', object: 'coding' },
    { subject: 'pattern:jwt', predicate: 'observation:0', object: 'Uses RS256 algorithm' },
    { subject: 'pattern:jwt', predicate: 'observation:1', object: 'Requires secret key management' },

    // Entity: Session Management Pattern
    { subject: 'pattern:session', predicate: 'type', object: 'Pattern' },
    { subject: 'pattern:session', predicate: 'name', object: 'Session Management' },
    { subject: 'pattern:session', predicate: 'confidence', object: '0.8' },
    { subject: 'pattern:session', predicate: 'team', object: 'coding' },

    // Entity: Stateless Auth Problem
    { subject: 'problem:stateless-auth', predicate: 'type', object: 'Problem' },
    { subject: 'problem:stateless-auth', predicate: 'name', object: 'Stateless Authentication' },
    { subject: 'problem:stateless-auth', predicate: 'team', object: 'coding' },

    // Relationships
    { subject: 'pattern:jwt', predicate: 'implements', object: 'pattern:session' },
    { subject: 'pattern:jwt', predicate: 'solves', object: 'problem:stateless-auth' },
    { subject: 'pattern:session', predicate: 'related_to', object: 'problem:stateless-auth' }
  ];

  try {
    await new Promise((resolve, reject) => {
      graph.put(triples, function(err) {
        if (err) {
          console.error('Error in put callback:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
    console.log(`✓ Stored ${triples.length} triples successfully`);
  } catch (error) {
    console.error('✗ Failed to store triples:', error.message);
    console.error('Stack:', error.stack);
    await db.close();
    process.exit(1);
  }

  // Step 4: Test basic queries
  console.log('\n━'.repeat(60));
  console.log('Test 2: Query entity by subject\n');

  try {
    const jwtTriples = await new Promise((resolve, reject) => {
      graph.get({ subject: 'pattern:jwt' }, (err, triples) => {
        if (err) reject(err);
        else resolve(triples);
      });
    });

    console.log(`✓ Found ${jwtTriples.length} triples for pattern:jwt:`);
    jwtTriples.forEach(triple => {
      console.log(`  ${triple.subject} --${triple.predicate}--> ${triple.object}`);
    });
  } catch (error) {
    console.error('✗ Query failed:', error.message);
    await db.close();
    process.exit(1);
  }

  // Step 5: Test graph traversal (2-hop query)
  console.log('\n━'.repeat(60));
  console.log('Test 3: Graph traversal (find patterns solving problems)\n');

  try {
    // Find all patterns that solve problems
    const results = await new Promise((resolve, reject) => {
      graph.search([
        { subject: graph.v('pattern'), predicate: 'solves', object: graph.v('problem') },
        { subject: graph.v('problem'), predicate: 'name', object: graph.v('problem_name') }
      ], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    console.log(`✓ Found ${results.length} pattern-problem relationships:`);
    results.forEach(result => {
      console.log(`  ${result.pattern} solves ${result.problem} (${result.problem_name})`);
    });
  } catch (error) {
    console.error('✗ Traversal failed:', error.message);
    await db.close();
    process.exit(1);
  }

  // Step 6: Test filter queries
  console.log('\n━'.repeat(60));
  console.log('Test 4: Filter queries (get all entities of type Pattern)\n');

  try {
    const patterns = await new Promise((resolve, reject) => {
      graph.get({ predicate: 'type', object: 'Pattern' }, (err, triples) => {
        if (err) reject(err);
        else resolve(triples);
      });
    });

    console.log(`✓ Found ${patterns.length} patterns:`);
    patterns.forEach(triple => {
      console.log(`  ${triple.subject}`);
    });
  } catch (error) {
    console.error('✗ Filter query failed:', error.message);
    await db.close();
    process.exit(1);
  }

  // Step 7: Test relationship queries
  console.log('\n━'.repeat(60));
  console.log('Test 5: Relationship queries (find all "implements" relationships)\n');

  try {
    const relationships = await new Promise((resolve, reject) => {
      graph.get({ predicate: 'implements' }, (err, triples) => {
        if (err) reject(err);
        else resolve(triples);
      });
    });

    console.log(`✓ Found ${relationships.length} "implements" relationships:`);
    relationships.forEach(triple => {
      console.log(`  ${triple.subject} --implements--> ${triple.object}`);
    });
  } catch (error) {
    console.error('✗ Relationship query failed:', error.message);
    await db.close();
    process.exit(1);
  }

  // Step 8: Test multi-hop traversal
  console.log('\n━'.repeat(60));
  console.log('Test 6: Multi-hop traversal (2 hops from JWT pattern)\n');

  try {
    // Find: pattern:jwt -> implements -> ? -> related_to -> ?
    const multiHop = await new Promise((resolve, reject) => {
      graph.search([
        { subject: 'pattern:jwt', predicate: 'implements', object: graph.v('intermediate') },
        { subject: graph.v('intermediate'), predicate: 'related_to', object: graph.v('target') },
        { subject: graph.v('target'), predicate: 'name', object: graph.v('target_name') }
      ], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    console.log(`✓ Found ${multiHop.length} entities 2 hops from pattern:jwt:`);
    multiHop.forEach(result => {
      console.log(`  pattern:jwt -> ${result.intermediate} -> ${result.target} (${result.target_name})`);
    });
  } catch (error) {
    console.error('✗ Multi-hop traversal failed:', error.message);
    await db.close();
    process.exit(1);
  }

  // Cleanup
  await db.close();
  console.log('\n━'.repeat(60));
  console.log('✅ All tests passed! LevelGraph is ready for integration.\n');

  // Clean up test database
  fs.rmSync(testDbPath, { recursive: true, force: true });
  console.log('✓ Test database cleaned up');
}

// Run POC
runPOC().catch(error => {
  console.error('\n❌ POC failed:', error);
  process.exit(1);
});
