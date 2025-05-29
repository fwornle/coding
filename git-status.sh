#!/bin/bash
# Quick git status for Claude repository

echo "=== Claude Repository Status ==="
git -C ~/Claude status --short --branch
echo ""
echo "Recent commits:"
git -C ~/Claude log --oneline -5