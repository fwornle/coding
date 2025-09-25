#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read shared-memory.json
const filePath = path.join(__dirname, '..', 'shared-memory.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

console.log('🔍 Deduplicating observations...');
console.log(`📊 Before: ${data.entities.length} entities`);

let totalObsBefore = 0;
let totalObsAfter = 0;
let entitiesModified = 0;

// Process each entity
data.entities.forEach(entity => {
    if (entity.observations && Array.isArray(entity.observations)) {
        const originalCount = entity.observations.length;
        totalObsBefore += originalCount;
        
        // Deduplicate based on content for structured observations
        if (originalCount > 0 && typeof entity.observations[0] === 'object') {
            const seen = new Set();
            entity.observations = entity.observations.filter(obs => {
                const key = obs.content || JSON.stringify(obs);
                if (seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            });
        } else {
            // Simple string deduplication
            entity.observations = [...new Set(entity.observations)];
        }
        
        const newCount = entity.observations.length;
        totalObsAfter += newCount;
        
        if (originalCount > newCount) {
            entitiesModified++;
            console.log(`  📝 ${entity.name}: ${originalCount} → ${newCount} observations`);
        }
    }
});

// Update timestamp
data.metadata = data.metadata || {};
data.metadata.last_updated = new Date().toISOString();

// Create backup
const backupPath = `${filePath}.backup.obs-dedup.${Date.now()}`;
fs.writeFileSync(backupPath, fs.readFileSync(filePath));
console.log(`💾 Backup created: ${backupPath}`);

// Write cleaned data
fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

console.log(`\n✅ Deduplication complete!`);
console.log(`📊 Summary:`);
console.log(`  • Entities modified: ${entitiesModified}/${data.entities.length}`);
console.log(`  • Total observations: ${totalObsBefore} → ${totalObsAfter}`);
console.log(`  • Observations removed: ${totalObsBefore - totalObsAfter}`);
console.log(`  • Space saved: ${((totalObsBefore - totalObsAfter) / totalObsBefore * 100).toFixed(1)}%`);