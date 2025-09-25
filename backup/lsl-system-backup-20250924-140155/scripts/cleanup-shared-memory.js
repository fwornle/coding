#!/usr/bin/env node
/**
 * Script to clean up duplicate relations in shared-memory.json
 */

const fs = require('fs');
const path = require('path');

const sharedMemoryPath = path.join(process.cwd(), 'shared-memory.json');

async function cleanupSharedMemory() {
    try {
        console.log('🔧 Cleaning up shared-memory.json...');
        
        // Read current file
        const data = JSON.parse(fs.readFileSync(sharedMemoryPath, 'utf8'));
        
        console.log(`📊 Current: ${data.entities.length} entities, ${data.relations.length} relations`);
        
        // Deduplicate entities by name
        const entityMap = new Map();
        for (const entity of data.entities) {
            if (!entityMap.has(entity.name) || !entityMap.get(entity.name).metadata?.last_updated) {
                entityMap.set(entity.name, entity);
            } else {
                // Keep the one with the latest update date
                const existing = entityMap.get(entity.name);
                const existingDate = new Date(existing.metadata?.last_updated || '2000-01-01');
                const newDate = new Date(entity.metadata?.last_updated || '2000-01-01');
                
                if (newDate > existingDate) {
                    entityMap.set(entity.name, entity);
                }
            }
        }
        
        // Deduplicate relations by from|relationType|to key
        const relationMap = new Map();
        for (const relation of data.relations) {
            const key = `${relation.from}|${relation.relationType}|${relation.to}`;
            if (!relationMap.has(key)) {
                relationMap.set(key, relation);
            }
        }
        
        // Create cleaned data
        const cleanedData = {
            entities: Array.from(entityMap.values()),
            relations: Array.from(relationMap.values()),
            metadata: {
                ...data.metadata,
                total_entities: entityMap.size,
                total_relations: relationMap.size,
                last_updated: new Date().toISOString(),
                cleanup_performed: new Date().toISOString()
            }
        };
        
        console.log(`✨ Cleaned: ${cleanedData.entities.length} entities, ${cleanedData.relations.length} relations`);
        console.log(`🗑️  Removed: ${data.entities.length - cleanedData.entities.length} duplicate entities, ${data.relations.length - cleanedData.relations.length} duplicate relations`);
        
        // Write cleaned file
        fs.writeFileSync(sharedMemoryPath, JSON.stringify(cleanedData, null, 2));
        
        console.log('✅ Cleanup complete!');
        
    } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    cleanupSharedMemory();
}

module.exports = cleanupSharedMemory;