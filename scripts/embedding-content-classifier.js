#!/usr/bin/env node

/**
 * Embedding-Based Content Classifier
 * Fast, context-aware classification using pre-computed embeddings
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class EmbeddingContentClassifier {
  constructor(codingRepo) {
    this.codingRepo = codingRepo || '/Users/q284340/Agentic/coding';
    this.embeddingsPath = path.join(this.codingRepo, '.embeddings');
    this.embeddingsFile = path.join(this.embeddingsPath, 'coding-context-embeddings.json');
    this.pythonScript = path.join(__dirname, 'embedding-classifier.py');
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    console.log('🔄 Initializing embedding classifier...');
    
    // Ensure embeddings directory exists
    if (!fs.existsSync(this.embeddingsPath)) {
      fs.mkdirSync(this.embeddingsPath, { recursive: true });
    }
    
    // Check if embeddings exist, if not create them
    if (!fs.existsSync(this.embeddingsFile)) {
      console.log('📊 Pre-computing embeddings for coding repository context...');
      await this.computeEmbeddings();
    } else {
      // Check if embeddings are recent (less than 7 days old)
      const stats = fs.statSync(this.embeddingsFile);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      
      if (ageInDays > 7) {
        console.log('🔄 Refreshing embeddings (older than 7 days)...');
        await this.computeEmbeddings();
      }
    }
    
    // Create Python classifier script if it doesn't exist
    await this.ensurePythonScript();
    
    this.initialized = true;
    console.log('✅ Embedding classifier initialized');
  }

  async computeEmbeddings() {
    try {
      // Collect all relevant coding repository content
      const codingContent = await this.collectCodingContent();
      
      // Use Python script to compute embeddings
      const result = await this.runPythonEmbedding('compute', codingContent);
      
      if (!result.success) {
        throw new Error(`Embedding computation failed: ${result.error}`);
      }
      
      console.log(`📊 Computed embeddings for ${result.documents_processed} documents`);
      
    } catch (error) {
      console.error('❌ Failed to compute embeddings:', error.message);
      throw error;
    }
  }

  async collectCodingContent() {
    const content = {
      docs: [],
      scripts: [],
      insights: [],
      configurations: []
    };

    try {
      // Collect documentation
      const docsDir = path.join(this.codingRepo, 'docs');
      if (fs.existsSync(docsDir)) {
        content.docs = await this.collectMarkdownFiles(docsDir);
      }

      // Collect key scripts
      const scriptsDir = path.join(this.codingRepo, 'scripts');
      if (fs.existsSync(scriptsDir)) {
        content.scripts = await this.collectScriptFiles(scriptsDir);
      }

      // Collect knowledge management insights
      const knowledgeDir = path.join(this.codingRepo, 'knowledge-management');
      if (fs.existsSync(knowledgeDir)) {
        content.insights = await this.collectInsightFiles(knowledgeDir);
      }

      // Collect configuration files
      content.configurations = await this.collectConfigFiles();

      return content;
      
    } catch (error) {
      console.error('❌ Error collecting coding content:', error.message);
      return content;
    }
  }

  async collectMarkdownFiles(dir) {
    const files = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          files.push(...await this.collectMarkdownFiles(fullPath));
        } else if (entry.name.endsWith('.md')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            files.push({
              path: fullPath,
              relative: path.relative(this.codingRepo, fullPath),
              content: content,
              type: 'documentation',
              category: this.categorizeDocFile(fullPath)
            });
          } catch (err) {
            console.warn(`⚠️  Skipped ${fullPath}: ${err.message}`);
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Error reading directory ${dir}: ${error.message}`);
    }
    
    return files;
  }

  async collectScriptFiles(dir) {
    const files = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.sh') || entry.name.endsWith('.py'))) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            files.push({
              path: fullPath,
              relative: path.relative(this.codingRepo, fullPath),
              content: content,
              type: 'script',
              category: this.categorizeScriptFile(fullPath)
            });
          } catch (err) {
            console.warn(`⚠️  Skipped ${fullPath}: ${err.message}`);
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Error reading scripts directory ${dir}: ${error.message}`);
    }
    
    return files;
  }

  async collectInsightFiles(dir) {
    const files = [];
    try {
      const insightsDir = path.join(dir, 'insights');
      if (fs.existsSync(insightsDir)) {
        files.push(...await this.collectMarkdownFiles(insightsDir));
      }
    } catch (error) {
      console.warn(`⚠️  Error reading insights directory: ${error.message}`);
    }
    
    return files;
  }

  async collectConfigFiles() {
    const files = [];
    const configFiles = [
      'claude-code-mcp-processed.json',
      'shared-memory.json',
      'package.json',
      'README.md',
      '.gitignore'
    ];

    for (const filename of configFiles) {
      const fullPath = path.join(this.codingRepo, filename);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          files.push({
            path: fullPath,
            relative: filename,
            content: content,
            type: 'configuration',
            category: 'infrastructure'
          });
        } catch (err) {
          console.warn(`⚠️  Skipped ${fullPath}: ${err.message}`);
        }
      }
    }

    return files;
  }

  categorizeDocFile(filePath) {
    const relativePath = path.relative(this.codingRepo, filePath).toLowerCase();
    
    if (relativePath.includes('mcp') || relativePath.includes('semantic-analysis')) {
      return 'mcp-infrastructure';
    } else if (relativePath.includes('knowledge') || relativePath.includes('ukb') || relativePath.includes('vkb')) {
      return 'knowledge-management';
    } else if (relativePath.includes('logging') || relativePath.includes('session')) {
      return 'logging-system';
    } else if (relativePath.includes('workflow') || relativePath.includes('pattern')) {
      return 'workflow-patterns';
    }
    
    return 'general-infrastructure';
  }

  categorizeScriptFile(filePath) {
    const filename = path.basename(filePath).toLowerCase();
    
    if (filename.includes('session') || filename.includes('log')) {
      return 'logging-system';
    } else if (filename.includes('ukb') || filename.includes('vkb') || filename.includes('knowledge')) {
      return 'knowledge-management';
    } else if (filename.includes('mcp') || filename.includes('semantic')) {
      return 'mcp-infrastructure';
    } else if (filename.includes('setup') || filename.includes('install')) {
      return 'setup-automation';
    }
    
    return 'utility-scripts';
  }

  async ensurePythonScript() {
    if (fs.existsSync(this.pythonScript)) return;
    
    const pythonCode = `#!/usr/bin/env python3
"""
Embedding-based content classifier using sentence-transformers
"""

import json
import sys
import os
from datetime import datetime
from typing import Dict, List, Any
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import pickle

class EmbeddingClassifier:
    def __init__(self, embeddings_file: str):
        self.embeddings_file = embeddings_file
        self.model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
        self.embeddings_data = None
        
    def compute_embeddings(self, content_data: Dict[str, List[Dict]]) -> Dict[str, Any]:
        """Compute embeddings for all coding repository content."""
        all_documents = []
        all_metadata = []
        
        # Process all content types
        for content_type, documents in content_data.items():
            for doc in documents:
                # Create text representation
                text = f"{doc['relative']} {doc['content'][:2000]}"  # Limit to 2000 chars
                all_documents.append(text)
                all_metadata.append({
                    'type': doc['type'],
                    'category': doc['category'],
                    'relative_path': doc['relative'],
                    'content_type': content_type
                })
        
        # Compute embeddings
        embeddings = self.model.encode(all_documents)
        
        # Save embeddings data
        embeddings_data = {
            'embeddings': embeddings.tolist(),
            'metadata': all_metadata,
            'documents': all_documents,
            'model_name': 'sentence-transformers/all-MiniLM-L6-v2',
            'created_at': str(datetime.now()),
            'total_documents': len(all_documents)
        }
        
        with open(self.embeddings_file, 'w') as f:
            json.dump(embeddings_data, f, indent=2)
        
        return {
            'success': True,
            'documents_processed': len(all_documents),
            'embeddings_file': self.embeddings_file
        }
    
    def classify_content(self, input_text: str) -> Dict[str, Any]:
        """Classify input text using pre-computed embeddings."""
        # Load embeddings if not already loaded
        if self.embeddings_data is None:
            with open(self.embeddings_file, 'r') as f:
                self.embeddings_data = json.load(f)
        
        # Compute embedding for input text
        input_embedding = self.model.encode([input_text])
        
        # Calculate similarities with all stored embeddings
        stored_embeddings = np.array(self.embeddings_data['embeddings'])
        similarities = cosine_similarity(input_embedding, stored_embeddings)[0]
        
        # Find top matches
        top_indices = np.argsort(similarities)[-10:][::-1]  # Top 10 matches
        top_matches = []
        
        for idx in top_indices:
            metadata = self.embeddings_data['metadata'][idx]
            top_matches.append({
                'similarity': float(similarities[idx]),
                'category': metadata['category'],
                'type': metadata['type'],
                'path': metadata['relative_path'],
                'content_type': metadata['content_type']
            })
        
        # Classify based on top matches
        coding_score = 0
        project_score = 0
        
        for match in top_matches[:5]:  # Use top 5 matches
            weight = match['similarity']
            
            if match['category'] in ['mcp-infrastructure', 'knowledge-management', 'logging-system', 'workflow-patterns', 'setup-automation']:
                coding_score += weight
            else:
                project_score += weight
        
        classification = 'coding' if coding_score > project_score else 'project'
        confidence = max(coding_score, project_score) / (coding_score + project_score) if (coding_score + project_score) > 0 else 0.5
        
        return {
            'classification': classification,
            'confidence': float(confidence),
            'coding_score': float(coding_score),
            'project_score': float(project_score),
            'top_matches': top_matches,
            'reasoning': f"Based on similarity to {len(top_matches)} coding infrastructure documents"
        }

def main():
    if len(sys.argv) < 3:
        print(json.dumps({'success': False, 'error': 'Usage: script.py <action> <data>'}))
        sys.exit(1)
    
    action = sys.argv[1]
    embeddings_file = sys.argv[2]
    
    classifier = EmbeddingClassifier(embeddings_file)
    
    if action == 'compute':
        # Read content data from stdin
        content_data = json.loads(sys.stdin.read())
        result = classifier.compute_embeddings(content_data)
        print(json.dumps(result))
        
    elif action == 'classify':
        input_text = sys.argv[3] if len(sys.argv) > 3 else sys.stdin.read()
        result = classifier.classify_content(input_text)
        print(json.dumps(result))
        
    else:
        print(json.dumps({'success': False, 'error': f'Unknown action: {action}'}))
        sys.exit(1)

if __name__ == '__main__':
    main()
`;

    fs.writeFileSync(this.pythonScript, pythonCode);
    fs.chmodSync(this.pythonScript, 0o755);
  }

  async runPythonEmbedding(action, data = null) {
    return new Promise((resolve, reject) => {
      const args = [this.pythonScript, action, this.embeddingsFile];
      
      if (action === 'classify' && typeof data === 'string') {
        args.push(data);
      }
      
      const python = spawn('python3', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let error = '';

      python.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });

      python.stderr.on('data', (chunk) => {
        error += chunk.toString();
      });

      python.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output);
            resolve(result);
          } catch (e) {
            reject(new Error(`Failed to parse Python output: ${e.message}`));
          }
        } else {
          reject(new Error(`Python script failed with code ${code}: ${error}`));
        }
      });

      // Send data to stdin if needed
      if (action === 'compute' && data) {
        python.stdin.write(JSON.stringify(data));
        python.stdin.end();
      } else if (action !== 'classify') {
        python.stdin.end();
      }
    });
  }

  async classifyContent(content) {
    try {
      await this.initialize();
      
      // Extract relevant portion for classification
      const contentSample = content.substring(0, 1500); // Slightly larger for better context
      
      const result = await this.runPythonEmbedding('classify', contentSample);
      
      if (!result.classification) {
        throw new Error('Classification failed');
      }
      
      console.log(`🔍 Embedding classification: ${result.classification} (confidence: ${(result.confidence * 100).toFixed(1)}%)`);
      
      return result.classification;
      
    } catch (error) {
      console.error('❌ Embedding classification failed:', error.message);
      // Fallback to simple pattern matching
      return this.fallbackClassification(content);
    }
  }

  fallbackClassification(content) {
    console.log('⚠️  Using fallback classification');
    
    const lowerContent = content.toLowerCase();
    
    const codingKeywords = [
      'ukb command', 'vkb command', 'mcp server', 'semantic-analysis',
      'post-session-logger', 'session logging', 'claude-mcp',
      'shared-memory', 'knowledge-management', 'coding repo',
      'mcp services', 'gracefully shutting down mcp',
      'semantic analysis mcp server', 'vkb server'
    ];
    
    const keywordCount = codingKeywords.reduce((count, keyword) => {
      return count + (lowerContent.split(keyword).length - 1);
    }, 0);
    
    return keywordCount >= 2 ? 'coding' : 'project';
  }
}

export default EmbeddingContentClassifier;