#!/usr/bin/env node

/**
 * UKB Template Validation Script
 * Validates knowledge base entities conform to agent-friendly structure
 */

const fs = require('fs');
const path = require('path');

const SHARED_MEMORY_PATH = path.join(__dirname, 'shared-memory.json');

function validateQuickReference(entity) {
  const { quick_reference } = entity;
  const errors = [];
  
  if (!quick_reference) {
    if (entity.entityType === 'TransferablePattern' || entity.entityType === 'WorkflowPattern') {
      errors.push(`Missing quick_reference for ${entity.name}`);
    }
    return errors;
  }
  
  const required = ['trigger', 'action', 'avoid', 'check'];
  required.forEach(field => {
    if (!quick_reference[field]) {
      errors.push(`Missing quick_reference.${field} for ${entity.name}`);
    }
  });
  
  return errors;
}

function validateObservations(entity) {
  const errors = [];
  
  if (!entity.observations || !Array.isArray(entity.observations)) {
    errors.push(`Missing or invalid observations array for ${entity.name}`);
    return errors;
  }
  
  // Check for structured observations
  const hasStructuredObs = entity.observations.some(obs => 
    typeof obs === 'object' && obs.type && obs.content && obs.date
  );
  
  if (!hasStructuredObs && entity.entityType === 'TransferablePattern') {
    errors.push(`${entity.name} should use structured observations with type/content/date`);
  }
  
  // Check for required observation types
  if (entity.entityType === 'TransferablePattern') {
    const types = entity.observations.map(obs => obs.type).filter(Boolean);
    if (!types.includes('rule') && !types.includes('implementation')) {
      errors.push(`${entity.name} missing rule or implementation observation`);
    }
    if (!types.includes('link')) {
      errors.push(`${entity.name} missing link to detailed documentation`);
    }
  }
  
  return errors;
}

function validateAgentFriendliness(entity) {
  const errors = [];
  
  // Check for concise, actionable content
  if (entity.observations) {
    entity.observations.forEach((obs, idx) => {
      if (typeof obs === 'object' && obs.content) {
        if (obs.content.length > 200 && obs.type !== 'link') {
          errors.push(`${entity.name} observation ${idx} too verbose (${obs.content.length} chars)`);
        }
      }
    });
  }
  
  return errors;
}

function validateEntity(entity) {
  const errors = [];
  
  errors.push(...validateQuickReference(entity));
  errors.push(...validateObservations(entity));
  errors.push(...validateAgentFriendliness(entity));
  
  return errors;
}

function main() {
  try {
    const data = JSON.parse(fs.readFileSync(SHARED_MEMORY_PATH, 'utf8'));
    let totalErrors = 0;
    
    console.log('🔍 Validating Knowledge Base Structure...\n');
    
    data.entities.forEach(entity => {
      const errors = validateEntity(entity);
      if (errors.length > 0) {
        console.log(`❌ ${entity.name} (${entity.entityType}):`);
        errors.forEach(error => console.log(`   • ${error}`));
        console.log();
        totalErrors += errors.length;
      } else {
        console.log(`✅ ${entity.name} - Valid structure`);
      }
    });
    
    console.log(`\n📊 Validation Summary:`);
    console.log(`   Total entities: ${data.entities.length}`);
    console.log(`   Entities with issues: ${data.entities.filter(e => validateEntity(e).length > 0).length}`);
    console.log(`   Total errors: ${totalErrors}`);
    
    if (totalErrors === 0) {
      console.log('\n🎉 All entities conform to agent-friendly structure!');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some entities need restructuring for optimal agent consumption.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Validation failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateEntity };