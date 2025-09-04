#!/usr/bin/env node

/**
 * Fix PlantUML Compliance Issues
 * Addresses the systemic PlantUML styling and structure violations
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { glob } from 'glob';

class PlantUMLFixer {
  constructor() {
    this.fixed = 0;
    this.errors = [];
  }

  async fixAll() {
    console.log('🔧 PlantUML Compliance Fixer\n');
    
    await this.fixStylingCompliance();
    await this.removeBrokenPngs();
    await this.regenerateAllPngs();
    
    this.printSummary();
  }

  async fixStylingCompliance() {
    console.log('📏 Fixing styling compliance...');
    
    const pumlFiles = await glob('docs/puml/*.puml', { ignore: 'docs/puml/_*.puml' });
    
    for (const file of pumlFiles) {
      try {
        let content = readFileSync(file, 'utf8');
        const filename = file.split('/').pop();
        
        // Skip if already has standard styling
        if (content.includes('!include _standard-style.puml')) {
          console.log(`  ✅ ${filename} - Already compliant`);
          continue;
        }
        
        // Remove old styling patterns
        content = content.replace(/!theme plain\n/g, '');
        content = content.replace(/skinparam backgroundColor white\n/g, '');
        content = content.replace(/skinparam defaultFontName Arial\n/g, '');
        content = content.replace(/skinparam defaultFontSize 12\n/g, '');
        content = content.replace(/!theme aws-orange\n/g, '');
        
        // Add standard styling after @startuml
        const startUmlMatch = content.match(/^(@startuml.*?\n)/);
        if (startUmlMatch) {
          content = content.replace(startUmlMatch[1], startUmlMatch[1] + '!include _standard-style.puml\n\n');
        }
        
        writeFileSync(file, content);
        console.log(`  🔄 ${filename} - Fixed styling compliance`);
        this.fixed++;
        
      } catch (error) {
        this.errors.push(`${file}: ${error.message}`);
        console.log(`  ❌ ${filename} - Error: ${error.message}`);
      }
    }
  }

  async removeBrokenPngs() {
    console.log('\n🗑️  Removing broken PNG files...');
    
    // Remove any PNGs that were generated before styling fixes
    const brokenPngs = await glob('docs/images/*.png');
    
    for (const png of brokenPngs) {
      const basename = png.replace('docs/images/', '').replace('.png', '');
      const pumlFile = `docs/puml/${basename}.puml`;
      
      if (existsSync(pumlFile)) {
        unlinkSync(png);
        console.log(`  🗑️  Removed ${png} (will regenerate)`);
      }
    }
  }

  async regenerateAllPngs() {
    console.log('\n🖼️  Regenerating PNG files with proper styling...');
    
    const pumlFiles = await glob('docs/puml/*.puml', { ignore: 'docs/puml/_*.puml' });
    
    for (const file of pumlFiles) {
      try {
        const basename = file.replace('docs/puml/', '').replace('.puml', '');
        const pngFile = `docs/images/${basename}.png`;
        
        // Generate PNG with proper styling
        execSync(`cd docs/puml && plantuml -tpng -o ../images ${basename}.puml`, { 
          stdio: 'pipe',
          timeout: 30000 
        });
        
        if (existsSync(pngFile)) {
          console.log(`  ✅ Generated ${basename}.png`);
        } else {
          console.log(`  ❌ Failed to generate ${basename}.png`);
          this.errors.push(`Failed to generate ${basename}.png`);
        }
        
      } catch (error) {
        console.log(`  ❌ Error generating ${file}: ${error.message}`);
        this.errors.push(`${file}: ${error.message}`);
      }
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('🔧 PlantUML Compliance Fix Summary');
    console.log('='.repeat(60));
    console.log(`✅ Files fixed: ${this.fixed}`);
    console.log(`❌ Errors: ${this.errors.length}`);
    
    if (this.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      this.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    console.log('\n🎯 Next Steps:');
    console.log('  1. Run: node scripts/test-plantuml-guardrails.js');
    console.log('  2. Verify PNG files are properly generated');
    console.log('  3. Update constraint monitor to catch future violations');
  }
}

// Run if called directly
async function main() {
  const fixer = new PlantUMLFixer();
  await fixer.fixAll();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default PlantUMLFixer;