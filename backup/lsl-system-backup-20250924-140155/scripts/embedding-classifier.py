#!/usr/bin/env python3
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