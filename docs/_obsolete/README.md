# Obsolete Documentation Archive

This directory contains documentation that has been superseded by the new MkDocs-based documentation in `docs-content/`.

## Why This Exists

As part of the documentation restructuring, we consolidated ~57 markdown files and ~153 images into a focused, organized MkDocs site. Content that was:

- Redundant (covered elsewhere)
- Outdated (no longer accurate)
- Historical (implementation details no longer relevant)

...has been moved here for reference rather than deleted.

## Directory Structure

```
_obsolete/
  architecture/     # Legacy architecture docs
  images/           # Unused/redundant images
  integrations/     # Superseded integration docs
  health-system/    # Historical health system docs
  knowledge-management/  # Old knowledge management docs
```

## Current Documentation

The new documentation is in `docs-content/` and is served via MkDocs:

- **Getting Started** - Installation, configuration, Docker
- **Core Systems** - LSL, UKB/VKB, Constraints, Trajectories
- **Architecture** - System design, health monitoring, data flow
- **Integrations** - MCP servers and tools
- **Reference** - Commands, API, troubleshooting

## Restoring Content

If you need to restore any content:

1. Check this archive for the original file
2. Copy relevant portions to the appropriate `docs-content/` location
3. Update navigation in `mkdocs.yml`

## Migration Date

This archive was created as part of the documentation restructuring on 2026-02-01.
