# Multi-Team Knowledge Base Setup

The coding tools system supports multi-team environments with isolated knowledge bases while maintaining shared cross-team patterns.

## Overview

### Team Structure

- **ui** - UI/Frontend development (React, TypeScript, web technologies)
- **resi** - Resilience engineering (C++, systems programming, performance optimization)
- **raas** - RaaS development (Java, DevOps, microservices, cloud infrastructure)
- **custom** - Any custom team name you define
- **individual** - Single developer setup (default behavior)

### Knowledge Base Files

When using teams, the system creates separate knowledge files:

```
shared-memory-coding.json    # Cross-team patterns (always loaded)
shared-memory-ui.json        # UI/Frontend team knowledge
shared-memory-resi.json      # Resilience team knowledge  
shared-memory-raas.json      # RaaS team knowledge
shared-memory-custom.json    # Custom team knowledge
```

**Important**: The `shared-memory-coding.json` file is **always loaded** regardless of team setting. This contains patterns that apply across all teams.

## Installation with Team Setup

### During Initial Installation

Run the installer and select your team when prompted:

```bash
./install.sh
```

The installer will ask:

```
🏢 Multi-Team Knowledge Base Configuration
=========================================

Select your team configuration:
1) Individual developer (single knowledge base)
2) UI/Frontend team (ui)
3) Resilience team (resi)
4) RaaS team (raas)
5) Custom team name

Choice [1-5]: 
```

### Setting Team After Installation

You can set your team environment variable manually:

```bash
# In your shell profile (.bashrc, .zshrc, etc.)
export CODING_TEAM=ui

# Or temporarily for a session
CODING_TEAM=resi claude-mcp
```

## Team-Specific Knowledge Management

### Adding Knowledge to Your Team

When `CODING_TEAM` is set, new knowledge goes to your team file:

```bash
# Add entity to your team's knowledge base
ukb --add-entity --name "TeamSpecificPattern" --type "TechnicalPattern"

# Interactive mode (saves to team file)
ukb --interactive
```

### Viewing Team Knowledge

```bash
# View your team's knowledge
vkb

# View specific team (if you have access)
CODING_TEAM=ui vkb
```

### Cross-Team Patterns

Some patterns are automatically classified as cross-team and go to `shared-memory-coding.json`:

- ConditionalLoggingPattern
- KnowledgePersistencePattern  
- NetworkAwareInstallationPattern
- CodingWorkflow
- MCPMemoryLoggingIntegrationPattern
- VSCodeExtensionBridgePattern
- UkbCli / VkbCli

## Team Categorization Rules

The system automatically categorizes entities based on:

### UI/Frontend (ui)
- **Keywords**: react, vue, angular, javascript, typescript, css, html, web, frontend, ui, component, redux, state, browser
- **Technologies**: React, Vue, Angular, JavaScript, TypeScript, CSS, HTML, Redux, Three.js
- **Entity Types**: ReactPattern, ComponentPattern, WebPattern, UIPattern

### Resilience (resi)  
- **Keywords**: c++, cpp, memory, performance, optimization, algorithm, system, native, embedded, real-time, low-level
- **Technologies**: C++, C, Assembly, CUDA, OpenMP
- **Entity Types**: SystemPattern, PerformancePattern, AlgorithmPattern, MemoryPattern

### RaaS (raas)
- **Keywords**: java, spring, devops, docker, kubernetes, jenkins, maven, gradle, microservice, api, rest, cloud, aws, deployment
- **Technologies**: Java, Spring, Docker, Kubernetes, Jenkins, Maven, Gradle, AWS, GCP  
- **Entity Types**: DevOpsPattern, ServicePattern, DeploymentPattern, InfrastructurePattern

## Migration from Single Knowledge Base

If you have an existing `shared-memory.json`, you can migrate to the multi-team structure:

```bash
# Run the migration script
node scripts/migrate-to-multi-team.js
```

This will:
1. Analyze your existing entities
2. Categorize them by team based on technologies/keywords
3. Create team-specific files
4. Backup your original file

## Working with Teams

### Switching Teams

```bash
# Switch to different team for a session
CODING_TEAM=resi claude-mcp

# Permanently switch teams
echo 'export CODING_TEAM=raas' >> ~/.zshrc
source ~/.zshrc
```

### Sharing Knowledge Between Teams

Cross-team patterns automatically go to `shared-memory-coding.json` and are visible to all teams. For manual sharing:

1. **Review pattern**: Determine if it's truly cross-team
2. **Move manually**: Copy from team file to `shared-memory-coding.json`
3. **Update categorization**: Add pattern name to `CODING_PATTERNS` in migration script

### Team Isolation

Teams cannot see each other's specific knowledge by default. This prevents:
- Pattern pollution between different technology stacks
- Conflicting architectural decisions
- Overwhelming context for specialized teams

## Best Practices

### For Team Leads

1. **Establish team conventions** early in `shared-memory-<team>.json`
2. **Promote valuable patterns** to cross-team knowledge when applicable
3. **Regular knowledge reviews** to maintain quality and relevance
4. **Cross-team pattern sharing** sessions for architecture alignment

### For Individual Contributors

1. **Use appropriate team context** when adding knowledge
2. **Check cross-team patterns** first before creating team-specific ones
3. **Contribute back** valuable patterns that could help other teams
4. **Maintain pattern quality** in your team's knowledge base

### For Organizations

1. **Standardize team names** across the organization
2. **Regular knowledge audits** to identify cross-team patterns
3. **Team knowledge backup** strategies
4. **Cross-team pattern governance** for architectural consistency

## Environment Variables Reference

```bash
# Team configuration
CODING_TEAM=ui                    # Your team identifier

# Paths (usually auto-configured)
CODING_KNOWLEDGE_BASE=/path/to/shared-memory.json
CODING_TOOLS_PATH=/path/to/coding

# Multi-team file paths (auto-generated)
# shared-memory-coding.json        # Always loaded
# shared-memory-${CODING_TEAM}.json # Team-specific
```

## Troubleshooting

### Team Knowledge Not Loading

```bash
# Check team configuration
echo $CODING_TEAM

# Verify team file exists
ls shared-memory-${CODING_TEAM}.json

# Test knowledge loading
ukb --status --team $CODING_TEAM
```

### Knowledge Going to Wrong Team

1. Check `CODING_TEAM` environment variable
2. Verify categorization rules in `scripts/migrate-to-multi-team.js`
3. Manually move entities between files if needed

### Cross-Team Pattern Issues

1. Review `CODING_PATTERNS` list in migration script
2. Manually categorize ambiguous patterns
3. Update categorization rules for future entities

## Advanced Configuration

### Custom Team Rules

Edit `scripts/migrate-to-multi-team.js` to add custom team patterns:

```javascript
const TEAM_PATTERNS = {
  your_team: {
    name: 'Your Team Name',
    keywords: ['keyword1', 'keyword2'],
    technologies: ['Tech1', 'Tech2'],
    entityTypes: ['CustomPattern']
  }
};
```

### Team-Specific VKB Ports

Configure different visualization ports per team:

```bash
# Team-specific VKB ports
VKB_PORT_FW=8081
VKB_PORT_RESI=8082  
VKB_PORT_RAAS=8083
```

This ensures teams can run concurrent knowledge visualizations without conflicts.