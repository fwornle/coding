# LSL System Migration Guide

A comprehensive guide for migrating existing Live Session Logging (LSL) files to the new enhanced filename format with USER hash support and improved organization.

## Overview

The enhanced LSL system introduces new filename patterns and organizational improvements to support multi-user environments and better cross-project routing. This guide provides complete migration procedures, validation tools, and rollback options.

## Migration Requirements

### What's Changing

The LSL system filename format is evolving to support multi-user environments and improved organization:

**Old Format:**
```
2025-06-16_13-32Z-clarification-on-code-assistance-request.md
2025-06-16_1330-1430-session.md
2025-09-01_0000-0100-session-from-nano-degree.md
```

**New Format:**
```
2025-09-14_0800-0900_a1b2c3_from-nano-degree.md
```

### Key Changes
1. **USER Hash Integration**: 6-digit hash prevents filename collisions in multi-user environments
2. **Simplified Naming**: Removes "session" keyword for cleaner organization
3. **Consistent Separators**: Uses underscores for better parsing
4. **Cross-Project Standardization**: Uniform format for all project routing

### Why Migrate?

- **Multi-User Support**: Prevents filename conflicts when multiple users work on same projects
- **Improved Organization**: Cleaner, more predictable filename patterns
- **Enhanced File Management**: Better integration with new LSL File Manager features
- **Future Compatibility**: Ensures compatibility with upcoming LSL enhancements

## Pre-Migration Assessment

### Step 1: Inventory Existing Files

Run the assessment script to analyze your current LSL files:

```bash
# Navigate to your project root
cd /path/to/your/project

# Create and run the assessment script
cat > scripts/assess-lsl-migration.js << 'EOF'
#!/usr/bin/env node

/**
 * LSL Migration Assessment Tool
 * 
 * Analyzes existing LSL files and provides migration planning information
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class LSLMigrationAssessment {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.historyDir = path.join(projectPath, '.specstory', 'history');
    this.results = {
      totalFiles: 0,
      filesByFormat: {},
      needsMigration: [],
      alreadyMigrated: [],
      errors: []
    };
  }

  async assessProject() {
    console.log('=== LSL Migration Assessment ===\n');
    console.log(`Project: ${this.projectPath}`);
    console.log(`History Directory: ${this.historyDir}\n`);

    if (!fs.existsSync(this.historyDir)) {
      console.log('❌ No .specstory/history directory found');
      console.log('   This project may not have LSL files to migrate\n');
      return this.results;
    }

    const files = fs.readdirSync(this.historyDir)
      .filter(file => file.endsWith('.md'))
      .sort();

    this.results.totalFiles = files.length;

    console.log(`Found ${files.length} LSL files to assess:\n`);

    for (const file of files) {
      this.assessFile(file);
    }

    this.generateReport();
    return this.results;
  }

  assessFile(filename) {
    const format = this.detectFormat(filename);
    
    if (!this.results.filesByFormat[format]) {
      this.results.filesByFormat[format] = [];
    }
    this.results.filesByFormat[format].push(filename);

    if (format === 'new') {
      this.results.alreadyMigrated.push(filename);
      console.log(`✅ ${filename} (already migrated)`);
    } else {
      this.results.needsMigration.push(filename);
      console.log(`🔄 ${filename} (needs migration) - ${format} format`);
    }
  }

  detectFormat(filename) {
    // New format: 2025-09-14_0800-0900_a1b2c3_from-nano-degree.md
    if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{4}_[a-z0-9]{6}_from-\w+\.md$/.test(filename)) {
      return 'new';
    }
    
    // Current session format: 2025-06-16_1330-1430-session.md
    if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{4}-session\.md$/.test(filename)) {
      return 'current-session';
    }
    
    // Cross-project session format: 2025-09-01_0000-0100-session-from-nano-degree.md
    if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{4}-session-from-\w+\.md$/.test(filename)) {
      return 'cross-project-session';
    }
    
    // Legacy descriptive format: 2025-06-16_13-32Z-clarification-on-code-assistance-request.md
    if (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}Z-.+\.md$/.test(filename)) {
      return 'legacy-descriptive';
    }
    
    return 'unknown';
  }

  generateUserHash(username = process.env.USER || 'default') {
    return crypto.createHash('sha256')
      .update(username)
      .digest('hex')
      .substring(0, 6);
  }

  generateReport() {
    console.log('\n=== Migration Assessment Report ===\n');
    
    console.log(`📊 Summary:`);
    console.log(`   Total files: ${this.results.totalFiles}`);
    console.log(`   Need migration: ${this.results.needsMigration.length}`);
    console.log(`   Already migrated: ${this.results.alreadyMigrated.length}\n`);

    console.log('📋 Files by format:');
    Object.entries(this.results.filesByFormat).forEach(([format, files]) => {
      console.log(`   ${format}: ${files.length} files`);
    });

    if (this.results.needsMigration.length > 0) {
      console.log(`\n🔄 Migration Required:`);
      console.log(`   ${this.results.needsMigration.length} files need migration`);
      console.log(`   Estimated USER hash: ${this.generateUserHash()}`);
      console.log(`   USER environment: ${process.env.USER || 'not set'}`);
    } else {
      console.log(`\n✅ No Migration Needed:`);
      console.log(`   All files are already in the new format`);
    }

    console.log(`\n📁 Migration will create backup in:`);
    console.log(`   ${path.join(this.projectPath, '.specstory', 'migration-backup')}`);

    console.log(`\n🚀 Next steps:`);
    if (this.results.needsMigration.length > 0) {
      console.log(`   1. Set USER environment variable if not already set`);
      console.log(`   2. Run migration script: node scripts/migrate-lsl-files.js`);
      console.log(`   3. Validate migration results`);
    } else {
      console.log(`   No migration needed - your LSL files are up to date!`);
    }
  }
}

// Run assessment if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const projectPath = process.argv[2] || process.cwd();
  const assessment = new LSLMigrationAssessment(projectPath);
  await assessment.assessProject();
}

export { LSLMigrationAssessment };
EOF

# Make executable and run
chmod +x scripts/assess-lsl-migration.js
node scripts/assess-lsl-migration.js
```

