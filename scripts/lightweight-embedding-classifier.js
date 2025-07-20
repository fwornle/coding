#!/usr/bin/env node

/**
 * Lightweight Embedding-Based Content Classifier
 * Uses pre-defined samples instead of full repository embedding
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class LightweightEmbeddingClassifier {
  constructor() {
    this.pythonScript = path.join(__dirname, 'lightweight-classifier.py');
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    // Create Python classifier script
    await this.ensurePythonScript();
    this.initialized = true;
  }

  async ensurePythonScript() {
    if (fs.existsSync(this.pythonScript)) return;
    
    const pythonCode = `#!/usr/bin/env python3
"""
Lightweight embedding classifier with pre-defined samples
"""

import json
import sys
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

# Pre-defined coding infrastructure samples
CODING_SAMPLES = [
    "MCP services shutdown gracefully. Post-session logging started. Using multi-topic session splitting.",
    "UKB command for knowledge management. VKB server running on port 8080. Semantic analysis MCP server configured.",
    "Session logging infrastructure improvements. Conversation capture and semantic analysis system.",
    "Knowledge base management with shared-memory.json. Cross-project pattern detection and insight capture.",
    "Deduplication agent with embedding model for similarity detection. Entity merging and duplicate resolution.",
    "Gracefully shutting down MCP services. MCP services validation. Services startup and health check.",
    "Post-session logger classification. Multi-topic session splitting and conversation extraction.",
    "Semantic analysis system configuration. Agent detection routing Claude vs CoPilot integration.",
    "Knowledge graph management synchronization. MCP Memory sync required handled by Claude startup.",
    "Coding infrastructure development workflows. Development patterns and architectural decisions."
]

# Pre-defined project development samples  
PROJECT_SAMPLES = [
    "React to Kotlin Compose Multiplatform migration. Timeline visualization with Three.js components.",
    "Redux state management with UI components. Camera controls and animation system for 3D visualization.",
    "API integration with backend endpoints. JSON deserialization and HTTP client configuration.",
    "Material 3 theming and component development. Cross-platform mobile and desktop applications.",
    "Timeline events rendering with position management. User interface components and interaction handlers.",
    "Database schemas API development business logic authentication domain-specific features.",
    "Application deployment specific project configuration. Frontend backend service integration.",
    "User interface design component library. Application state management and data flow patterns.",
    "Mobile app development native platform features. Cross-platform deployment and app store distribution.",
    "Web application framework routing navigation. Progressive web app service worker implementation."
]

class LightweightClassifier:
    def __init__(self):
        self.model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
        self.coding_embeddings = None
        self.project_embeddings = None
        
    def _ensure_embeddings(self):
        """Pre-compute embeddings for samples if not already done."""
        if self.coding_embeddings is None:
            self.coding_embeddings = self.model.encode(CODING_SAMPLES)
            self.project_embeddings = self.model.encode(PROJECT_SAMPLES)
    
    def classify(self, text: str) -> dict:
        """Classify text using pre-computed sample embeddings."""
        self._ensure_embeddings()
        
        # Compute embedding for input text
        input_embedding = self.model.encode([text])
        
        # Calculate similarities
        coding_similarities = cosine_similarity(input_embedding, self.coding_embeddings)[0]
        project_similarities = cosine_similarity(input_embedding, self.project_embeddings)[0]
        
        # Calculate scores (using top matches weighted approach)
        coding_score = float(np.mean(np.sort(coding_similarities)[-3:]))  # Top 3 average
        project_score = float(np.mean(np.sort(project_similarities)[-3:]))  # Top 3 average
        
        # Determine classification
        classification = 'coding' if coding_score > project_score else 'project'
        total_score = coding_score + project_score
        confidence = float(max(coding_score, project_score) / total_score if total_score > 0 else 0.5)
        
        # Find best matches for reasoning
        best_coding_idx = int(np.argmax(coding_similarities))
        best_project_idx = int(np.argmax(project_similarities))
        
        return {
            'classification': classification,
            'confidence': confidence,
            'coding_score': coding_score,
            'project_score': project_score,
            'best_coding_match': {
                'similarity': float(coding_similarities[best_coding_idx]),
                'sample': CODING_SAMPLES[best_coding_idx]
            },
            'best_project_match': {
                'similarity': float(project_similarities[best_project_idx]),
                'sample': PROJECT_SAMPLES[best_project_idx]
            },
            'reasoning': f"Top coding similarity: {coding_similarities[best_coding_idx]:.3f}, top project similarity: {project_similarities[best_project_idx]:.3f}"
        }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: script.py <text_to_classify>'}))
        sys.exit(1)
    
    text = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    
    try:
        classifier = LightweightClassifier()
        result = classifier.classify(text)
        result['success'] = True
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
`;

    fs.writeFileSync(this.pythonScript, pythonCode);
    fs.chmodSync(this.pythonScript, 0o755);
  }

  extractSubstantiveContent(content) {
    // Filter out /sl commands and session log reading exchanges
    const lines = content.split('\n');
    const filteredLines = [];
    let skipSection = false;
    let exchangeCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Detect exchange boundaries
      if (line.match(/^## Exchange \d+/)) {
        exchangeCount++;
        skipSection = false;
      }
      
      // Skip exchanges that are primarily about /sl or session log reading
      if (line.includes('<command-name>/sl</command-name>') ||
          line.includes('Read session logs for continuity') ||
          line.includes('read the last session log') ||
          line.includes('session log files') ||
          line.includes('I\'ll read the') ||
          (exchangeCount <= 3 && line.includes('continuity'))) {
        skipSection = true;
        continue;
      }
      
      if (!skipSection) {
        filteredLines.push(line);
      }
    }
    
    // Take sample from filtered content
    const filteredContent = filteredLines.join('\n');
    return filteredContent.substring(0, 1500); // Increased sample size since we filtered
  }

  async classifyContent(content) {
    try {
      await this.initialize();
      
      // Extract relevant portion for classification, excluding /sl exchanges
      const contentSample = this.extractSubstantiveContent(content);
      
      const result = await this.runPythonClassifier(contentSample);
      
      if (!result.success) {
        throw new Error(result.error || 'Classification failed');
      }
      
      console.log(`🔍 Lightweight embedding classification: ${result.classification} (confidence: ${(result.confidence * 100).toFixed(1)}%)`);
      console.log(`📊 Coding: ${result.coding_score.toFixed(3)}, Project: ${result.project_score.toFixed(3)}`);
      console.log(`🎯 Best match: ${result.best_coding_match.similarity > result.best_project_match.similarity ? 'Coding' : 'Project'} (${Math.max(result.best_coding_match.similarity, result.best_project_match.similarity).toFixed(3)})`);
      
      return result.classification;
      
    } catch (error) {
      console.error('❌ Lightweight embedding classification failed:', error.message);
      // Fallback to simple pattern matching
      return this.fallbackClassification(content);
    }
  }

  async runPythonClassifier(text) {
    return new Promise((resolve, reject) => {
      const python = spawn('python3', [this.pythonScript, text], {
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
    });
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

export default LightweightEmbeddingClassifier;