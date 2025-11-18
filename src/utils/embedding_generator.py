#!/usr/bin/env python3
import sys
import json
import numpy as np
from sentence_transformers import SentenceTransformer

def main():
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        texts = input_data['texts']
        model_name = input_data.get('model', 'sentence-transformers/all-MiniLM-L6-v2')
        
        # Load model
        model = SentenceTransformer(model_name)
        
        # Generate embeddings
        embeddings = model.encode(texts, convert_to_numpy=True)
        
        # Convert to list for JSON serialization
        embeddings_list = [emb.tolist() for emb in embeddings]
        
        # Output result
        result = {
            "embeddings": embeddings_list,
            "model": model_name,
            "dimensions": len(embeddings_list[0]) if embeddings_list else 0
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            "error": str(e),
            "embeddings": None
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()
