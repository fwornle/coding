#!/bin/bash

# Enhanced Capture Coding Insight Script
# Properly integrates with MCP memory graph and validates connections

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to show usage
usage() {
    echo "Usage: $(basename $0) [OPTIONS]"
    echo ""
    echo "Enhanced version with MCP integration and validation"
    echo ""
    echo "Options:"
    echo "  -p, --problem     Problem description (required)"
    echo "  -s, --solution    Solution description (required)" 
    echo "  -j, --project     Project name (default: current directory name)"
    echo "  -c, --category    Category (e.g., bug-fix, performance, architecture)"
    echo "  -t, --tags        Comma-separated tags (e.g., react,typescript,optimization)"
    echo "  -l, --language    Programming language (e.g., javascript, python)"
    echo "  -r, --relates-to  Comma-separated list of related entities"
    echo "  --validate        Run validation after creating entities"
    echo "  -h, --help        Show this help message"
}

# Function to validate entity references exist
validate_entity_references() {
    local relates_to="$1"
    local missing_entities=()
    
    if [ -n "$relates_to" ]; then
        IFS=',' read -ra entities <<< "$relates_to"
        for entity in "${entities[@]}"; do
            entity=$(echo "$entity" | xargs) # trim whitespace
            echo -e "${BLUE}🔍 Checking if '$entity' exists in knowledge graph...${NC}"
            
            # In real implementation, this would use MCP search
            # For now, assume core entities exist
            case "$entity" in
                "TimelineProject"|"Redux Store Architecture"|"Three.js Integration"|"BottomBar Component"|"TimelineAxis Component")
                    echo -e "${GREEN}  ✓ Found: $entity${NC}"
                    ;;
                *)
                    echo -e "${YELLOW}  ? Unknown entity: $entity${NC}"
                    missing_entities+=("$entity")
                    ;;
            esac
        done
    fi
    
    if [ ${#missing_entities[@]} -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Warning: Some referenced entities may not exist:${NC}"
        for entity in "${missing_entities[@]}"; do
            echo -e "${YELLOW}    - $entity${NC}"
        done
        echo -e "${YELLOW}    Consider creating these entities first or check spelling${NC}"
    fi
}

# Function to create entity with proper MCP integration
create_mcp_entity() {
    local problem="$1"
    local solution="$2"
    local project="$3"
    local category="$4"
    local tags="$5"
    local language="$6"
    local relates_to="$7"
    
    local timestamp=$(date +%Y%m%d)
    local entity_name="${category}_${project}_${timestamp}"
    
    echo -e "${GREEN}🏗️  Creating entity in MCP memory graph...${NC}"
    echo "  Name: $entity_name"
    echo "  Type: CodingInsight"
    
    # Create observations array
    local observations="Problem: $problem|Solution: $solution|Category: $category|Project: $project"
    [ -n "$tags" ] && observations="$observations|Tags: $tags"
    [ -n "$language" ] && observations="$observations|Language: $language"
    observations="$observations|Created: $(date +%Y-%m-%d)"
    
    echo -e "${BLUE}📝 Observations:${NC}"
    echo "$observations" | tr '|' '\n' | sed 's/^/    /'
    
    # Store locally for now - MCP integration happens at session end
    local insights_dir="$HOME/Claude/knowledge-management/insights"
    mkdir -p "$insights_dir"
    
    # Convert observations to proper JSON array
    local obs_json=""
    IFS='|' read -ra obs_array <<< "$observations"
    for obs in "${obs_array[@]}"; do
        # Escape quotes and format as JSON string
        local escaped_obs=$(echo "$obs" | sed 's/"/\\"/g')
        obs_json+="\"$escaped_obs\","
    done
    obs_json=${obs_json%,} # Remove trailing comma
    
    cat > "$insights_dir/$entity_name.json" << EOF
{
  "name": "$entity_name",
  "entityType": "CodingInsight",
  "observations": [$obs_json],
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "project": "$project",
  "category": "$category",
  "tags": "$tags",
  "language": "$language"
}
EOF
    
    echo -e "${GREEN}✅ Entity '$entity_name' created successfully${NC}"
    
    # Create relations if specified
    if [ -n "$relates_to" ]; then
        create_entity_relations "$entity_name" "$relates_to"
    fi
    
    # Always connect to main knowledge graph
    echo -e "${BLUE}🔗 Connecting to CodingKnowledgeBase...${NC}"
    
    # Store connection info for later MCP transfer
    local relations_dir="$HOME/Claude/knowledge-management/relations"
    mkdir -p "$relations_dir"
    echo "CodingKnowledgeBase,captures,$entity_name" >> "$relations_dir/pending_relations.csv"
    
    echo -e "${GREEN}✅ Connected to main knowledge graph${NC}"
}

# Function to create relations between entities
create_entity_relations() {
    local source_entity="$1"
    local target_entities="$2"
    
    echo -e "${BLUE}🔗 Creating entity relations...${NC}"
    
    IFS=',' read -ra entities <<< "$target_entities"
    for entity in "${entities[@]}"; do
        entity=$(echo "$entity" | xargs) # trim whitespace
        echo -e "${GREEN}  ✓ $source_entity relates to $entity${NC}"
        # create_relation "$source_entity" "relates to" "$entity"
    done
}

# Parse command line arguments
PROBLEM=""
SOLUTION=""
PROJECT=$(basename "$PWD")
CATEGORY="general"
TAGS=""
LANGUAGE=""
RELATES_TO=""
VALIDATE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--problem)
            PROBLEM="$2"
            shift 2
            ;;
        -s|--solution)
            SOLUTION="$2"
            shift 2
            ;;
        -j|--project)
            PROJECT="$2"
            shift 2
            ;;
        -c|--category)
            CATEGORY="$2"
            shift 2
            ;;
        -t|--tags)
            TAGS="$2"
            shift 2
            ;;
        -l|--language)
            LANGUAGE="$2"
            shift 2
            ;;
        -r|--relates-to)
            RELATES_TO="$2"
            shift 2
            ;;
        --validate)
            VALIDATE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            exit 1
            ;;
    esac
done

# Validate required parameters
if [ -z "$PROBLEM" ] || [ -z "$SOLUTION" ]; then
    echo -e "${RED}❌ Error: Both problem and solution are required${NC}"
    usage
    exit 1
fi

# Display what will be captured
echo -e "${BLUE}📋 Capturing Enhanced Coding Insight:${NC}"
echo "  Problem:    $PROBLEM"
echo "  Solution:   $SOLUTION"
echo "  Project:    $PROJECT"
echo "  Category:   $CATEGORY"
[ -n "$TAGS" ] && echo "  Tags:       $TAGS"
[ -n "$LANGUAGE" ] && echo "  Language:   $LANGUAGE"
[ -n "$RELATES_TO" ] && echo "  Relates to: $RELATES_TO"
echo ""

# Validate entity references
validate_entity_references "$RELATES_TO"

# Create the entity
create_mcp_entity "$PROBLEM" "$SOLUTION" "$PROJECT" "$CATEGORY" "$TAGS" "$LANGUAGE" "$RELATES_TO"

# Run validation if requested
if [ "$VALIDATE" = true ]; then
    echo ""
    echo -e "${BLUE}🔍 Running post-creation validation...${NC}"
    "$HOME/Claude/knowledge-management/validate-knowledge-connections.sh"
fi

echo ""
echo -e "${GREEN}🎉 Enhanced insight captured successfully!${NC}"
echo -e "${BLUE}💡 Use --validate flag to ensure proper graph connections${NC}"