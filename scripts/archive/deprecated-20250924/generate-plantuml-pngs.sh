#!/bin/bash

# Generate PlantUML PNG files from PUML sources
# Follows the standard workflow: docs/puml/*.puml → docs/images/*.png

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎨 PlantUML PNG Generation Workflow${NC}"
echo "================================================"

# Check if plantuml is available
if ! command -v plantuml &> /dev/null; then
    echo -e "${RED}❌ PlantUML not found. Please install with: brew install plantuml${NC}"
    exit 1
fi

# Check directories
PUML_DIR="$ROOT_DIR/docs/puml"
IMAGE_DIR="$ROOT_DIR/docs/images"

if [ ! -d "$PUML_DIR" ]; then
    echo -e "${YELLOW}⚠️  docs/puml/ directory not found. Creating...${NC}"
    mkdir -p "$PUML_DIR"
fi

if [ ! -d "$IMAGE_DIR" ]; then
    echo -e "${YELLOW}⚠️  docs/images/ directory not found. Creating...${NC}"
    mkdir -p "$IMAGE_DIR"
fi

# Find all .puml files
PUML_FILES=$(find "$PUML_DIR" -name "*.puml" -type f)

if [ -z "$PUML_FILES" ]; then
    echo -e "${YELLOW}⚠️  No .puml files found in docs/puml/${NC}"
    echo "Add .puml files to docs/puml/ and run this script again."
    exit 0
fi

echo -e "${GREEN}Found PUML files:${NC}"
echo "$PUML_FILES" | sed 's|.*/||' | sed 's/^/  - /'
echo

# Generate PNG files
GENERATED_COUNT=0
FAILED_COUNT=0

for puml_file in $PUML_FILES; do
    filename=$(basename "$puml_file" .puml)
    echo -e "${BLUE}🔄 Processing: ${filename}.puml${NC}"
    
    if plantuml -tpng "$puml_file" -o "../images/" 2>/dev/null; then
        if [ -f "$IMAGE_DIR/${filename}.png" ]; then
            echo -e "${GREEN}✅ Generated: docs/images/${filename}.png${NC}"
            GENERATED_COUNT=$((GENERATED_COUNT + 1))
        else
            echo -e "${RED}❌ Failed: PNG file not created for ${filename}${NC}"
            FAILED_COUNT=$((FAILED_COUNT + 1))
        fi
    else
        echo -e "${RED}❌ PlantUML error for ${filename}.puml${NC}"
        FAILED_COUNT=$((FAILED_COUNT + 1))
    fi
done

echo
echo "================================================"
echo -e "${GREEN}✅ Generated: $GENERATED_COUNT PNG files${NC}"
if [ $FAILED_COUNT -gt 0 ]; then
    echo -e "${RED}❌ Failed: $FAILED_COUNT files${NC}"
fi

# List generated files
if [ $GENERATED_COUNT -gt 0 ]; then
    echo -e "${BLUE}📁 Generated PNG files:${NC}"
    ls -la "$IMAGE_DIR"/*.png 2>/dev/null | grep -E "$(date +%Y-%m-%d)" | sed 's/^/  /' || \
    ls -la "$IMAGE_DIR"/*.png 2>/dev/null | tail -$GENERATED_COUNT | sed 's/^/  /'
fi

echo
echo -e "${GREEN}🎯 Usage in Markdown:${NC}"
echo "  ![Description](docs/images/filename.png)"
echo
echo -e "${BLUE}💡 Remember:${NC}"
echo "  1. PlantUML source files: docs/puml/*.puml"
echo "  2. Generated PNG files: docs/images/*.png" 
echo "  3. Reference PNGs in markdown, not PUML files"
echo "  4. This workflow ensures consistent diagram management"

if [ $FAILED_COUNT -gt 0 ]; then
    exit 1
fi