### Step 2: Environment Preparation

Before migration, ensure your environment is properly configured:

```bash
# Check USER environment variable
echo "Current USER: ${USER:-'not set'}"

# Set USER if not available (required for hash generation)
if [ -z "$USER" ]; then
    export USER=$(whoami)
    echo "USER set to: $USER"
fi

# Verify USER hash that will be used
node -e "
const crypto = require('crypto');
const hash = crypto.createHash('sha256').update('${USER}').digest('hex').substring(0, 6);
console.log('USER hash for filenames:', hash);
"
```

### Step 3: Backup Creation

**CRITICAL**: Always create backups before migration:

```bash
# Create backup directory
mkdir -p .specstory/migration-backup/$(date +%Y-%m-%d_%H-%M-%S)

# Copy all existing LSL files
cp -r .specstory/history/* .specstory/migration-backup/$(date +%Y-%m-%d_%H-%M-%S)/

# Verify backup
echo "Backup created with $(ls -1 .specstory/migration-backup/$(date +%Y-%m-%d_%H-%M-%S)/ | wc -l) files"
```

## Migration Process

### Step 1: Create Migration Script

Create the comprehensive migration script:

```bash
cat > scripts/migrate-lsl-files.js << 'EOF'
#!/usr/bin/env node

/**
 * LSL File Migration Script
 * 
 * Migrates existing LSL files to the new filename format with USER hash support
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class LSLFileMigrator {
  constructor(projectPath, options = {}) {
    this.projectPath = projectPath;
    this.historyDir = path.join(projectPath, '.specstory', 'history');
    this.backupDir = path.join(projectPath, '.specstory', 'migration-backup', 
                              new Date().toISOString().replace(/[:.]/g, '-'));
    
    this.options = {
      dryRun: options.dryRun || false,
      createBackup: options.createBackup !== false,
      validateResults: options.validateResults !== false,
      verbose: options.verbose || false,
      userHash: options.userHash || this.generateUserHash()
    };

    this.stats = {
      processed: 0,
      migrated: 0,
      skipped: 0,
      errors: 0,
      backupCreated: false
    };
  }

  generateUserHash(username = process.env.USER || 'default') {
    return crypto.createHash('sha256')
      .update(username)
      .digest('hex')
      .substring(0, 6);
  }

  async migrate() {
    console.log('=== LSL File Migration ===\n');
    console.log(`Project: ${this.projectPath}`);
    console.log(`USER hash: ${this.options.userHash}`);
    console.log(`Dry run: ${this.options.dryRun}\n`);

    if (!fs.existsSync(this.historyDir)) {
      throw new Error(`History directory not found: ${this.historyDir}`);
    }

    // Create backup if enabled
    if (this.options.createBackup && !this.options.dryRun) {
      await this.createBackup();
    }

    // Get all LSL files
    const files = fs.readdirSync(this.historyDir)
      .filter(file => file.endsWith('.md'))
      .sort();

    console.log(`Found ${files.length} LSL files to process\n`);

    // Process each file
    for (const file of files) {
      await this.migrateFile(file);
    }

    this.generateReport();
    return this.stats;
  }

  async createBackup() {
    if (!fs.existsSync(path.dirname(this.backupDir))) {
      fs.mkdirSync(path.dirname(this.backupDir), { recursive: true });
    }
    fs.mkdirSync(this.backupDir, { recursive: true });

    const files = fs.readdirSync(this.historyDir)
      .filter(file => file.endsWith('.md'));

    for (const file of files) {
      const srcPath = path.join(this.historyDir, file);
      const backupPath = path.join(this.backupDir, file);
      fs.copyFileSync(srcPath, backupPath);
    }

    this.stats.backupCreated = true;
    console.log(`✅ Backup created: ${this.backupDir}`);
    console.log(`   ${files.length} files backed up\n`);
  }

  async migrateFile(filename) {
    this.stats.processed++;
    
    try {
      const newFilename = this.generateNewFilename(filename);
      
      if (newFilename === filename) {
        if (this.options.verbose) {
          console.log(`⏭️  ${filename} (already in new format)`);
        }
        this.stats.skipped++;
        return;
      }

      if (this.options.dryRun) {
        console.log(`🔄 ${filename} → ${newFilename} (dry run)`);
      } else {
        const oldPath = path.join(this.historyDir, filename);
        const newPath = path.join(this.historyDir, newFilename);

        // Check if target file already exists
        if (fs.existsSync(newPath)) {
          console.log(`⚠️  ${filename} → SKIPPED (target exists: ${newFilename})`);
          this.stats.skipped++;
          return;
        }

        // Rename the file
        fs.renameSync(oldPath, newPath);
        console.log(`✅ ${filename} → ${newFilename}`);
      }

      this.stats.migrated++;

    } catch (error) {
      console.log(`❌ ${filename} → ERROR: ${error.message}`);
      this.stats.errors++;
    }
  }

  generateNewFilename(oldFilename) {
    // Already in new format
    if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{4}_[a-z0-9]{6}_from-\w+\.md$/.test(oldFilename)) {
      return oldFilename;
    }

    let match;
    
    // Current session format: 2025-06-16_1330-1430-session.md
    match = oldFilename.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{4})-session\.md$/);
    if (match) {
      const [, date, timeWindow] = match;
      return `${date}_${timeWindow}_${this.options.userHash}.md`;
    }

    // Cross-project session format: 2025-09-01_0000-0100-session-from-nano-degree.md
    match = oldFilename.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{4})-session-from-(.+)\.md$/);
    if (match) {
      const [, date, timeWindow, project] = match;
      return `${date}_${timeWindow}_${this.options.userHash}_from-${project}.md`;
    }

    // Legacy descriptive format: 2025-06-16_13-32Z-clarification-on-code-assistance-request.md
    match = oldFilename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})Z-(.+)\.md$/);
    if (match) {
      const [, date, hour, minute] = match;
      // Convert to hour window format (assume 1-hour sessions)
      const startHour = hour.padStart(2, '0') + minute.padStart(2, '0');
      const endHour = (parseInt(hour) + 1).toString().padStart(2, '0') + minute.padStart(2, '0');
      return `${date}_${startHour}-${endHour}_${this.options.userHash}.md`;
    }

    // If no pattern matches, return original filename
    console.log(`⚠️  Unknown format: ${oldFilename}`);
    return oldFilename;
  }

  generateReport() {
    console.log('\n=== Migration Report ===\n');
    console.log(`📊 Statistics:`);
    console.log(`   Files processed: ${this.stats.processed}`);
    console.log(`   Files migrated: ${this.stats.migrated}`);
    console.log(`   Files skipped: ${this.stats.skipped}`);
    console.log(`   Errors: ${this.stats.errors}`);

    if (this.stats.backupCreated) {
      console.log(`\n💾 Backup location: ${this.backupDir}`);
    }

    if (this.options.dryRun) {
      console.log(`\n🏃 This was a dry run - no files were modified`);
      console.log(`   Remove --dry-run flag to perform actual migration`);
    } else if (this.stats.migrated > 0) {
      console.log(`\n✅ Migration completed successfully!`);
      console.log(`   Run validation: node scripts/validate-migration.js`);
    } else if (this.stats.errors > 0) {
      console.log(`\n❌ Migration completed with errors`);
      console.log(`   Check error messages above for details`);
    } else {
      console.log(`\n✨ No migration needed - all files already in correct format`);
    }
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
    createBackup: !args.includes('--no-backup')
  };

  const projectPath = args.find(arg => !arg.startsWith('--')) || process.cwd();
  
  try {
    const migrator = new LSLFileMigrator(projectPath, options);
    await migrator.migrate();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

export { LSLFileMigrator };
EOF

chmod +x scripts/migrate-lsl-files.js
```

