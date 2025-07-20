#!/usr/bin/env node
/**
 * Adaptive Embedding Classifier
 * 
 * Instead of hardcoded samples, this classifier learns from actual session logs:
 * 1. Extracts content from existing coding session files
 * 2. Builds embeddings from real session data
 * 3. Classifies new content against learned patterns
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class AdaptiveEmbeddingClassifier {
  constructor(codingPath, projectPaths = []) {
    this.codingPath = codingPath;
    this.projectPaths = projectPaths;
    this.pythonScript = path.join(__dirname, 'adaptive_classifier.py');
    this.embeddingsCache = path.join(__dirname, '.adaptive_embeddings_cache.json');
  }

  async ensurePythonScript() {
    if (fs.existsSync(this.pythonScript)) return;
    
    const pythonCode = `#!/usr/bin/env python3
"""
Adaptive embedding classifier that learns from actual session logs
"""

import json
import sys
import os
import glob
import re
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

class AdaptiveClassifier:
    def __init__(self):
        self.model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
        self.coding_embeddings = None
        self.project_embeddings = None
        self.coding_samples = []
        self.project_samples = []
    
    def extract_session_content(self, session_file):
        """Extract meaningful content from session log files."""
        if not os.path.exists(session_file):
            return []
        
        try:
            with open(session_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Extract substantive exchanges (skip /sl commands)
            exchanges = []
            current_exchange = []
            
            for line in content.split('\\n'):
                # Skip /sl commands and tool results
                if ('/sl' in line and 'command-name' in line) or '[Tool Result]' in line:
                    continue
                
                # Collect meaningful assistant responses
                if line.startswith('**Assistant:**') and len(current_exchange) > 0:
                    exchanges.append(' '.join(current_exchange))
                    current_exchange = []
                elif line.strip() and not line.startswith('**User:**') and not line.startswith('---'):
                    current_exchange.append(line.strip())
            
            # Add final exchange
            if current_exchange:
                exchanges.append(' '.join(current_exchange))
            
            # Filter meaningful content (> 50 chars, contains technical terms)
            meaningful_content = []
            for exchange in exchanges:
                if (len(exchange) > 50 and 
                    any(term in exchange.lower() for term in [
                        'implement', 'fix', 'create', 'update', 'configure', 
                        'debug', 'error', 'function', 'class', 'component'
                    ])):
                    meaningful_content.append(exchange[:500])  # Limit length
            
            return meaningful_content
            
        except Exception as e:
            print(f"Error processing {session_file}: {e}", file=sys.stderr)
            return []
    
    def learn_from_sessions(self, coding_dir, project_dirs=[]):
        """Learn patterns from actual session logs."""
        print(f"Learning from coding sessions in: {coding_dir}", file=sys.stderr)
        
        # Extract coding patterns
        coding_pattern = os.path.join(coding_dir, '.specstory/history/*coding-session.md')
        coding_files = glob.glob(coding_pattern)
        
        for file_path in coding_files[-10:]:  # Use last 10 sessions
            content = self.extract_session_content(file_path)
            self.coding_samples.extend(content)
        
        # Extract project patterns
        for project_dir in project_dirs:
            # Match both *session.md and *-session.md patterns (e.g., timeline-session.md, project-session.md)
            project_pattern = os.path.join(project_dir, '.specstory/history/*session.md')
            project_files = glob.glob(project_pattern)
            
            # Also match *-session.md patterns for files like timeline-session.md
            alt_pattern = os.path.join(project_dir, '.specstory/history/*-session.md')
            alt_files = glob.glob(alt_pattern)
            project_files.extend(alt_files)
            
            for file_path in project_files[-5:]:  # Use last 5 sessions per project
                if 'coding-session' not in file_path:  # Skip coding sessions
                    content = self.extract_session_content(file_path)
                    self.project_samples.extend(content)
        
        print(f"Learned {len(self.coding_samples)} coding patterns", file=sys.stderr)
        print(f"Learned {len(self.project_samples)} project patterns", file=sys.stderr)
        
        # Generate embeddings
        if self.coding_samples:
            self.coding_embeddings = self.model.encode(self.coding_samples)
        if self.project_samples:
            self.project_embeddings = self.model.encode(self.project_samples)
    
    def classify(self, text: str) -> dict:
        """Classify text using learned patterns."""
        if not self.coding_samples or not self.project_samples:
            return {
                'classification': 'coding',  # Default fallback
                'confidence': 0.5,
                'reasoning': 'Insufficient training data'
            }
        
        # Compute embedding for input text
        input_embedding = self.model.encode([text])
        
        # Calculate similarities
        coding_similarities = cosine_similarity(input_embedding, self.coding_embeddings)[0]
        project_similarities = cosine_similarity(input_embedding, self.project_embeddings)[0]
        
        # Calculate scores (using top matches)
        coding_score = float(np.mean(np.sort(coding_similarities)[-3:]))
        project_score = float(np.mean(np.sort(project_similarities)[-3:]))
        
        # Determine classification
        classification = 'coding' if coding_score > project_score else 'project'
        total_score = coding_score + project_score
        confidence = float(max(coding_score, project_score) / total_score if total_score > 0 else 0.5)
        
        # Find best matches
        best_coding_idx = int(np.argmax(coding_similarities))
        best_project_idx = int(np.argmax(project_similarities))
        
        return {
            'classification': classification,
            'confidence': confidence,
            'coding_score': coding_score,
            'project_score': project_score,
            'best_coding_match': {
                'similarity': float(coding_similarities[best_coding_idx]),
                'sample': self.coding_samples[best_coding_idx][:100] + '...'
            },
            'best_project_match': {
                'similarity': float(project_similarities[best_project_idx]),
                'sample': self.project_samples[best_project_idx][:100] + '...'
            },
            'reasoning': f"Learned from {len(self.coding_samples)} coding + {len(self.project_samples)} project sessions"
        }

def main():
    if len(sys.argv) < 3:
        print(json.dumps({'success': False, 'error': 'Usage: script.py <coding_dir> <text_to_classify> [project_dirs...]'}))
        sys.exit(1)
    
    coding_dir = sys.argv[1]
    text_to_classify = sys.argv[2]
    project_dirs = sys.argv[3:] if len(sys.argv) > 3 else []
    
    try:
        classifier = AdaptiveClassifier()
        classifier.learn_from_sessions(coding_dir, project_dirs)
        result = classifier.classify(text_to_classify)
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

  async classifyContent(content) {
    await this.ensurePythonScript();
    
    return new Promise((resolve, reject) => {
      const args = [this.codingPath, content, ...this.projectPaths];
      const python = spawn('python3', [this.pythonScript, ...args]);
      
      let stdout = '';
      let stderr = '';
      
      python.stdout.on('data', (data) => stdout += data.toString());
      python.stderr.on('data', (data) => stderr += data.toString());
      
      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Classification failed: ${stderr}`));
          return;
        }
        
        try {
          const result = JSON.parse(stdout);
          if (!result.success) {
            reject(new Error(result.error));
            return;
          }
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse result: ${e.message}`));
        }
      });
    });
  }
}

module.exports = { AdaptiveEmbeddingClassifier };

// CLI usage
if (require.main === module) {
  const codingPath = process.argv[2];
  const content = process.argv[3];
  const projectPaths = process.argv.slice(4);
  
  if (!codingPath || !content) {
    console.error('Usage: node adaptive-embedding-classifier.js <coding_path> <content> [project_paths...]');
    process.exit(1);
  }
  
  const classifier = new AdaptiveEmbeddingClassifier(codingPath, projectPaths);
  classifier.classifyContent(content)
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.error('Classification error:', error.message);
      process.exit(1);
    });
}