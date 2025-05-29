#!/bin/bash
# Quick commit helper for Claude repository

if [ -z "$1" ]; then
    echo "Usage: $0 <commit message>"
    exit 1
fi

echo "=== Adding all changes ==="
git -C ~/Claude add .

echo ""
echo "=== Committing with message: $1 ==="
git -C ~/Claude commit -m "$1"

echo ""
echo "=== Current status ==="
git -C ~/Claude status --short --branch