### Step 2: Dry Run Migration

**Always perform a dry run first** to preview changes:

```bash
# Perform dry run migration
node scripts/migrate-lsl-files.js --dry-run --verbose

# Review the output carefully
# Ensure all filename transformations look correct
```

### Step 3: Execute Migration

Once you're satisfied with the dry run results:

```bash
# Execute the actual migration
node scripts/migrate-lsl-files.js

# The script will:
# 1. Create automatic backup
# 2. Migrate all files to new format
# 3. Provide detailed report
```

## Validation and Testing

### Step 1: Create Validation Script

```bash
cat > scripts/validate-migration.js << 'EOF'
#!/usr/bin/env node

/**
 * LSL Migration Validation Script
 * 
 * Validates that migration was successful and files are accessible
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class MigrationValidator {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.historyDir = path.join(projectPath, '.specstory', 'history');
    this.results = {
      totalFiles: 0,
      validFiles: 0,
      invalidFiles: [],
      emptyFiles: [],
      corruptedFiles: [],
      errors: []
    };
  }

  async validate() {
    console.log('=== Migration Validation ===\n');
    console.log(`Validating: ${this.historyDir}\n`);

    if (!fs.existsSync(this.historyDir)) {
      throw new Error(`History directory not found: ${this.historyDir}`);
    }

    const files = fs.readdirSync(this.historyDir)
      .filter(file => file.endsWith('.md'))
      .sort();

    this.results.totalFiles = files.length;
    console.log(`Found ${files.length} LSL files to validate\n`);

    for (const file of files) {
      this.validateFile(file);
    }

    this.generateValidationReport();
    return this.results;
  }

  validateFile(filename) {
    try {
      // Validate filename format
      const formatValid = this.validateFormat(filename);
      const filePath = path.join(this.historyDir, filename);
      
      // Validate file exists and is readable
      if (!fs.existsSync(filePath)) {
        this.results.invalidFiles.push({ file: filename, reason: 'File not found' });
        console.log(`❌ ${filename} - File not found`);
        return;
      }

      // Validate file content
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        this.results.emptyFiles.push(filename);
        console.log(`⚠️  ${filename} - Empty file`);
        return;
      }

      // Try to read file content
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.trim().length === 0) {
          this.results.emptyFiles.push(filename);
          console.log(`⚠️  ${filename} - No content`);
          return;
        }
      } catch (readError) {
        this.results.corruptedFiles.push({ file: filename, error: readError.message });
        console.log(`❌ ${filename} - Read error: ${readError.message}`);
        return;
      }

      if (formatValid) {
        this.results.validFiles++;
        console.log(`✅ ${filename} - Valid`);
      } else {
        this.results.invalidFiles.push({ file: filename, reason: 'Invalid format' });
        console.log(`⚠️  ${filename} - Format not updated`);
      }

    } catch (error) {
      this.results.errors.push({ file: filename, error: error.message });
      console.log(`❌ ${filename} - Validation error: ${error.message}`);
    }
  }

  validateFormat(filename) {
    // New format: 2025-09-14_0800-0900_a1b2c3_from-nano-degree.md
    if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{4}_[a-z0-9]{6}_from-\w+\.md$/.test(filename)) {
      return true;
    }
    
    // New format without cross-project: 2025-09-14_0800-0900_a1b2c3.md
    if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{4}_[a-z0-9]{6}\.md$/.test(filename)) {
      return true;
    }

    return false;
  }

  generateValidationReport() {
    console.log('\n=== Validation Report ===\n');
    
    const successRate = ((this.results.validFiles / this.results.totalFiles) * 100).toFixed(1);
    
    console.log(`📊 Summary:`);
    console.log(`   Total files: ${this.results.totalFiles}`);
    console.log(`   Valid files: ${this.results.validFiles}`);
    console.log(`   Success rate: ${successRate}%\n`);

    if (this.results.invalidFiles.length > 0) {
      console.log(`⚠️  Invalid files (${this.results.invalidFiles.length}):`);
      this.results.invalidFiles.forEach(({ file, reason }) => {
        console.log(`   ${file} - ${reason}`);
      });
      console.log('');
    }

    if (this.results.emptyFiles.length > 0) {
      console.log(`⚠️  Empty files (${this.results.emptyFiles.length}):`);
      this.results.emptyFiles.forEach(file => {
        console.log(`   ${file}`);
      });
      console.log('');
    }

    if (this.results.corruptedFiles.length > 0) {
      console.log(`❌ Corrupted files (${this.results.corruptedFiles.length}):`);
      this.results.corruptedFiles.forEach(({ file, error }) => {
        console.log(`   ${file} - ${error}`);
      });
      console.log('');
    }

    if (this.results.errors.length > 0) {
      console.log(`❌ Validation errors (${this.results.errors.length}):`);
      this.results.errors.forEach(({ file, error }) => {
        console.log(`   ${file} - ${error}`);
      });
      console.log('');
    }

    // Overall result
    if (this.results.validFiles === this.results.totalFiles) {
      console.log(`✅ Migration validation PASSED`);
      console.log(`   All files successfully migrated and validated\n`);
    } else {
      console.log(`⚠️  Migration validation completed with issues`);
      console.log(`   ${this.results.totalFiles - this.results.validFiles} files need attention\n`);
    }

    // Next steps
    console.log(`🚀 Next steps:`);
    if (this.results.validFiles === this.results.totalFiles) {
      console.log(`   Migration complete! Your LSL system is ready`);
      console.log(`   Test with: node scripts/enhanced-transcript-monitor.js --test`);
    } else {
      console.log(`   1. Review files with issues listed above`);
      console.log(`   2. Re-run migration for problematic files if needed`);
      console.log(`   3. Consider manual correction for edge cases`);
    }
  }
}

// Run validation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const projectPath = process.argv[2] || process.cwd();
  try {
    const validator = new MigrationValidator(projectPath);
    const results = await validator.validate();
    process.exit(results.validFiles === results.totalFiles ? 0 : 1);
  } catch (error) {
    console.error('Validation failed:', error.message);
    process.exit(1);
  }
}

export { MigrationValidator };
EOF

chmod +x scripts/validate-migration.js
```

