#!/usr/bin/env node
/**
 * Level Database Compatibility Test
 *
 * Verifies that Level v10.0.0 works correctly with Node.js 24.5.0
 *
 * IMPORTANT: We use Level (v10.0.0) for graph database persistence.
 * We do NOT use LevelGraph due to incompatibility with Node.js 24+.
 *
 * Test coverage:
 * - Create database
 * - Write data (put)
 * - Read data (get)
 * - Close database
 * - Persistence (reopen and verify data)
 * - Cleanup
 */

import { Level } from 'level';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testLevelDB() {
  console.log('🔬 Testing Level Database Compatibility\n');
  console.log('━'.repeat(60));

  const testDbPath = path.join(__dirname, '..', '.cache', 'test-level-db');

  // Clean up any existing test database
  if (fs.existsSync(testDbPath)) {
    console.log('🧹 Cleaning up existing test database...');
    fs.rmSync(testDbPath, { recursive: true, force: true });
  }

  try {
    // Test 1: Create database
    console.log('\n✓ Test 1: Create Level database');
    const db = new Level(testDbPath, { valueEncoding: 'json' });
    console.log(`  Database created at: ${testDbPath}`);

    // Test 2: Write data
    console.log('\n✓ Test 2: Write data (put)');
    await db.put('test-key-1', { name: 'Test Entity', type: 'Pattern', confidence: 0.9 });
    await db.put('test-key-2', { name: 'Another Entity', type: 'Problem', confidence: 0.8 });
    console.log('  Written 2 test entries');

    // Test 3: Read data
    console.log('\n✓ Test 3: Read data (get)');
    const entity1 = await db.get('test-key-1');
    const entity2 = await db.get('test-key-2');
    console.log(`  Read test-key-1:`, entity1);
    console.log(`  Read test-key-2:`, entity2);

    // Verify data correctness
    if (entity1.name !== 'Test Entity' || entity1.confidence !== 0.9) {
      throw new Error('Data integrity check failed for test-key-1');
    }
    if (entity2.name !== 'Another Entity' || entity2.type !== 'Problem') {
      throw new Error('Data integrity check failed for test-key-2');
    }
    console.log('  Data integrity verified ✓');

    // Test 4: Close database
    console.log('\n✓ Test 4: Close database');
    await db.close();
    console.log('  Database closed successfully');

    // Test 5: Persistence (reopen and verify)
    console.log('\n✓ Test 5: Verify persistence');
    const db2 = new Level(testDbPath, { valueEncoding: 'json' });
    const persistedEntity = await db2.get('test-key-1');
    console.log(`  Reopened database and read:`, persistedEntity);

    if (persistedEntity.name !== 'Test Entity') {
      throw new Error('Persistence check failed - data not persisted correctly');
    }
    console.log('  Persistence verified ✓');

    await db2.close();

    // Test 6: Cleanup
    console.log('\n✓ Test 6: Cleanup');
    fs.rmSync(testDbPath, { recursive: true, force: true });
    console.log('  Test database removed');

    // Success
    console.log('\n' + '━'.repeat(60));
    console.log('✅ SUCCESS: Level v10.0.0 is compatible with Node.js ' + process.version);
    console.log('━'.repeat(60));
    console.log('\n📝 Notes:');
    console.log('  - Level v10.0.0: ✅ Compatible with Node.js 24+');
    console.log('  - LevelGraph: ❌ NOT compatible with Node.js 24+ (do not use)');
    console.log('  - Using Level for graph database persistence layer\n');

    return true;

  } catch (error) {
    console.error('\n' + '━'.repeat(60));
    console.error('❌ FAILURE: Level database test failed');
    console.error('━'.repeat(60));
    console.error('\nError:', error.message);
    console.error('Stack:', error.stack);
    console.error('\nNode.js version:', process.version);
    console.error('Level version: Check package.json\n');

    // Cleanup on error
    try {
      if (fs.existsSync(testDbPath)) {
        fs.rmSync(testDbPath, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    return false;
  }
}

// Run test
testLevelDB().then(success => {
  process.exit(success ? 0 : 1);
});
