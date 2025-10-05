# Current Installation & Startup Flow

## Installation (install.sh)
1. check_dependencies()
2. detect_agents()
3. configure_team_setup()
4. install_node_dependencies()
5. install_plantuml()
6. install_memory_visualizer()
7. install_browserbase()
8. install_semantic_analysis()
9. install_serena()
10. install_shadcn_mcp()
11. install_mcp_servers()
12. create_command_wrappers()
13. setup_unified_launcher()
14. configure_shell_environment()
15. initialize_shared_memory()
16. create_example_configs()
17. setup_mcp_config()
18. setup_vscode_extension()
19. install_enhanced_lsl() <- ISSUE: Function name concatenated with verify_installation
20. verify_installation() <- ISSUE: Not properly defined

## Startup (coding → launch-claude.sh → start-services.sh)
1. bin/coding (unified launcher)
2. scripts/launch-claude.sh
   - Loads environment (.env, .env.ports)
   - Calls start-services.sh
   - Calls verify_monitoring_systems (monitoring-verifier.js)
   - Starts global-lsl-coordinator for transcript monitoring
   - Starts statusline-health-monitor daemon
   - Launches claude-mcp

3. start-services.sh
   - Cleans up existing processes/ports
   - Checks Docker for Constraint Monitor
   - Starts Live Logging (enhanced-transcript-monitor.js + live-logging-coordinator.js)
   - Starts VKB Server (port 8080)
   - Configures Semantic Analysis MCP (stdio transport)
   - Creates .services-running.json