### Step 2: Run Validation

```bash
# Validate the migration results
node scripts/validate-migration.js

# If validation passes, test LSL system functionality
node scripts/enhanced-transcript-monitor.js --test
```

## Rollback Procedures

### When to Rollback

Consider rolling back if:
- Validation shows significant file corruption
- New LSL system doesn't recognize migrated files
- Critical files are missing or inaccessible
- System functionality is impaired

### Rollback Process

```bash
cat > scripts/rollback-migration.js << 'EOF'
#!/usr/bin/env node

/**
 * LSL Migration Rollback Script
 * 
 * Restores LSL files from migration backup
 */

import fs from 'fs';
import path from 'path';

class MigrationRollback {
  constructor(projectPath, backupTimestamp) {
    this.projectPath = projectPath;
    this.historyDir = path.join(projectPath, '.specstory', 'history');
    this.backupDir = backupTimestamp ? 
      path.join(projectPath, '.specstory', 'migration-backup', backupTimestamp) :
      this.findLatestBackup(projectPath);
    
    this.stats = {
      restored: 0,
      errors: 0,
      backupSize: 0
    };
  }

  findLatestBackup(projectPath) {
    const backupBase = path.join(projectPath, '.specstory', 'migration-backup');
    if (!fs.existsSync(backupBase)) {
      throw new Error('No migration backups found');
    }

    const backups = fs.readdirSync(backupBase)
      .filter(dir => fs.statSync(path.join(backupBase, dir)).isDirectory())
      .sort()
      .reverse();

    if (backups.length === 0) {
      throw new Error('No backup directories found');
    }

    return path.join(backupBase, backups[0]);
  }

  async rollback() {
    console.log('=== LSL Migration Rollback ===\n');
    console.log(`Project: ${this.projectPath}`);
    console.log(`Backup: ${this.backupDir}\n`);

    if (!fs.existsSync(this.backupDir)) {
      throw new Error(`Backup directory not found: ${this.backupDir}`);
    }

    // Get backup files
    const backupFiles = fs.readdirSync(this.backupDir)
      .filter(file => file.endsWith('.md'));

    this.stats.backupSize = backupFiles.length;
    console.log(`Found ${backupFiles.length} files in backup\n`);

    // Clear current history directory
    if (fs.existsSync(this.historyDir)) {
      const currentFiles = fs.readdirSync(this.historyDir)
        .filter(file => file.endsWith('.md'));
      
      console.log(`Removing ${currentFiles.length} current files...`);
      currentFiles.forEach(file => {
        fs.unlinkSync(path.join(this.historyDir, file));
      });
    } else {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }

    // Restore from backup
    console.log(`Restoring ${backupFiles.length} files from backup...\n`);
    
    for (const file of backupFiles) {
      try {
        const backupPath = path.join(this.backupDir, file);
        const restorePath = path.join(this.historyDir, file);
        
        fs.copyFileSync(backupPath, restorePath);
        console.log(`✅ Restored: ${file}`);
        this.stats.restored++;
        
      } catch (error) {
        console.log(`❌ Failed to restore ${file}: ${error.message}`);
        this.stats.errors++;
      }
    }

    this.generateRollbackReport();
    return this.stats;
  }

  generateRollbackReport() {
    console.log('\n=== Rollback Report ===\n');
    console.log(`📊 Statistics:`);
    console.log(`   Backup files: ${this.stats.backupSize}`);
    console.log(`   Files restored: ${this.stats.restored}`);
    console.log(`   Errors: ${this.stats.errors}\n`);

    if (this.stats.errors === 0) {
      console.log(`✅ Rollback completed successfully!`);
      console.log(`   All files restored from backup`);
      console.log(`   Your LSL files are back to pre-migration state\n`);
    } else {
      console.log(`⚠️  Rollback completed with errors`);
      console.log(`   ${this.stats.errors} files could not be restored\n`);
    }

    console.log(`📁 Backup preserved at: ${this.backupDir}`);
    console.log(`🔄 You can re-attempt migration after resolving issues`);
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const projectPath = args.find(arg => !arg.startsWith('--')) || process.cwd();
  const backupTimestamp = args.find(arg => arg.startsWith('--backup='))?.split('=')[1];

  try {
    const rollback = new MigrationRollback(projectPath, backupTimestamp);
    await rollback.rollback();
    process.exit(0);
  } catch (error) {
    console.error('Rollback failed:', error.message);
    process.exit(1);
  }
}

export { MigrationRollback };
EOF

chmod +x scripts/rollback-migration.js
```

