#!/usr/bin/env node
/**
 * Simplified LevelGraph Test - Check for compatibility issues
 */

import levelgraph from 'levelgraph';
import { Level } from 'level';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function test() {
  console.log('Testing LevelGraph basic compatibility...\n');

  const testDbPath = path.join(__dirname, '..', '.cache', 'test-lg-simple');

  // Clean up
  if (fs.existsSync(testDbPath)) {
    fs.rmSync(testDbPath, { recursive: true, force: true });
  }

  try {
    // Create Level database
    console.log('1. Creating Level database...');
    const levelDB = new Level(testDbPath);

    // Wait for Level to open
    console.log('2. Waiting for Level to open...');
    await levelDB.open();
    console.log('   ✓ Level database opened');

    // Create LevelGraph on top
    console.log('3. Creating LevelGraph instance...');
    const db = levelgraph(levelDB);
    console.log('   ✓ LevelGraph created');

    // Test simple put
    console.log('4. Testing simple triple storage...');
    const triple = { subject: 'test', predicate: 'type', object: 'Test' };

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Put operation timed out after 5 seconds'));
      }, 5000);

      db.put([triple], (err) => {
        clearTimeout(timeout);
        if (err) {
          console.error('   ✗ Put error:', err);
          reject(err);
        } else {
          console.log('   ✓ Triple stored');
          resolve();
        }
      });
    });

    // Test simple get
    console.log('5. Testing simple query...');
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Get operation timed out after 5 seconds'));
      }, 5000);

      db.get({ subject: 'test' }, (err, triples) => {
        clearTimeout(timeout);
        if (err) {
          console.error('   ✗ Get error:', err);
          reject(err);
        } else {
          console.log(`   ✓ Retrieved ${triples.length} triple(s)`);
          resolve(triples);
        }
      });
    });

    // Close
    console.log('6. Closing database...');
    await levelDB.close();
    console.log('   ✓ Database closed');

    // Cleanup
    fs.rmSync(testDbPath, { recursive: true, force: true });

    console.log('\n✅ SUCCESS: LevelGraph is working correctly!\n');
    console.log('Result:', result);

    return true;
  } catch (error) {
    console.error('\n❌ FAILURE:', error.message);
    console.error('Stack:', error.stack);

    // Try to cleanup
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

test().then(success => {
  process.exit(success ? 0 : 1);
});
