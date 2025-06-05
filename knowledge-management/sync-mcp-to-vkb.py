#!/usr/bin/env python3
"""
Sync MCP memory to VKB format
"""
import json
import subprocess
import sys

def get_mcp_data():
    """Get data from MCP memory"""
    try:
        # Use Claude Code to get MCP memory data
        result = subprocess.run([
            'claude', 'mcp', 'memory', 'read_graph'
        ], capture_output=True, text=True)
        
        if result.returncode == 0:
            return json.loads(result.stdout)
        else:
            print(f"Error getting MCP data: {result.stderr}")
            return None
    except Exception as e:
        print(f"Failed to get MCP data: {e}")
        return None

def convert_to_vkb_format(mcp_data):
    """Convert MCP data to VKB format"""
    entities = []
    relations = []
    
    for entity in mcp_data.get('entities', []):
        vkb_entity = {
            "type": "entity",
            "name": entity["name"],
            "entityType": entity["entityType"],
            "observations": entity["observations"]
        }
        entities.append(vkb_entity)
    
    for relation in mcp_data.get('relations', []):
        vkb_relation = {
            "type": "relation",
            "from": relation["from"],
            "relationType": relation["relationType"],
            "to": relation["to"]
        }
        relations.append(vkb_relation)
    
    return {
        "metadata": {
            "version": "1.0.0",
            "created": "2025-06-05T00:00:00Z",
            "last_updated": "2025-06-05T13:30:00Z",
            "contributors": ["q284340"],
            "total_entities": len(entities),
            "total_relations": len(relations),
            "last_mode": "manual_sync"
        },
        "entities": entities,
        "relations": relations,
        "total_relations": len(relations),
        "total_entities": len(entities)
    }

def main():
    print("Syncing MCP memory to VKB format...")
    
    # For now, read from the shared memory file since direct MCP access isn't available
    try:
        with open('/Users/q284340/Claude/shared-memory.json', 'r') as f:
            shared_data = json.load(f)
        
        # Create dist directory if it doesn't exist
        import os
        os.makedirs('dist', exist_ok=True)
        
        # Write to dist/memory.json
        with open('dist/memory.json', 'w') as f:
            json.dump(shared_data, f, indent=2)
        
        print(f"✅ Synced {shared_data['metadata']['total_entities']} entities and {shared_data['metadata']['total_relations']} relations to dist/memory.json")
        
    except Exception as e:
        print(f"❌ Error syncing data: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()