### Execute Rollback

```bash
# List available backups
ls -la .specstory/migration-backup/

# Rollback to latest backup
node scripts/rollback-migration.js

# Or rollback to specific backup
node scripts/rollback-migration.js --backup=2025-09-14_15-30-00
```

## Post-Migration Tasks

### 1. Update Configuration

Ensure your LSL system is configured for the new filename format:

```bash
# Update any configuration files that reference old patterns
# Check for hardcoded filename patterns in:
grep -r "session\.md" .specstory/config/ || echo "No old patterns found in config"
grep -r "\-session\-" scripts/ || echo "No old patterns found in scripts"
```

### 2. Test LSL System

Verify the enhanced LSL system works with migrated files:

```bash
# Test real-time monitoring
DEBUG_STATUS=1 node scripts/enhanced-transcript-monitor.js --test

# Test batch processing with migrated files
node scripts/generate-proper-lsl-from-transcripts.js --mode=local --test

# Verify cross-project routing still works
ls -la .specstory/history/*from-*.md
```

### 3. Update Documentation

Update any project-specific documentation that references old filename patterns.

## Troubleshooting

### Common Migration Issues

**Issue: "USER environment variable not set"**
```bash
# Solution: Set USER variable
export USER=$(whoami)
echo "USER set to: $USER"
```

