#!/bin/bash

# MCP-aware wrapper for capture-coding-insight.sh
# This script is designed to be called from within Claude Code to properly use MCP tools

# Source the original script's configuration
KNOWLEDGE_BASE_DIR="$HOME/coding-knowledge-base"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to create MCP entity
create_mcp_entity() {
    local problem="$1"
    local solution="$2"
    local project="$3"
    local category="$4"
    local tags="$5"
    local language="$6"
    
    # Create entity name
    local entity_name="${category}_${project}_$(date +%Y%m%d_%H%M%S)"
    
    echo -e "${GREEN}Creating entity in MCP memory graph...${NC}"
    
    # Create the observations array
    local observations=(
        "Problem: $problem"
        "Solution: $solution"
        "Category: $category"
        "Project: $project"
        "Created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    )
    
    # Add tags if present
    if [ -n "$tags" ]; then
        observations+=("Tags: $tags")
    fi
    
    # Add language if present
    if [ -n "$language" ]; then
        observations+=("Language: $language")
    fi
    
    # This would be called by Claude Code with actual MCP tools
    echo -e "${GREEN}✓ Entity '$entity_name' would be created with:${NC}"
    echo "  Type: CodingInsight"
    for obs in "${observations[@]}"; do
        echo "  - $obs"
    done
    
    # Store the command that would be executed
    local mcp_command="mcp__memory__create_entities([{\"name\": \"$entity_name\", \"entityType\": \"CodingInsight\", \"observations\": ["
    for i in "${!observations[@]}"; do
        if [ $i -gt 0 ]; then
            mcp_command+=", "
        fi
        mcp_command+="\"${observations[$i]}\""
    done
    mcp_command+="]}])"
    
    echo ""
    echo -e "${BLUE}MCP Command that would be executed:${NC}"
    echo "$mcp_command"
    
    # Save command to file for reference
    echo "$mcp_command" > "$KNOWLEDGE_BASE_DIR/last_mcp_command.txt"
    
    return 0
}

# Main script logic
if [ "$1" = "--create" ]; then
    shift
    create_mcp_entity "$@"
else
    # Pass through to original script
    ~/Claude/knowledge-management/capture-coding-insight.sh "$@"
fi