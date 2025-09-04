#!/usr/bin/env node

/**
 * Fix Duplicate PlantUML Styling
 * Removes old styling remnants that are causing duplicate diagrams
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { glob } from 'glob';

class DuplicateStylingFixer {
  constructor() {
    this.fixed = 0;
    this.errors = [];
  }

  async fixAll() {
    console.log('🔧 Duplicate Styling Fixer\n');
    
    await this.removeOldStyling();
    await this.regenerateAffectedPngs();
    
    this.printSummary();
  }

  async removeOldStyling() {
    console.log('🧹 Removing old styling remnants...');
    
    const pumlFiles = await glob('docs/puml/*.puml', { ignore: 'docs/puml/_*.puml' });
    
    for (const file of pumlFiles) {
      try {
        let content = readFileSync(file, 'utf8');
        const filename = file.split('/').pop();
        let changed = false;
        
        // Remove all old styling patterns that might cause duplication
        const oldPatterns = [
          /!theme plain\n/g,
          /!theme aws-orange\n/g,
          /skinparam backgroundColor white\n/g,
          /skinparam defaultFontName Arial\n/g,
          /skinparam defaultFontSize 12\n/g,
          /skinparam direction top to bottom layout\n/g,
          // Remove empty lines after @startuml but before !include
          /(@startuml[^\n]*\n)\n+(!include _standard-style\.puml)/g
        ];
        
        const originalContent = content;
        
        for (const pattern of oldPatterns) {
          if (pattern.toString().includes('(@startuml')) {
            // Special case for empty line removal
            content = content.replace(pattern, '$1$2');
          } else {
            content = content.replace(pattern, '');
          }
        }
        
        // Ensure consistent spacing after !include
        content = content.replace(/(!include _standard-style\.puml)\n\n\n+/g, '$1\n\n');
        
        if (content !== originalContent) {
          writeFileSync(file, content);
          console.log(`  🔄 ${filename} - Removed duplicate styling`);
          this.fixed++;
          changed = true;
        } else {
          console.log(`  ✅ ${filename} - Already clean`);
        }
        
      } catch (error) {
        this.errors.push(`${file}: ${error.message}`);
        console.log(`  ❌ ${filename} - Error: ${error.message}`);
      }
    }
  }

  async regenerateAffectedPngs() {
    console.log('\n🖼️  Regenerating affected PNG files...');
    
    // List of files that commonly have duplication issues
    const problemFiles = [
      'semantic-analysis-communication-compact.puml',
      'semantic-analysis-communication.puml', 
      'semantic-analysis-communication-vertical.puml',
      'knowledge-workflow-enhanced.puml',
      'vscode-integrated-architecture.puml',
      'system-architecture.puml',
      'agent-agnostic-architecture.puml'
    ];
    
    for (const file of problemFiles) {
      try {
        const basename = file.replace('.puml', '');
        const pngFile = `../images/${basename}.png`;
        
        // Remove old PNG first
        try {
          execSync(`rm -f ${pngFile}`, { cwd: 'docs/puml', stdio: 'pipe' });
        } catch (e) {
          // Ignore if file doesn't exist
        }
        
        // Generate new PNG
        execSync(`plantuml -tpng -o ../images ${file}`, { 
          cwd: 'docs/puml',
          stdio: 'pipe',
          timeout: 30000 
        });
        
        console.log(`  🔄 Regenerated ${basename}.png`);
        
      } catch (error) {
        console.log(`  ❌ Error regenerating ${file}: ${error.message}`);
        this.errors.push(`${file}: ${error.message}`);
      }
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('🔧 Duplicate Styling Fix Summary');
    console.log('='.repeat(60));
    console.log(`✅ Files cleaned: ${this.fixed}`);
    console.log(`❌ Errors: ${this.errors.length}`);
    
    if (this.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      this.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    console.log('\n🎯 Result:');
    if (this.errors.length === 0) {
      console.log('🌟 All duplicate styling issues should now be resolved!');
      console.log('📋 Check the PNG files - they should now show single clean diagrams');
    } else {
      console.log('🔧 Some issues remain - check the errors above');
    }
  }
}

// Run if called directly
async function main() {
  const fixer = new DuplicateStylingFixer();
  await fixer.fixAll();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default DuplicateStylingFixer;