**Issue: "Target file already exists"**
```bash
# This happens when multiple old files would map to same new filename
# Solution: Manually resolve conflicts or use different USER hash
# List conflicting files:
node scripts/assess-lsl-migration.js | grep "target exists"
```

**Issue: "Unknown format detected"**
```bash
# Some files don't match expected patterns
# Solution: Check file manually and update migration script if needed
ls -la .specstory/history/ | grep -v "session\|from-\|\d{4}-\d{4}"
```

**Issue: "Migration validation failed"**
```bash
# Some files failed validation
# Solution: Check specific error messages and re-run migration for failed files
node scripts/validate-migration.js 2>&1 | grep "❌\|⚠️"
```

### Recovery Procedures

**Partial Migration Failure:**
1. Review error messages from migration script
2. Fix issues (permissions, disk space, filename conflicts)
3. Re-run migration for failed files only
4. Validate results

**Complete Migration Failure:**
1. Stop LSL system: `pkill -f enhanced-transcript-monitor`
2. Run rollback: `node scripts/rollback-migration.js`
3. Investigate root cause
4. Re-attempt migration with fixes

**File Corruption Detected:**
1. Identify corrupted files from validation report
2. Restore specific files from backup:
   ```bash
   cp .specstory/migration-backup/TIMESTAMP/filename.md .specstory/history/
   ```
