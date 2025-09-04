#!/bin/bash

# Generate all PNG files correctly (avoid duplicate issue)
# The issue was using -o parameter - generate in place then move

cd docs/puml

echo "Generating PNG files correctly..."

count=0
errors=0

for puml_file in *.puml; do
    # Skip the style file
    if [[ "$puml_file" == "_standard-style.puml" ]]; then
        continue
    fi
    
    echo "Processing $puml_file..."
    
    # Generate PNG in current directory
    if plantuml -tpng "$puml_file" 2>/dev/null; then
        # Move to images directory
        png_file="${puml_file%.puml}.png"
        if [[ -f "$png_file" ]]; then
            mv "$png_file" ../images/
            count=$((count + 1))
            echo "  ✅ Generated $png_file"
        else
            echo "  ❌ PNG not generated for $puml_file"
            errors=$((errors + 1))
        fi
    else
        echo "  ❌ PlantUML error for $puml_file"
        errors=$((errors + 1))
    fi
done

echo ""
echo "=========================================="
echo "PNG Generation Summary"
echo "=========================================="
echo "✅ Successfully generated: $count files"
echo "❌ Errors: $errors files"
echo ""
echo "Files generated in: docs/images/"