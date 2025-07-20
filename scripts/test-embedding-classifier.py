#!/usr/bin/env python3
"""
Test the embedding classifier approach with sample data
"""

import json
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

def test_embedding_classification():
    # Initialize model
    print("🔄 Loading sentence transformer model...")
    model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
    
    # Sample coding infrastructure content
    coding_samples = [
        "MCP services shutdown gracefully. Post-session logging started. Using multi-topic session splitting.",
        "UKB command for knowledge management. VKB server running on port 8080. Semantic analysis MCP server configured.",
        "Session logging infrastructure improvements. Conversation capture and semantic analysis system.",
        "Knowledge base management with shared-memory.json. Cross-project pattern detection and insight capture.",
        "Deduplication agent with embedding model for similarity detection. Entity merging and duplicate resolution."
    ]
    
    # Sample project-specific content  
    project_samples = [
        "React to Kotlin Compose Multiplatform migration. Timeline visualization with Three.js components.",
        "Redux state management with UI components. Camera controls and animation system for 3D visualization.",
        "API integration with backend endpoints. JSON deserialization and HTTP client configuration.",
        "Material 3 theming and component development. Cross-platform mobile and desktop applications.",
        "Timeline events rendering with position management. User interface components and interaction handlers."
    ]
    
    # Test content (should classify as coding)
    test_content = "🔄 Gracefully shutting down MCP services... ✅ MCP services shutdown complete. Post-session logging started using multi-topic session splitting. Session logging infrastructure improvements discussed."
    
    print("📊 Computing embeddings...")
    
    # Compute embeddings
    coding_embeddings = model.encode(coding_samples)
    project_embeddings = model.encode(project_samples) 
    test_embedding = model.encode([test_content])
    
    print("🔍 Calculating similarities...")
    
    # Calculate similarities
    coding_similarities = cosine_similarity(test_embedding, coding_embeddings)[0]
    project_similarities = cosine_similarity(test_embedding, project_embeddings)[0]
    
    # Calculate scores
    coding_score = np.mean(coding_similarities)
    project_score = np.mean(project_similarities)
    
    print(f"\n📊 Results:")
    print(f"   Coding infrastructure score: {coding_score:.3f}")
    print(f"   Project development score:   {project_score:.3f}")
    
    classification = 'coding' if coding_score > project_score else 'project'
    confidence = max(coding_score, project_score) / (coding_score + project_score) if (coding_score + project_score) > 0 else 0.5
    
    print(f"\n✅ Classification: {classification}")
    print(f"   Confidence: {confidence:.1%}")
    
    print(f"\n🔍 Top coding similarities:")
    for i, sim in enumerate(coding_similarities):
        print(f"   {sim:.3f}: {coding_samples[i][:60]}...")
    
    print(f"\n🔍 Top project similarities:")
    for i, sim in enumerate(project_similarities):
        print(f"   {sim:.3f}: {project_samples[i][:60]}...")
    
    return {
        'classification': classification,
        'confidence': float(confidence),
        'coding_score': float(coding_score),
        'project_score': float(project_score)
    }

if __name__ == '__main__':
    result = test_embedding_classification()
    print(f"\n🎯 Final result: {json.dumps(result, indent=2)}")