3. Re-run migration for restored files

### Getting Help

If you encounter issues not covered in this guide:

1. **Check system logs:**
   ```bash
   tail -f .specstory/logs/operational.log
   tail -f .specstory/logs/lsl-monitor.log
   ```

2. **Verify environment:**
   ```bash
   node scripts/assess-lsl-migration.js --verbose
   ```

3. **Create issue report:**
   ```bash
   # Gather diagnostic information
   echo "Environment:" > migration-issue-report.txt
   echo "USER: ${USER}" >> migration-issue-report.txt
   echo "Project: $(pwd)" >> migration-issue-report.txt
   echo "" >> migration-issue-report.txt
   echo "File counts:" >> migration-issue-report.txt
   ls -la .specstory/history/ | wc -l >> migration-issue-report.txt
   echo "" >> migration-issue-report.txt
   echo "Recent errors:" >> migration-issue-report.txt
   tail -20 .specstory/logs/operational.log >> migration-issue-report.txt
   ```

## Best Practices

### Pre-Migration
- Always run assessment first
- Create backups before any changes
- Test migration on non-production projects first
- Ensure USER environment variable is properly set

### During Migration
- Use dry-run mode to preview changes
- Monitor disk space during migration
- Don't interrupt migration process
- Keep terminal output for troubleshooting

### Post-Migration
- Always run validation after migration
- Test LSL system functionality thoroughly
- Update any automation scripts that reference old patterns
- Document any custom modifications needed

### Multi-Project Environments
- Migrate projects in dependency order
- Ensure consistent USER hash across related projects
- Test cross-project routing after migration
- Coordinate migration timing with team members

---

## Summary

This migration guide provides comprehensive procedures for updating your LSL system to support the new enhanced filename format with USER hash support. The migration includes:

- **Assessment tools** to analyze current state
- **Migration scripts** with dry-run capability
- **Validation procedures** to ensure success
- **Rollback options** for recovery
- **Troubleshooting guides** for common issues

Following these procedures ensures a smooth transition to the enhanced LSL system while preserving all existing session data and maintaining system functionality.