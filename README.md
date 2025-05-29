# Claude Scripts Collection

This repository contains various scripts and tools created with Claude Code, organized by topic.

## Directory Structure

```
~/Claude/
├── README.md                  # This file
├── knowledge-management/      # Knowledge capture and visualization tools
│   ├── README.md             # Detailed docs for knowledge management
│   ├── vkb                   # Visual Knowledge Base viewer
│   ├── capture-*.sh          # Knowledge capture scripts
│   ├── query-*.sh            # Knowledge query tools
│   └── ...                   # Other knowledge management scripts
└── [future-topics]/          # Additional topic directories as needed
```

## Topics

### Knowledge Management
Tools for capturing, organizing, and visualizing coding insights and knowledge.
- **Main tool**: `vkb` - Visual Knowledge Base viewer
- See `knowledge-management/README.md` for detailed documentation

### Future Topics
Additional subdirectories will be created as new script categories are developed:
- `automation/` - Task automation scripts
- `development/` - Development workflow tools
- `analysis/` - Code analysis utilities
- `productivity/` - Productivity enhancers

## Quick Access

The most commonly used scripts have aliases in `~/.zshrc`:
```bash
alias vkb="~/Claude/knowledge-management/vkb"
```

## Version Control

This entire directory is under git version control. To work with the repository:

```bash
cd ~/Claude
git status              # Check current status
git add .              # Stage changes
git commit -m "msg"    # Commit changes
git log                # View history
```

## Contributing

When adding new scripts:
1. Create an appropriate topic subdirectory if it doesn't exist
2. Place the script in the relevant subdirectory
3. Update the subdirectory's README.md
4. Commit changes with a descriptive message

## License

These scripts are personal tools created for productivity enhancement.