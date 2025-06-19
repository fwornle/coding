# Coding Agent Startup Checklist

## Critical Rules (Apply Immediately)

1. **🚨 LOGGING**: NEVER `console.log` - ALWAYS `Logger.log(level, category, message)`
2. **🚨 STATE**: NEVER `useState` for complex state - ALWAYS Redux slices  
3. **🚨 KNOWLEDGE**: NEVER edit `shared-memory.json` - ALWAYS use `ukb` command
4. **🚨 PATTERNS**: Query existing patterns before implementing: `ukb --list-entities | grep Pattern`
5. **🚨 STARTUP**: Use `claude-mcp` (not `claude code`) for MCP memory access

## Session Initialization

6. **Check MCP Memory**: Verify knowledge base sync at session start
7. **Query Critical Patterns**: ConditionalLogging, Redux, KnowledgePersistence, ViewportCulling
8. **Start Visualization**: `vkb` for pattern exploration at localhost:8080
9. **Verify Compliance**: Run pattern checks before implementing new features

## Development Rules

10. **React Projects**: Use Redux Toolkit with typed hooks, feature-based slices
11. **3D Graphics**: Apply viewport culling for 50+ objects, use React Three Fiber
12. **Performance**: Implement viewport culling when rendering 200+ elements
13. **Logging Categories**: auth, api, component, validation, performance, error
14. **Knowledge Capture**: Run `ukb` after significant changes or insights

## Quality Assurance

15. **Pre-commit**: Run linting/typechecking, verify no `console.log` usage, check Redux compliance

*This checklist ensures consistent application of proven patterns across all coding sessions.*