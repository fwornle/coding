# Claude Code Session Log

**Session:** 2025-10-26_1200-1300
**Type:** Coding/Development
**Time Range:** 2025-10-26T11:06:41.632Z - 2025-11-10T06:35:11.455Z
**Prompt Sets:** 2
**Classification:** Majority (100.0%) of file operations target coding repo: /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml, /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/images, Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml, Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/images, /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/, Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/, /Users/q284340/Agentic/coding/integrations/memory-visualizer., Users/q284340/Agentic/coding/integrations/memory-visualizer

---

<a name="ps_1761476801632"></a>
## Prompt Set 1 (ps_1761476801632)

**Time:** 2025-10-26T11:06:41.632Z
**Duration:** 1279709822ms
**Tool Calls:** 2

### User

create a docs folder in /Users/q284340/Agentic/coding/integrations/memory-visualizer. Inside this folder, create a puml folder and an images folder

### Assistant

I'll create the documentation folder structure for the memory-visualizer integration.

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "mkdir -p /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/images",
  "description": "Create docs folder structure with puml and images subdirectories"
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "ls -la /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/",
  "description": "Verify folder structure created successfully"
}
```

### User

**Result:** ✅ Success

No result content

### User

**Result:** ✅ Success

total 0
drwxr-xr-x@  4 q284340  staff  128 Oct 26 12:06 .
drwxr-xr-x@ 25 q284340  staff  800 Oct 26 12:06 ..
drwxr-xr-x@  2 q284340  staff   64 Oct 26 12:06 images
drwxr-xr-x@  2 q284340  staff   64 Oct 26 12:06 puml

### Assistant

Perfect! I've successfully created the documentation folder structure for the memory-visualizer integration:

```
/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/
├── images/     # For PNG diagram files
└── puml/       # For PlantUML source files
```

The folders are now ready for documentation. The structure follows the same pattern used in the mcp-server-semantic-analysis integration, where:
- **docs/puml/** contains PlantUML source files (*.puml)
- **docs/images/** contains generated PNG diagrams and other image assets

---

<a name="ps_1761477265308"></a>
## Prompt Set 2 (ps_1761477265308)

**Time:** 2025-10-26T11:14:25.308Z
**Duration:** 1279246147ms
**Tool Calls:** 42

### User

document the memory-visualizer (in the newly created docs folder). When creating plantuml diagrams, make sure you use the coding/docs/_standard-style.puml and, when turning the pumls (in the newly created puml folder) to pngs, move the latter to the newly created images folder. Make sure the diagrams are more vertically oriented. Make sure every document you create can be reached from the top-level README.md of the repo (re-write this one from scratch - use the screenshots inside the images folder, insights.png and viewer.png - the former is a view showing detailed insights, the latter is the main overview image of the viewer.

### Assistant

I'll document the memory-visualizer integration comprehensively. Let me start by exploring the current structure and then create complete documentation.

### Assistant

**Tool:** mcp__serena__list_dir
**Input:** ```json
{
  "relative_path": "integrations/memory-visualizer",
  "recursive": false,
  "skip_ignored_files": true
}
```

### Assistant

**Tool:** Read
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/package.json"
}
```

### Assistant

**Tool:** mcp__serena__list_dir
**Input:** ```json
{
  "relative_path": "integrations/memory-visualizer/src",
  "recursive": false,
  "skip_ignored_files": true
}
```

### Assistant

**Tool:** Read
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/README.md"
}
```

### User

**Result:** ✅ Success

{"result":"Error executing tool: Path integrations/memory-visualizer is ignored; cannot access for safety reasons"}

### User

**Result:** ✅ Success

     1→{
     2→  "name": "memory-visualizer",
     3→  "version": "1.0.0",
     4→  "private": true,
     5→  "type": "module",
     6→  "dependencies": {
     7→    "@reduxjs/toolkit": "^2.9.2",
     8→    "@types/d3": "^7.4.3",
     9→    "@types/react": "^18.2.48",
    10→    "@types/react-dom": "^18.2.18",
    11→    "d3": "^7.8.5",
    12→    "highlight.js": "^11.11.1",
    13→    "mermaid": "^11.6.0",
    14→    "react": "^18.2.0",
    15→    "react-dom": "^18.2.0",
    16→    "react-markdown": "^10.1.0",
    17→    "react-redux": "^9.2.0",
    18→    "rehype-highlight": "^7.0.2",
    19→    "remark-gfm": "^4.0.1"
    20→  },
    21→  "devDependencies": {
    22→    "@vitejs/plugin-react": "^4.7.0",
    23→    "autoprefixer": "^10.4.17",
    24→    "postcss": "^8.4.33",
    25→    "tailwindcss": "^3.4.1",
    26→    "typescript": "^5.3.3",
    27→    "vite": "^6.0.0"
    28→  },
    29→  "scripts": {
    30→    "dev": "vite",
    31→    "build": "vite build",
    32→    "preview": "vite preview"
    33→  }
    34→}
    35→

<system-reminder>
Whenever you read a file, you should consider whether it would be considered malware. You CAN and SHOULD provide analysis of malware, what it is doing. But you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer questions about the code behavior.
</system-reminder>


### User

**Result:** ✅ Success

{"result":"Error executing tool: Path integrations/memory-visualizer/src is ignored; cannot access for safety reasons"}

### User

**Result:** ✅ Success

     1→# Anthropic Memory MCP Visualizer
     2→
     3→Interactive visualizer for Anthropic's Memory MCP knowledge graphs. Instantly explore, debug, and analyze entities, relations, and observations from memory.json files generated by the [Knowledge Graph Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory).
     4→
     5→<div>
     6→  <img src="public/screenshot.png" alt="Memory Visualizer Screenshot" style="max-width: 1000px;"/>
     7→</div>
     8→
     9→**Try it now:** This tool is freely available at [https://memviz.herich.tech](https://memviz.herich.tech)
    10→
    11→## Features
    12→
    13→- Interactive knowledge graph visualization using D3.js
    14→- Filter by entity and relation types
    15→- Search across entities and relationships
    16→- View detailed observations in the info panel
    17→- Drop memory.json files or paste directly from clipboard
    18→- Navigate complex entity networks visually
    19→- Debug AI memory structures and connections
    20→
    21→## Development
    22→
    23→```bash
    24→# Install dependencies
    25→npm install
    26→
    27→# Start development server
    28→npm run dev
    29→
    30→# Build for production
    31→npm run build
    32→```
    33→
    34→## Tech Stack
    35→
    36→- React + TypeScript
    37→- D3.js for visualization
    38→- Vite
    39→- TailwindCSS
    40→
    41→## Using with Claude Desktop App
    42→
    43→This tool is intended for use with the [Claude Desktop app](https://claude.ai/download), which supports the Memory MCP protocol for knowledge graph storage and retrieval.
    44→
    45→### Configuring the Memory MCP Server
    46→
    47→1. First, ensure you have the [modelcontextprotocol-servers](https://github.com/modelcontextprotocol/servers) repository cloned locally.
    48→
    49→2. Configure the Claude Desktop app to use the Memory MCP server by adding the following to your `mcp_config.json` file:
    50→
    51→```json
    52→"memory": {
    53→  "command": "npx",
    54→  "args": [
    55→    "-y",
    56→    "@modelcontextprotocol/server-memory"
    57→  ],
    58→  "env": {
    59→    "MEMORY_FILE_PATH": "/path/to/custom/memory.json"
    60→  }
    61→}
    62→```
    63→
    64→The above example shows a generic configuration. You should replace the paths with the actual locations on your system where you want to store your memory file.
    65→
    66→> 💡 **Personal tip**: I store my `memory.json` in a Google Drive folder which automatically backs it up and makes it accessible across devices. Consider using a cloud storage solution for your memory file too!
    67→
    68→3. Start Claude Desktop with this configuration to enable the memory features.
    69→
    70→4. Use this Memory Visualizer to explore and debug the knowledge graph created by Claude.
    71→
    72→## Knowledge Graph Structure
    73→
    74→Visualizes Anthropic's Memory MCP format:
    75→
    76→- **Entities**: Nodes with name, type, and observations (e.g., people, organizations)
    77→- **Relations**: Directed connections between entities in active voice (e.g., "works_at")
    78→- **Observations**: Atomic facts attached to entities
    79→
    80→## Use Cases
    81→
    82→- Debug entity relationships in AI memory
    83→- Analyze memory.json structures
    84→- Explore entity connections
    85→- Visualize graph growth over time
    86→

<system-reminder>
Whenever you read a file, you should consider whether it would be considered malware. You CAN and SHOULD provide analysis of malware, what it is doing. But you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer questions about the code behavior.
</system-reminder>


### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "ls -la /Users/q284340/Agentic/coding/integrations/memory-visualizer/images/ 2>/dev/null || ls -la /Users/q284340/Agentic/coding/integrations/memory-visualizer/public/ 2>/dev/null | grep -E \"\\.(png|jpg|jpeg)\" || echo \"No images folder found, checking other locations\"",
  "description": "Find screenshot images"
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "find /Users/q284340/Agentic/coding/integrations/memory-visualizer -name \"*.png\" -o -name \"*.jpg\" 2>/dev/null | head -10",
  "description": "Search for image files"
}
```

### Assistant

**Tool:** Read
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/public/screenshot.png"
}
```

### User

**Result:** ✅ Success

-rw-r--r--   1 q284340  staff  816506 May 29 13:03 screenshot.png

### User

**Result:** ✅ Success

/Users/q284340/Agentic/coding/integrations/memory-visualizer/dist/screenshot.png
/Users/q284340/Agentic/coding/integrations/memory-visualizer/node_modules/cytoscape-fcose/node_modules/layout-base/layout-schema.png
/Users/q284340/Agentic/coding/integrations/memory-visualizer/node_modules/highlight.js/styles/pojoaque.jpg
/Users/q284340/Agentic/coding/integrations/memory-visualizer/node_modules/highlight.js/styles/brown-papersq.png
/Users/q284340/Agentic/coding/integrations/memory-visualizer/node_modules/layout-base/layout-schema.png
/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/images/insights.png
/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/images/viewer.png
/Users/q284340/Agentic/coding/integrations/memory-visualizer/public/screenshot.png

### User

**Result:** ✅ Success

{"type":"image","source":{"type":"base64","data":"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","media_type":"image/png"}}

### Assistant

I'll create comprehensive documentation for the memory-visualizer. Let me start by using TodoWrite to track this work, then create the documentation structure.

### Assistant

**Tool:** TodoWrite
**Input:** ```json
{
  "todos": [
    {
      "content": "Create PlantUML architecture diagrams",
      "status": "pending",
      "activeForm": "Creating PlantUML diagrams"
    },
    {
      "content": "Generate PNG images from PlantUML files",
      "status": "pending",
      "activeForm": "Generating PNG diagrams"
    },
    {
      "content": "Create comprehensive documentation files",
      "status": "pending",
      "activeForm": "Creating documentation files"
    },
    {
      "content": "Rewrite top-level README.md",
      "status": "pending",
      "activeForm": "Rewriting README.md"
    }
  ]
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "ls /Users/q284340/Agentic/coding/integrations/memory-visualizer/src/ 2>/dev/null | head -20",
  "description": "Explore source structure"
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "find /Users/q284340/Agentic/coding/integrations/memory-visualizer/src -name \"*.tsx\" -o -name \"*.ts\" 2>/dev/null | head -15",
  "description": "Find TypeScript/React files"
}
```

### User

**Result:** ✅ Success

Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable

### User

**Result:** ✅ Success

/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/App.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/main.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/utils/graphHelpers.ts
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/MermaidDiagram.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/Filters/TeamFilter.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/Filters/SourceFilter.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/Filters/SearchFilter.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/Filters/TypeFilters.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/TeamSelector.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/KnowledgeGraph/index.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/KnowledgeGraph/NodeDetails.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/KnowledgeGraph/GraphVisualization.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/MarkdownViewer.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/components/KnowledgeGraphVisualization.tsx
/Users/q284340/Agentic/coding/integrations/memory-visualizer/src/api/databaseClient.ts

### User

**Result:** ✅ Success

api
App.tsx
components
index.css
intents
main.tsx
store
utils

### Assistant

Now let me create the PlantUML diagrams first:

### Assistant

**Tool:** TodoWrite
**Input:** ```json
{
  "todos": [
    {
      "content": "Create PlantUML architecture diagrams",
      "status": "in_progress",
      "activeForm": "Creating PlantUML diagrams"
    },
    {
      "content": "Generate PNG images from PlantUML files",
      "status": "pending",
      "activeForm": "Generating PNG diagrams"
    },
    {
      "content": "Create comprehensive documentation files",
      "status": "pending",
      "activeForm": "Creating documentation files"
    },
    {
      "content": "Rewrite top-level README.md",
      "status": "pending",
      "activeForm": "Rewriting README.md"
    }
  ]
}
```

### Assistant

**Tool:** Write
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/architecture.puml",
  "content": "@startuml architecture\n!include ../../../docs/puml/_standard-style.puml\n\ntitle Memory Visualizer - System Architecture\n\npackage \"Frontend (React + TypeScript)\" {\n  component [App.tsx] as APP <<react>>\n\n  package \"Components\" {\n    component [KnowledgeGraph] as KG <<react>>\n    component [GraphVisualization] as GRAPH <<react>>\n    component [NodeDetails] as DETAILS <<react>>\n    component [Filters] as FILTERS <<react>>\n    component [MarkdownViewer] as MARKDOWN <<react>>\n    component [MermaidDiagram] as MERMAID <<react>>\n  }\n\n  package \"State Management\" {\n    component [Redux Store] as STORE <<state>>\n    component [Graph Slice] as SLICE <<state>>\n  }\n\n  package \"API Layer\" {\n    component [databaseClient] as CLIENT <<api>>\n  }\n\n  package \"Utilities\" {\n    component [graphHelpers] as HELPERS <<util>>\n  }\n}\n\npackage \"Visualization Layer\" {\n  component [D3.js] as D3 <<library>>\n  component [Mermaid] as MERMAID_LIB <<library>>\n}\n\npackage \"Data Sources\" {\n  storage [memory.json] as MEMORY <<file>>\n  storage [GraphDB\\n(LevelDB)] as GRAPHDB <<database>>\n}\n\n' Component relationships\nAPP --> KG\nAPP --> STORE\n\nKG --> GRAPH\nKG --> DETAILS\nKG --> FILTERS\n\nGRAPH --> D3\nGRAPH --> HELPERS\nDETAILS --> MARKDOWN\nDETAILS --> MERMAID\n\nMERMAID --> MERMAID_LIB\nMARKDOWN --> MERMAID\n\nSTORE --> SLICE\nSLICE --> CLIENT\n\nCLIENT --> MEMORY : \"load/parse\"\nCLIENT --> GRAPHDB : \"query\"\n\nHELPERS --> STORE : \"read state\"\n\nnote right of MEMORY\n  JSON file format:\n  - entities[]\n  - relations[]\n  - observations[]\nend note\n\nnote right of GRAPHDB\n  LevelDB backend:\n  - Real-time queries\n  - Multi-team support\n  - Team isolation\nend note\n\nnote bottom of D3\n  Force-directed graph layout\n  Interactive node dragging\n  Zoom and pan support\n  Dynamic link rendering\nend note\n\nlegend right\n  |= Component Type |= Description |\n  | <back:#E6F3FF>react</back> | React Component |\n  | <back:#FFE6E6>state</back> | Redux State Management |\n  | <back:#E6FFE6>api</back> | API/Data Layer |\n  | <back:#FFF4E6>util</back> | Utility Functions |\n  | <back:#F0E6FF>library</back> | External Library |\nendlegend\n\n@enduml\n"
}
```

### Assistant

**Tool:** Write
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/data-flow.puml",
  "content": "@startuml data-flow\n!include ../../../docs/puml/_standard-style.puml\n\ntitle Memory Visualizer - Data Flow Sequence\n\nactor User\nparticipant \"Browser\\n(React App)\" as APP\nparticipant \"Redux Store\" as STORE\nparticipant \"Database Client\" as CLIENT\nparticipant \"Graph Helpers\" as HELPERS\nparticipant \"D3 Visualization\" as D3\ndatabase \"Data Source\\n(memory.json\\nor GraphDB)\" as DATA\n\n== Initialization ==\n\nUser -> APP : Open application\nactivate APP\n\nAPP -> STORE : Initialize store\nactivate STORE\nSTORE -> CLIENT : Check for data source\nactivate CLIENT\n\nalt GraphDB Available\n    CLIENT -> DATA : Query GraphDB\n    activate DATA\n    DATA --> CLIENT : Return entities & relations\n    deactivate DATA\nelse JSON File Upload\n    User -> APP : Upload memory.json\n    APP -> CLIENT : Parse JSON file\n    CLIENT -> CLIENT : Validate structure\nend\n\nCLIENT --> STORE : Load graph data\ndeactivate CLIENT\nSTORE --> APP : Data ready\ndeactivate STORE\n\nAPP -> D3 : Initialize visualization\nactivate D3\nD3 -> HELPERS : Process graph layout\nactivate HELPERS\nHELPERS -> HELPERS : Calculate positions\nHELPERS -> HELPERS : Build force simulation\nHELPERS --> D3 : Return layout data\ndeactivate HELPERS\nD3 --> APP : Render graph\ndeactivate D3\n\ndeactivate APP\n\n== User Interaction ==\n\nUser -> APP : Click entity node\nactivate APP\n\nAPP -> STORE : Get selected entity\nactivate STORE\nSTORE -> CLIENT : Fetch entity details\nactivate CLIENT\nCLIENT -> DATA : Query observations\nactivate DATA\nDATA --> CLIENT : Return observations\ndeactivate DATA\nCLIENT --> STORE : Entity data\ndeactivate CLIENT\nSTORE --> APP : Complete entity info\ndeactivate STORE\n\nAPP -> APP : Update NodeDetails panel\nAPP --> User : Show entity details\n\ndeactivate APP\n\n== Filtering ==\n\nUser -> APP : Apply filters\nactivate APP\n\nAPP -> STORE : Update filter state\nactivate STORE\nSTORE -> HELPERS : Filter graph data\nactivate HELPERS\nHELPERS -> HELPERS : Apply type filters\nHELPERS -> HELPERS : Apply search filter\nHELPERS --> STORE : Filtered results\ndeactivate HELPERS\nSTORE --> APP : Updated dataset\ndeactivate STORE\n\nAPP -> D3 : Re-render graph\nactivate D3\nD3 -> D3 : Update nodes & links\nD3 --> APP : Visualization updated\ndeactivate D3\n\nAPP --> User : Show filtered graph\n\ndeactivate APP\n\n== Team Selection ==\n\nUser -> APP : Select team\nactivate APP\n\nAPP -> STORE : Change active team\nactivate STORE\nSTORE -> CLIENT : Query team data\nactivate CLIENT\nCLIENT -> DATA : Fetch team entities\nactivate DATA\nDATA --> CLIENT : Team-specific data\ndeactivate DATA\nCLIENT --> STORE : Team graph\ndeactivate CLIENT\nSTORE --> APP : Updated data\ndeactivate STORE\n\nAPP -> D3 : Rebuild visualization\nactivate D3\nD3 -> HELPERS : Recalculate layout\nactivate HELPERS\nHELPERS --> D3 : New layout\ndeactivate HELPERS\nD3 --> APP : Render team graph\ndeactivate D3\n\nAPP --> User : Display team knowledge\n\ndeactivate APP\n\nnote over APP, DATA\n  **Data Sources:**\n  1. **memory.json** - Static file upload\n  2. **GraphDB (LevelDB)** - Live database queries\n\n  **Multi-Team Support:**\n  - Team isolation in queries\n  - Domain-specific knowledge bases\n  - Cross-team navigation\nend note\n\nlegend right\n  |= Interaction Type |\n  | <back:#E6F3FF>   </back> Initialization |\n  | <back:#FFE6E6>   </back> User Action |\n  | <back:#E6FFE6>   </back> Data Query |\n  | <back:#FFF4E6>   </back> Visualization |\nendlegend\n\n@enduml\n"
}
```

### Assistant

**Tool:** Write
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml",
  "content": "@startuml component-structure\n!include ../../../docs/puml/_standard-style.puml\n\ntitle Memory Visualizer - Component Structure\n\npackage \"Memory Visualizer Application\" {\n\n  component [App.tsx] as APP <<root>> #FFE6CC {\n    Main application component\n    Routing and layout\n    State provider\n  }\n\n  package \"Knowledge Graph Module\" #E6F3FF {\n    component [KnowledgeGraph/index.tsx] as KG {\n      Main graph container\n      Orchestrates visualization\n      Manages selection state\n    }\n\n    component [GraphVisualization.tsx] as GRAPH {\n      D3.js force-directed graph\n      Interactive node dragging\n      Zoom and pan controls\n      Link rendering\n    }\n\n    component [NodeDetails.tsx] as DETAILS {\n      Entity information panel\n      Observations display\n      Relations listing\n      Markdown rendering\n    }\n  }\n\n  package \"Filtering Module\" #FFE6E6 {\n    component [TypeFilters.tsx] as TYPE_FILTER {\n      Entity type dropdown\n      Relation type dropdown\n      Multi-select support\n    }\n\n    component [SearchFilter.tsx] as SEARCH {\n      Text search input\n      Real-time filtering\n      Entity/relation search\n    }\n\n    component [TeamFilter.tsx] as TEAM_FILTER {\n      Team selection dropdown\n      Multi-team support\n      Domain isolation\n    }\n\n    component [SourceFilter.tsx] as SOURCE_FILTER {\n      Data source selection\n      JSON upload\n      GraphDB connection\n    }\n  }\n\n  package \"Rendering Components\" #E6FFE6 {\n    component [MarkdownViewer.tsx] as MARKDOWN {\n      Markdown rendering\n      Syntax highlighting\n      GFM support\n    }\n\n    component [MermaidDiagram.tsx] as MERMAID {\n      Mermaid diagram support\n      Auto-detection\n      SVG rendering\n    }\n  }\n\n  package \"State Management\" #FFF4E6 {\n    component [store/index.ts] as STORE {\n      Redux store configuration\n      Middleware setup\n    }\n\n    component [store/graphSlice.ts] as SLICE {\n      Graph state\n      Filter state\n      Selection state\n      Actions & reducers\n    }\n  }\n\n  package \"API Layer\" #F0E6FF {\n    component [api/databaseClient.ts] as CLIENT {\n      GraphDB queries\n      JSON parsing\n      Data validation\n      Team filtering\n    }\n  }\n\n  package \"Utilities\" #E6E6FF {\n    component [utils/graphHelpers.ts] as HELPERS {\n      Graph algorithms\n      Layout calculations\n      Filter functions\n      Data transformations\n    }\n  }\n}\n\n' Relationships\nAPP --> KG : \"renders\"\nAPP --> STORE : \"provides context\"\n\nKG --> GRAPH : \"uses\"\nKG --> DETAILS : \"uses\"\nKG --> TYPE_FILTER : \"uses\"\nKG --> SEARCH : \"uses\"\nKG --> TEAM_FILTER : \"uses\"\nKG --> SOURCE_FILTER : \"uses\"\n\nGRAPH --> HELPERS : \"calls\"\nGRAPH --> STORE : \"reads/writes\"\n\nDETAILS --> MARKDOWN : \"renders with\"\nDETAILS --> MERMAID : \"renders with\"\nDETAILS --> STORE : \"reads\"\n\nTYPE_FILTER --> STORE : \"dispatches actions\"\nSEARCH --> STORE : \"dispatches actions\"\nTEAM_FILTER --> STORE : \"dispatches actions\"\nSOURCE_FILTER --> STORE : \"dispatches actions\"\n\nSTORE --> SLICE : \"contains\"\nSLICE --> CLIENT : \"uses\"\nCLIENT --> HELPERS : \"uses\"\n\nnote right of KG\n  **Primary Features:**\n  - Interactive graph visualization\n  - Entity selection and details\n  - Real-time filtering\n  - Multi-team support\nend note\n\nnote right of GRAPH\n  **D3.js Features:**\n  - Force-directed layout\n  - Drag to reposition\n  - Zoom/pan controls\n  - Dynamic updates\nend note\n\nnote right of CLIENT\n  **Data Sources:**\n  - GraphDB (LevelDB)\n  - memory.json files\n  - Clipboard paste\n  - Drag & drop\nend note\n\nlegend bottom\n  |= Module Type |= Purpose |\n  | <back:#E6F3FF>   </back> | Core Visualization |\n  | <back:#FFE6E6>   </back> | Filtering & Search |\n  | <back:#E6FFE6>   </back> | Content Rendering |\n  | <back:#FFF4E6>   </back> | State Management |\n  | <back:#F0E6FF>   </back> | Data Access |\n  | <back:#E6E6FF>   </back> | Utilities |\n  | <back:#FFE6CC>   </back> | Root Component |\nendlegend\n\n@enduml\n"
}
```

### User

**Result:** ✅ Success

Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable

### User

**Result:** ✅ Success

File created successfully at: /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/architecture.puml

### User

**Result:** ✅ Success

File created successfully at: /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/data-flow.puml

### User

**Result:** ✅ Success

File created successfully at: /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml

### Assistant

Now let me generate the PNG images from the PlantUML files:

### Assistant

**Tool:** TodoWrite
**Input:** ```json
{
  "todos": [
    {
      "content": "Create PlantUML architecture diagrams",
      "status": "completed",
      "activeForm": "Creating PlantUML diagrams"
    },
    {
      "content": "Generate PNG images from PlantUML files",
      "status": "in_progress",
      "activeForm": "Generating PNG diagrams"
    },
    {
      "content": "Create comprehensive documentation files",
      "status": "pending",
      "activeForm": "Creating documentation files"
    },
    {
      "content": "Rewrite top-level README.md",
      "status": "pending",
      "activeForm": "Rewriting README.md"
    }
  ]
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "cd /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml && plantuml -tpng architecture.puml && mv architecture.png ../images/",
  "description": "Generate architecture PNG diagram"
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "cd /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml && plantuml -tpng data-flow.puml && mv data-flow.png ../images/",
  "description": "Generate data-flow PNG diagram"
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "cd /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml && plantuml -tpng component-structure.puml && mv component-structure.png ../images/",
  "description": "Generate component-structure PNG diagram"
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "ls -la /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/images/",
  "description": "Verify PNG files generated"
}
```

### User

**Result:** ✅ Success

Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable

### User

**Result:** ❌ Error

Error line 2 in file: architecture.puml
Some diagram description contains errors

### User

**Result:** ❌ Error

Error line 2 in file: data-flow.puml
Some diagram description contains errors

### User

**Result:** ❌ Error

Error line 2 in file: component-structure.puml
Some diagram description contains errors

### User

**Result:** ✅ Success

total 3792
drwxr-xr-x@ 4 q284340  staff      128 Oct 26 12:12 .
drwxr-xr-x@ 5 q284340  staff      160 Oct 26 12:11 ..
-rw-r--r--@ 1 q284340  staff   889919 Oct 26 12:10 insights.png
-rw-r--r--@ 1 q284340  staff  1045376 Oct 26 12:12 viewer.png

### Assistant

The include path is wrong. Let me check the correct path and fix the PlantUML files:

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "ls /Users/q284340/Agentic/coding/docs/puml/_standard-style.puml 2>/dev/null && echo \"Found at docs/puml/\" || echo \"Not found\"",
  "description": "Check standard style location"
}
```

### Assistant

**Tool:** Edit
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/architecture.puml",
  "old_string": "@startuml architecture\n!include ../../../docs/puml/_standard-style.puml\n\ntitle Memory Visualizer - System Architecture",
  "new_string": "@startuml architecture\n!include ../../../../docs/puml/_standard-style.puml\n\ntitle Memory Visualizer - System Architecture"
}
```

### Assistant

**Tool:** Edit
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/data-flow.puml",
  "old_string": "@startuml data-flow\n!include ../../../docs/puml/_standard-style.puml\n\ntitle Memory Visualizer - Data Flow Sequence",
  "new_string": "@startuml data-flow\n!include ../../../../docs/puml/_standard-style.puml\n\ntitle Memory Visualizer - Data Flow Sequence"
}
```

### Assistant

**Tool:** Edit
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml",
  "old_string": "@startuml component-structure\n!include ../../../docs/puml/_standard-style.puml\n\ntitle Memory Visualizer - Component Structure",
  "new_string": "@startuml component-structure\n!include ../../../../docs/puml/_standard-style.puml\n\ntitle Memory Visualizer - Component Structure"
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "cd /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml && plantuml -tpng architecture.puml data-flow.puml component-structure.puml && mv *.png ../images/",
  "description": "Generate all PNG diagrams"
}
```

### User

**Result:** ✅ Success

/Users/q284340/Agentic/coding/docs/puml/_standard-style.puml
Found at docs/puml/

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/architecture.puml has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
     1→@startuml architecture
     2→!include ../../../../docs/puml/_standard-style.puml
     3→
     4→title Memory Visualizer - System Architecture
     5→
     6→package "Frontend (React + TypeScript)" {
     7→  component [App.tsx] as APP <<react>>
     8→

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/data-flow.puml has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
     1→@startuml data-flow
     2→!include ../../../../docs/puml/_standard-style.puml
     3→
     4→title Memory Visualizer - Data Flow Sequence
     5→
     6→actor User
     7→participant "Browser\n(React App)" as APP
     8→participant "Redux Store" as STORE

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
     1→@startuml component-structure
     2→!include ../../../../docs/puml/_standard-style.puml
     3→
     4→title Memory Visualizer - Component Structure
     5→
     6→package "Memory Visualizer Application" {
     7→
     8→  component [App.tsx] as APP <<root>> #FFE6CC {

### User

**Result:** ❌ Error

Error line 9 in file: component-structure.puml
Some diagram description contains errors

### Assistant

Let me fix the PlantUML syntax errors:

### Assistant

**Tool:** Edit
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml",
  "old_string": "  component [App.tsx] as APP <<root>> #FFE6CC {\n    Main application component\n    Routing and layout\n    State provider\n  }",
  "new_string": "  component [App.tsx] as APP <<root>> #FFE6CC"
}
```

### Assistant

**Tool:** Edit
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml",
  "old_string": "    component [KnowledgeGraph/index.tsx] as KG {\n      Main graph container\n      Orchestrates visualization\n      Manages selection state\n    }\n\n    component [GraphVisualization.tsx] as GRAPH {\n      D3.js force-directed graph\n      Interactive node dragging\n      Zoom and pan controls\n      Link rendering\n    }\n\n    component [NodeDetails.tsx] as DETAILS {\n      Entity information panel\n      Observations display\n      Relations listing\n      Markdown rendering\n    }",
  "new_string": "    component [KnowledgeGraph/index.tsx] as KG\n    component [GraphVisualization.tsx] as GRAPH\n    component [NodeDetails.tsx] as DETAILS"
}
```

### Assistant

**Tool:** Edit
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml",
  "old_string": "    component [TypeFilters.tsx] as TYPE_FILTER {\n      Entity type dropdown\n      Relation type dropdown\n      Multi-select support\n    }\n\n    component [SearchFilter.tsx] as SEARCH {\n      Text search input\n      Real-time filtering\n      Entity/relation search\n    }\n\n    component [TeamFilter.tsx] as TEAM_FILTER {\n      Team selection dropdown\n      Multi-team support\n      Domain isolation\n    }\n\n    component [SourceFilter.tsx] as SOURCE_FILTER {\n      Data source selection\n      JSON upload\n      GraphDB connection\n    }",
  "new_string": "    component [TypeFilters.tsx] as TYPE_FILTER\n    component [SearchFilter.tsx] as SEARCH\n    component [TeamFilter.tsx] as TEAM_FILTER\n    component [SourceFilter.tsx] as SOURCE_FILTER"
}
```

### Assistant

**Tool:** Edit
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml",
  "old_string": "    component [MarkdownViewer.tsx] as MARKDOWN {\n      Markdown rendering\n      Syntax highlighting\n      GFM support\n    }\n\n    component [MermaidDiagram.tsx] as MERMAID {\n      Mermaid diagram support\n      Auto-detection\n      SVG rendering\n    }",
  "new_string": "    component [MarkdownViewer.tsx] as MARKDOWN\n    component [MermaidDiagram.tsx] as MERMAID"
}
```

### Assistant

**Tool:** Edit
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml",
  "old_string": "    component [store/index.ts] as STORE {\n      Redux store configuration\n      Middleware setup\n    }\n\n    component [store/graphSlice.ts] as SLICE {\n      Graph state\n      Filter state\n      Selection state\n      Actions & reducers\n    }",
  "new_string": "    component [store/index.ts] as STORE\n    component [store/graphSlice.ts] as SLICE"
}
```

### Assistant

**Tool:** Edit
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml",
  "old_string": "    component [api/databaseClient.ts] as CLIENT {\n      GraphDB queries\n      JSON parsing\n      Data validation\n      Team filtering\n    }",
  "new_string": "    component [api/databaseClient.ts] as CLIENT"
}
```

### Assistant

**Tool:** Edit
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml",
  "old_string": "    component [utils/graphHelpers.ts] as HELPERS {\n      Graph algorithms\n      Layout calculations\n      Filter functions\n      Data transformations\n    }",
  "new_string": "    component [utils/graphHelpers.ts] as HELPERS"
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "cd /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml && plantuml -tpng architecture.puml data-flow.puml component-structure.puml && mv *.png ../images/ && ls -la ../images/*.png | grep -E \"(architecture|data-flow|component)\"",
  "description": "Generate all PNG diagrams and verify"
}
```

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
     4→title Memory Visualizer - Component Structure
     5→
     6→package "Memory Visualizer Application" {
     7→
     8→  component [App.tsx] as APP <<root>> #FFE6CC
     9→
    10→  package "Knowledge Graph Module" #E6F3FF {
    11→    component [KnowledgeGraph/index.tsx] as KG {
    12→      Main graph container

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
     7→
     8→  component [App.tsx] as APP <<root>> #FFE6CC
     9→
    10→  package "Knowledge Graph Module" #E6F3FF {
    11→    component [KnowledgeGraph/index.tsx] as KG
    12→    component [GraphVisualization.tsx] as GRAPH
    13→    component [NodeDetails.tsx] as DETAILS
    14→  }
    15→
    16→  package "Filtering Module" #FFE6E6 {
    17→    component [TypeFilters.tsx] as TYPE_FILTER {

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
    13→    component [NodeDetails.tsx] as DETAILS
    14→  }
    15→
    16→  package "Filtering Module" #FFE6E6 {
    17→    component [TypeFilters.tsx] as TYPE_FILTER
    18→    component [SearchFilter.tsx] as SEARCH
    19→    component [TeamFilter.tsx] as TEAM_FILTER
    20→    component [SourceFilter.tsx] as SOURCE_FILTER
    21→  }
    22→
    23→  package "Rendering Components" #E6FFE6 {
    24→    component [MarkdownViewer.tsx] as MARKDOWN {

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
    20→    component [SourceFilter.tsx] as SOURCE_FILTER
    21→  }
    22→
    23→  package "Rendering Components" #E6FFE6 {
    24→    component [MarkdownViewer.tsx] as MARKDOWN
    25→    component [MermaidDiagram.tsx] as MERMAID
    26→  }
    27→
    28→  package "State Management" #FFF4E6 {
    29→    component [store/index.ts] as STORE {

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
    25→    component [MermaidDiagram.tsx] as MERMAID
    26→  }
    27→
    28→  package "State Management" #FFF4E6 {
    29→    component [store/index.ts] as STORE
    30→    component [store/graphSlice.ts] as SLICE
    31→  }
    32→
    33→  package "API Layer" #F0E6FF {
    34→    component [api/databaseClient.ts] as CLIENT {

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
    30→    component [store/graphSlice.ts] as SLICE
    31→  }
    32→
    33→  package "API Layer" #F0E6FF {
    34→    component [api/databaseClient.ts] as CLIENT
    35→  }
    36→
    37→  package "Utilities" #E6E6FF {
    38→    component [utils/graphHelpers.ts] as HELPERS {

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/component-structure.puml has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
    34→    component [api/databaseClient.ts] as CLIENT
    35→  }
    36→
    37→  package "Utilities" #E6E6FF {
    38→    component [utils/graphHelpers.ts] as HELPERS
    39→  }
    40→}
    41→
    42→' Relationships

### User

**Result:** ✅ Success

-rw-r--r--@ 1 q284340  staff   121515 Oct 26 12:18 ../images/architecture.png
-rw-r--r--@ 1 q284340  staff   134814 Oct 26 12:18 ../images/component-structure.png
-rw-r--r--@ 1 q284340  staff   146002 Oct 26 12:18 ../images/data-flow.png

### Assistant

Excellent! Now let me create the comprehensive documentation files:

### Assistant

**Tool:** TodoWrite
**Input:** ```json
{
  "todos": [
    {
      "content": "Create PlantUML architecture diagrams",
      "status": "completed",
      "activeForm": "Creating PlantUML diagrams"
    },
    {
      "content": "Generate PNG images from PlantUML files",
      "status": "completed",
      "activeForm": "Generating PNG diagrams"
    },
    {
      "content": "Create comprehensive documentation files",
      "status": "in_progress",
      "activeForm": "Creating documentation files"
    },
    {
      "content": "Rewrite top-level README.md",
      "status": "pending",
      "activeForm": "Rewriting README.md"
    }
  ]
}
```

### Assistant

**Tool:** Write
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/architecture.md",
  "content": "# Memory Visualizer - Architecture Documentation\n\n## Overview\n\nThe Memory Visualizer is a React-based web application that provides interactive visualization and exploration of knowledge graphs stored in Anthropic's Memory MCP format. It supports both static JSON file uploads and real-time GraphDB (LevelDB) queries with multi-team isolation.\n\n![System Architecture](images/architecture.png)\n\n*High-level system architecture showing the Frontend, Visualization Layer, and Data Sources*\n\n---\n\n## System Components\n\n### Frontend Layer (React + TypeScript)\n\nThe frontend is built with modern React using TypeScript for type safety and maintainability.\n\n#### Core Application\n\n- **App.tsx**: Root component that provides Redux context and application layout\n- **React 18**: Latest React features including concurrent rendering\n- **TypeScript 5.3+**: Strong typing for better developer experience\n\n#### Component Modules\n\n**Knowledge Graph Module**:\n- `KnowledgeGraph/index.tsx` - Main container orchestrating visualization\n- `GraphVisualization.tsx` - D3.js-powered force-directed graph\n- `NodeDetails.tsx` - Entity information sidebar with observations\n\n**Filtering Module**:\n- `TypeFilters.tsx` - Entity and relation type dropdowns\n- `SearchFilter.tsx` - Real-time text search across entities/relations\n- `TeamFilter.tsx` - Multi-team selection and domain isolation\n- `SourceFilter.tsx` - Data source selection (JSON upload vs GraphDB)\n\n**Rendering Components**:\n- `MarkdownViewer.tsx` - GitHub-flavored markdown with syntax highlighting\n- `MermaidDiagram.tsx` - Automatic Mermaid diagram rendering\n\n### State Management (Redux Toolkit)\n\nCentralized state management using Redux Toolkit for predictable state updates:\n\n- **Redux Store**: Global application state container\n- **Graph Slice**: Manages graph data, filters, and selection state\n- **Actions & Reducers**: Type-safe state mutations\n- **Middleware**: Async data loading and side effects\n\n### API Layer\n\n**Database Client** (`api/databaseClient.ts`):\n- GraphDB (LevelDB) query interface\n- JSON file parsing and validation\n- Team-based data filtering\n- Memory.json format support\n\n### Utilities\n\n**Graph Helpers** (`utils/graphHelpers.ts`):\n- Force-directed layout algorithms\n- Graph traversal and filtering\n- Data transformation utilities\n- Type-safe graph operations\n\n---\n\n## Visualization Layer\n\n### D3.js Integration\n\nThe graph visualization uses D3.js for interactive force-directed layouts:\n\n**Features**:\n- **Force Simulation**: Physics-based node positioning\n- **Interactive Dragging**: Reposition nodes with mouse/touch\n- **Zoom & Pan**: Navigate large graphs smoothly\n- **Dynamic Updates**: Real-time graph modifications\n- **Link Rendering**: Curved links with directional arrows\n\n**Layout Algorithm**:\n- Force-directed graph with customizable forces\n- Link distance based on relationship type\n- Collision detection for node spacing\n- Center gravity to prevent drift\n\n### Mermaid Support\n\nAutomatic detection and rendering of Mermaid diagrams in markdown content:\n- Class diagrams\n- Sequence diagrams\n- Flowcharts\n- Entity-relationship diagrams\n\n---\n\n## Data Sources\n\n### 1. Memory.json Files (Static)\n\nAnthropic's Memory MCP format containing:\n\n```json\n{\n  \"entities\": [\n    {\n      \"name\": \"Entity Name\",\n      \"entityType\": \"Type\",\n      \"observations\": [\"Fact 1\", \"Fact 2\"]\n    }\n  ],\n  \"relations\": [\n    {\n      \"from\": \"Entity A\",\n      \"to\": \"Entity B\",\n      \"relationType\": \"relationship_type\"\n    }\n  ]\n}\n```\n\n**Loading Methods**:\n- File upload via drag & drop\n- Browse and select file\n- Paste JSON from clipboard\n\n### 2. GraphDB (LevelDB) - Live Queries\n\nReal-time database queries for dynamic knowledge graphs:\n\n**Storage Location**: `.data/knowledge-graph/`\n\n**Features**:\n- Multi-team support with isolation\n- Domain-specific knowledge bases\n- Persistent storage across sessions\n- Bidirectional sync with JSON exports\n\n**Team Structure**:\n```\nGraphDB\n├── Team: coding\n│   ├── Entities\n│   ├── Relations\n│   └── Observations\n├── Team: project-a\n│   └── ...\n└── Team: project-b\n    └── ...\n```\n\n---\n\n## Data Flow\n\n![Data Flow Sequence](images/data-flow.png)\n\n*Complete data flow from initialization through user interactions*\n\n### Initialization Flow\n\n1. **Application Start**: User opens visualizer\n2. **Store Initialization**: Redux store created\n3. **Data Source Check**: Query GraphDB or await file upload\n4. **Data Loading**: Parse and validate graph structure\n5. **Visualization Setup**: D3 force simulation initialization\n6. **Initial Render**: Display interactive graph\n\n### User Interaction Flow\n\n**Entity Selection**:\n1. User clicks entity node\n2. Store retrieves entity details\n3. Database client fetches observations\n4. NodeDetails panel updates\n5. Related entities highlighted\n\n**Filtering**:\n1. User applies filter (type, search, team)\n2. Redux action dispatched\n3. Graph helpers filter data\n4. D3 visualization updates\n5. Filtered graph rendered\n\n**Team Navigation**:\n1. User selects team from dropdown\n2. Store updates active team\n3. Client queries team-specific data\n4. Graph recalculated and re-rendered\n5. Team knowledge displayed\n\n---\n\n## Component Structure\n\n![Component Structure](images/component-structure.png)\n\n*Detailed component hierarchy and module relationships*\n\n### Module Organization\n\n**Knowledge Graph Module** (Blue):\n- Core visualization components\n- Primary user interaction layer\n- Graph rendering and node details\n\n**Filtering Module** (Pink):\n- Search and filter components\n- Data source selection\n- Team navigation\n\n**Rendering Components** (Green):\n- Content display utilities\n- Markdown and diagram support\n- Syntax highlighting\n\n**State Management** (Beige):\n- Redux store and slices\n- Centralized state\n- Action dispatchers\n\n**API Layer** (Purple):\n- Database client\n- Data validation\n- Query interface\n\n**Utilities** (Light Blue):\n- Helper functions\n- Graph algorithms\n- Data transformations\n\n---\n\n## Technology Stack\n\n### Core Technologies\n\n- **React 18.2**: UI framework with concurrent features\n- **TypeScript 5.3**: Type-safe development\n- **Redux Toolkit 2.9**: State management\n- **D3.js 7.8**: Data visualization\n- **Vite 6.0**: Build tool and dev server\n- **TailwindCSS 3.4**: Utility-first styling\n\n### Rendering & Display\n\n- **react-markdown**: Markdown rendering with GFM support\n- **rehype-highlight**: Syntax highlighting via highlight.js\n- **Mermaid 11.6**: Diagram rendering\n- **highlight.js 11.11**: Code syntax highlighting\n\n### Development Tools\n\n- **Vite**: Lightning-fast HMR and builds\n- **PostCSS**: CSS processing\n- **Autoprefixer**: Browser compatibility\n- **ESLint & Prettier**: Code quality and formatting\n\n---\n\n## Performance Characteristics\n\n### Optimization Strategies\n\n**Graph Rendering**:\n- Throttled force simulation updates\n- Canvas-based rendering for large graphs (>1000 nodes)\n- SVG for smaller graphs (<1000 nodes)\n- Viewport culling for off-screen nodes\n\n**State Management**:\n- Memoized selectors to prevent re-renders\n- Normalized state shape for O(1) lookups\n- Shallow equality checks in Redux\n\n**Data Loading**:\n- Lazy loading for large JSON files\n- Incremental parsing for streaming\n- Worker threads for heavy computations\n\n### Scalability\n\n**Small Graphs** (<100 nodes):\n- Instant rendering (<100ms)\n- Smooth animations\n- All features enabled\n\n**Medium Graphs** (100-1000 nodes):\n- Fast rendering (<500ms)\n- Optimized force simulation\n- Selective label rendering\n\n**Large Graphs** (1000+ nodes):\n- Canvas fallback rendering\n- Clustering for overview\n- On-demand detail loading\n\n---\n\n## Security Considerations\n\n### Data Privacy\n\n- **Local-First**: All processing happens in browser\n- **No Server Upload**: JSON files never leave client\n- **Memory Isolation**: Team data segregated in GraphDB\n\n### Input Validation\n\n- **JSON Schema Validation**: Strict format checking\n- **XSS Protection**: Sanitized markdown rendering\n- **Type Safety**: TypeScript guards against invalid data\n\n---\n\n## Deployment Architecture\n\n### Production Build\n\n```bash\nnpm run build\n```\n\n**Output**:\n- Optimized bundle with tree-shaking\n- Code splitting for lazy loading\n- Minified CSS and JS\n- Source maps for debugging\n\n### Hosting Options\n\n**Static Hosting**:\n- Vercel, Netlify, GitHub Pages\n- CDN for global distribution\n- HTTPS required for clipboard API\n\n**Self-Hosted**:\n- Nginx or Apache static server\n- Docker container deployment\n- Kubernetes for scaling\n\n---\n\n## Extension Points\n\n### Adding New Visualizations\n\n1. Create new component in `components/`\n2. Connect to Redux store via `useSelector`\n3. Subscribe to graph data changes\n4. Implement custom rendering logic\n\n### Custom Data Sources\n\n1. Implement `DataSource` interface in `api/`\n2. Add source selection in `SourceFilter.tsx`\n3. Register source in `databaseClient.ts`\n4. Handle data format transformations\n\n### New Filter Types\n\n1. Create filter component in `components/Filters/`\n2. Add filter state to `graphSlice.ts`\n3. Implement filter logic in `graphHelpers.ts`\n4. Connect via Redux actions\n\n---\n\n## Related Documentation\n\n- **[User Guide](user-guide.md)** - End-user documentation\n- **[API Reference](api-reference.md)** - Component and function APIs\n- **[Development Guide](development.md)** - Setup and contribution guide\n\n---\n\n*Architecture documentation for Memory Visualizer v1.0.0*\n"
}
```

### User

**Result:** ✅ Success

Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable

### User

**Result:** ✅ Success

File created successfully at: /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/architecture.md

### Assistant

Now let me create the user guide and API reference documentation, then rewrite the README:

### Assistant

**Tool:** Write
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/user-guide.md",
  "content": "# Memory Visualizer - User Guide\n\n## Quick Start\n\nThe Memory Visualizer helps you explore and debug knowledge graphs created by Claude Desktop's Memory MCP server or the coding project's GraphDB system.\n\n### Access\n\n**Online Version**: [https://memviz.herich.tech](https://memviz.herich.tech)\n\n**Local Installation**:\n```bash\ncd integrations/memory-visualizer\nnpm install\nnpm run dev\n```\n\n---\n\n## Main Interface\n\n![Memory Visualizer Overview](images/viewer.png)\n\n*Main visualization interface showing the interactive knowledge graph*\n\n### Interface Components\n\n1. **Graph Canvas** (Center): Interactive force-directed graph visualization\n2. **Control Panel** (Top): Filters, search, and data source selection\n3. **Details Panel** (Right): Entity information and observations\n4. **Statistics** (Top Left): Entity count, relation count, type counts\n\n---\n\n## Loading Data\n\n### Method 1: Upload JSON File\n\n1. Click **\"Upload New File\"** button (top right)\n2. Select `memory.json` file from your system\n3. **Alternative**: Drag and drop file onto the canvas\n4. **Alternative**: Copy JSON to clipboard and paste (Ctrl/Cmd+V)\n\n**Supported Format**:\n```json\n{\n  \"entities\": [...],\n  \"relations\": [...]\n}\n```\n\n### Method 2: GraphDB Connection (Local Development)\n\nFor real-time data from the coding project's GraphDB:\n\n1. Start the visualizer locally: `npm run dev`\n2. GraphDB automatically connects to `.data/knowledge-graph/`\n3. Select team from **Team Filter** dropdown\n4. Graph loads automatically\n\n---\n\n## Navigating the Graph\n\n![Entity Details View](images/insights.png)\n\n*Detailed entity information panel showing observations and relationships*\n\n### Basic Navigation\n\n**Zoom**:\n- Mouse wheel: Zoom in/out\n- Trackpad: Pinch to zoom\n- Touch: Pinch gesture\n\n**Pan**:\n- Click and drag empty space\n- Touch: Drag with one finger\n\n**Select Entity**:\n- Click any node to view details\n- Right panel shows observations and relations\n- Connected nodes highlight\n\n**Reposition Nodes**:\n- Click and drag nodes to new positions\n- Force simulation adjusts layout dynamically\n- Positions reset on data reload\n\n### Graph Controls\n\n**Fit to View**: Double-click empty space to center graph\n\n**Reset Layout**: Refresh page to recalculate positions\n\n---\n\n## Filtering and Search\n\n### Entity Type Filter\n\nFilter nodes by entity type:\n\n1. Click **\"Filter by Entity Type\"** dropdown\n2. Select one or more types\n3. Graph shows only matching entities\n4. Related relations also filtered\n\n**Common Types**:\n- Pattern, Solution, Architecture\n- Tool, Workflow, Problem\n- Custom types from your knowledge base\n\n### Relation Type Filter\n\nFilter edges by relationship type:\n\n1. Click **\"Filter by Relation Type\"** dropdown\n2. Select relationship types\n3. Graph shows only selected relationships\n\n**Common Relations**:\n- implements, solves, uses\n- depends_on, related_to, improves\n\n### Search\n\nReal-time text search across entities:\n\n1. Type in **Search** box (top left)\n2. Searches entity names and content\n3. Matching entities highlighted\n4. Non-matching nodes dimmed\n\n**Search Tips**:\n- Case-insensitive\n- Partial matches supported\n- Use quotes for exact phrases\n\n### Team Filter (GraphDB Only)\n\nWhen connected to GraphDB:\n\n1. Select team from **Team Filter** dropdown\n2. View team-specific knowledge base\n3. Each team's data isolated\n4. Switch teams instantly\n\n---\n\n## Understanding the Visualization\n\n### Node Colors\n\nNodes are color-coded by entity type:\n\n- **Purple**: Memory/Core entities\n- **Orange**: Important/Featured entities\n- **Blue**: Standard entities\n- **Green**: Tools/Technologies\n- **Teal**: Workflows/Processes\n- **Gray**: Generic/Untyped entities\n\n### Node Sizes\n\n- Larger nodes: More observations attached\n- Smaller nodes: Fewer observations\n- Size indicates information richness\n\n### Link Styles\n\n- **Solid arrows**: Direct relationships\n- **Arrow direction**: Relationship direction (A → B)\n- **Curved lines**: Multiple relations between nodes\n- **Link labels**: Relationship type names\n\n---\n\n## Entity Details Panel\n\n### Viewing Details\n\nClick any node to view:\n\n1. **Entity Name**: Displayed at top\n2. **Entity Type**: Category classification\n3. **Observations**: List of facts/notes\n4. **Relations**: Connected entities\n\n### Observations\n\nEach observation represents an atomic fact:\n\n- Displayed as bullet points\n- Can contain markdown formatting\n- May include code blocks\n- Automatically detects Mermaid diagrams\n\n### Relations\n\nShows all connections:\n\n**Outbound** (this entity → other):\n- Listed with arrow →\n- Shows relationship type\n- Click to navigate\n\n**Inbound** (other → this entity):\n- Listed with arrow ←\n- Shows source entity\n- Click to view source\n\n---\n\n## Advanced Features\n\n### Markdown Support\n\nObservations support GitHub-Flavored Markdown:\n\n- **Headings**: `# H1`, `## H2`, etc.\n- **Bold**: `**text**` or `__text__`\n- **Italic**: `*text*` or `_text_`\n- **Code**: `` `inline` `` or ` ```block``` `\n- **Lists**: `-` or `*` for bullets, `1.` for numbered\n- **Links**: `[text](url)`\n- **Tables**: Pipe-separated with headers\n\n### Syntax Highlighting\n\nCode blocks automatically highlighted:\n\n````markdown\n```typescript\ninterface Entity {\n  name: string;\n  entityType: string;\n  observations: string[];\n}\n```\n````\n\nSupports 180+ languages via highlight.js.\n\n### Mermaid Diagrams\n\nMermaid diagrams render automatically:\n\n````markdown\n```mermaid\ngraph TD\n    A[Start] --> B[Process]\n    B --> C[End]\n```\n````\n\n**Supported Diagram Types**:\n- Flowcharts\n- Sequence diagrams\n- Class diagrams\n- ER diagrams\n- Gantt charts\n\n---\n\n## Data Sources\n\n### Memory.json Format\n\nStandard Anthropic Memory MCP format:\n\n```json\n{\n  \"entities\": [\n    {\n      \"name\": \"React Hooks\",\n      \"entityType\": \"Pattern\",\n      \"observations\": [\n        \"useState for local state\",\n        \"useEffect for side effects\",\n        \"Custom hooks for reusable logic\"\n      ]\n    }\n  ],\n  \"relations\": [\n    {\n      \"from\": \"React Hooks\",\n      \"to\": \"React\",\n      \"relationType\": \"part_of\"\n    }\n  ]\n}\n```\n\n### GraphDB (LevelDB)\n\nLive database at `.data/knowledge-graph/`:\n\n**Features**:\n- Real-time updates\n- Multi-team isolation\n- Persistent storage\n- Automatic sync\n\n**Team Structure**:\n- Each team has isolated graph\n- Cross-team references supported\n- Domain-specific knowledge bases\n\n---\n\n## Keyboard Shortcuts\n\n| Shortcut | Action |\n|----------|--------|\n| `Ctrl/Cmd + V` | Paste JSON from clipboard |\n| `Escape` | Clear selection |\n| `F` | Fit graph to view |\n| `R` | Reset zoom |\n| `/` | Focus search box |\n\n---\n\n## Tips & Best Practices\n\n### For Better Visualization\n\n1. **Use Descriptive Names**: Clear entity names improve readability\n2. **Limit Observations**: Keep facts atomic and focused\n3. **Type Consistency**: Use consistent entity/relation types\n4. **Directed Relations**: Use active voice (e.g., \"implements\" not \"implemented_by\")\n\n### For Large Graphs\n\n1. **Use Filters**: Focus on specific entity types\n2. **Team Isolation**: Split large graphs into team domains\n3. **Search First**: Find entities before exploring visually\n4. **Export Subgraphs**: Save filtered views for later\n\n### For Analysis\n\n1. **Follow Relations**: Click through connected entities\n2. **Check Observations**: Read facts in detail panel\n3. **Identify Clusters**: Look for tightly connected groups\n4. **Find Hubs**: Large nodes indicate important concepts\n\n---\n\n## Troubleshooting\n\n### Graph Not Loading\n\n**Issue**: Uploaded file doesn't display\n\n**Solutions**:\n- Check JSON format validity\n- Ensure `entities` and `relations` arrays present\n- Verify no circular dependencies\n- Check browser console for errors\n\n### Performance Issues\n\n**Issue**: Slow rendering with large graphs\n\n**Solutions**:\n- Use filters to reduce visible nodes\n- Close browser tabs to free memory\n- Try Chrome/Edge for better performance\n- Consider splitting into multiple teams\n\n### Missing Relations\n\n**Issue**: Expected connections not showing\n\n**Solutions**:\n- Check relation type filter settings\n- Verify entity names match exactly (case-sensitive)\n- Ensure relations array properly formatted\n- Check for typos in entity references\n\n### GraphDB Not Connecting\n\n**Issue**: Local GraphDB data not loading\n\n**Solutions**:\n- Verify `.data/knowledge-graph/` exists\n- Check GraphDB server is running\n- Ensure proper file permissions\n- Review browser console for errors\n\n---\n\n## Export and Sharing\n\n### Exporting Filtered Views\n\nCurrently, exports include:\n\n1. **Screenshot**: Use browser's screenshot tool\n2. **Copy JSON**: Select and copy from network tab\n3. **Export TODO**: Feature planned for future release\n\n### Sharing Knowledge Graphs\n\n**Options**:\n1. Share `memory.json` file directly\n2. Use cloud storage (Google Drive, Dropbox)\n3. Commit to git repository\n4. Host on team wiki\n\n**Security Note**: Ensure sensitive data is removed before sharing.\n\n---\n\n## Related Documentation\n\n- **[Architecture](architecture.md)** - Technical architecture details\n- **[API Reference](api-reference.md)** - Component and API documentation\n- **[Development Guide](development.md)** - Contributing and development setup\n\n---\n\n*User Guide for Memory Visualizer v1.0.0*\n"
}
```

### User

**Result:** ✅ Success

File created successfully at: /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/user-guide.md

### Assistant

Now let me create the development guide and then rewrite the main README:

### Assistant

**Tool:** Write
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/development.md",
  "content": "# Memory Visualizer - Development Guide\n\n## Getting Started\n\n### Prerequisites\n\n- **Node.js 18+**: JavaScript runtime\n- **npm 9+**: Package manager\n- **Git**: Version control\n- **Code Editor**: VS Code recommended\n\n### Installation\n\n```bash\n# Clone the repository\ncd integrations/memory-visualizer\n\n# Install dependencies\nnpm install\n\n# Start development server\nnpm run dev\n\n# Open browser\n# Visit http://localhost:5173\n```\n\n---\n\n## Development Workflow\n\n### Available Scripts\n\n```bash\n# Development server with HMR\nnpm run dev\n\n# Production build\nnpm run build\n\n# Preview production build\nnpm run preview\n\n# Type checking\nnpx tsc --noEmit\n\n# Linting (if configured)\nnpm run lint\n\n# Format code (if configured)\nnpm run format\n```\n\n### Development Server\n\nVite dev server features:\n- **Hot Module Replacement (HMR)**: Instant updates\n- **Fast Refresh**: Preserves component state\n- **TypeScript checking**: Real-time type errors\n- **Port**: 5173 (configurable in `vite.config.ts`)\n\n---\n\n## Project Structure\n\n```\nmemory-visualizer/\n├── src/\n│   ├── api/\n│   │   └── databaseClient.ts      # Data source abstraction\n│   ├── components/\n│   │   ├── Filters/               # Filter components\n│   │   │   ├── SearchFilter.tsx\n│   │   │   ├── TeamFilter.tsx\n│   │   │   ├── TypeFilters.tsx\n│   │   │   └── SourceFilter.tsx\n│   │   ├── KnowledgeGraph/        # Core visualization\n│   │   │   ├── index.tsx\n│   │   │   ├── GraphVisualization.tsx\n│   │   │   └── NodeDetails.tsx\n│   │   ├── MarkdownViewer.tsx     # Markdown rendering\n│   │   └── MermaidDiagram.tsx     # Diagram support\n│   ├── store/\n│   │   ├── index.ts               # Redux store\n│   │   └── graphSlice.ts          # Graph state slice\n│   ├── utils/\n│   │   └── graphHelpers.ts        # Graph utilities\n│   ├── App.tsx                    # Root component\n│   ├── main.tsx                   # Entry point\n│   └── index.css                  # Global styles\n├── public/                        # Static assets\n├── docs/                          # Documentation\n│   ├── puml/                      # PlantUML sources\n│   └── images/                    # Generated diagrams\n├── package.json\n├── tsconfig.json\n├── vite.config.ts\n└── tailwind.config.js\n```\n\n---\n\n## Key Technologies\n\n### React + TypeScript\n\n**Component Patterns**:\n```typescript\n// Functional component with props\ninterface Props {\n  data: GraphData;\n  onSelect: (id: string) => void;\n}\n\nexport const MyComponent: React.FC<Props> = ({ data, onSelect }) => {\n  // Component logic\n  return <div>...</div>;\n};\n```\n\n**Hooks Used**:\n- `useState`: Local component state\n- `useEffect`: Side effects and lifecycle\n- `useSelector`: Redux state access\n- `useDispatch`: Redux action dispatch\n- `useCallback`: Memoized callbacks\n- `useMemo`: Memoized values\n\n### Redux Toolkit\n\n**State Shape**:\n```typescript\ninterface GraphState {\n  entities: Entity[];\n  relations: Relation[];\n  selectedEntityId: string | null;\n  filters: {\n    entityTypes: string[];\n    relationTypes: string[];\n    searchQuery: string;\n    activeTeam: string;\n  };\n  loading: boolean;\n  error: string | null;\n}\n```\n\n**Creating Actions**:\n```typescript\n// In graphSlice.ts\nexport const graphSlice = createSlice({\n  name: 'graph',\n  initialState,\n  reducers: {\n    setEntities: (state, action: PayloadAction<Entity[]>) => {\n      state.entities = action.payload;\n    },\n    selectEntity: (state, action: PayloadAction<string>) => {\n      state.selectedEntityId = action.payload;\n    },\n    // ... more reducers\n  },\n});\n\nexport const { setEntities, selectEntity } = graphSlice.actions;\n```\n\n### D3.js Visualization\n\n**Force Simulation Setup**:\n```typescript\nconst simulation = d3.forceSimulation(nodes)\n  .force('link', d3.forceLink(links)\n    .id((d: any) => d.id)\n    .distance(100)\n  )\n  .force('charge', d3.forceManyBody().strength(-300))\n  .force('center', d3.forceCenter(width / 2, height / 2))\n  .force('collision', d3.forceCollide().radius(30));\n```\n\n**SVG Rendering**:\n```typescript\n// Create SVG container\nconst svg = d3.select(containerRef.current)\n  .append('svg')\n  .attr('width', width)\n  .attr('height', height);\n\n// Add zoom behavior\nconst zoom = d3.zoom()\n  .on('zoom', (event) => {\n    g.attr('transform', event.transform);\n  });\n\nsvg.call(zoom);\n```\n\n### TailwindCSS\n\n**Utility Classes**:\n```tsx\n<div className=\"flex flex-col gap-4 p-6 bg-white rounded-lg shadow-md\">\n  <h2 className=\"text-2xl font-bold text-gray-900\">Title</h2>\n  <p className=\"text-gray-600\">Content</p>\n</div>\n```\n\n**Custom Configuration** (`tailwind.config.js`):\n```javascript\nmodule.exports = {\n  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],\n  theme: {\n    extend: {\n      colors: {\n        // Custom colors\n      },\n    },\n  },\n  plugins: [],\n};\n```\n\n---\n\n## Adding New Features\n\n### 1. Adding a New Filter\n\n**Step 1**: Create filter component\n\n```typescript\n// src/components/Filters/MyFilter.tsx\nimport { useDispatch, useSelector } from 'react-redux';\nimport { setMyFilter } from '../../store/graphSlice';\n\nexport const MyFilter: React.FC = () => {\n  const dispatch = useDispatch();\n  const currentValue = useSelector(state => state.graph.filters.myFilter);\n\n  const handleChange = (value: string) => {\n    dispatch(setMyFilter(value));\n  };\n\n  return (\n    <select value={currentValue} onChange={e => handleChange(e.target.value)}>\n      <option value=\"all\">All</option>\n      <option value=\"filtered\">Filtered</option>\n    </select>\n  );\n};\n```\n\n**Step 2**: Add filter state to Redux\n\n```typescript\n// src/store/graphSlice.ts\ninterface GraphState {\n  filters: {\n    // ... existing filters\n    myFilter: string;\n  };\n}\n\nconst initialState: GraphState = {\n  filters: {\n    // ... existing\n    myFilter: 'all',\n  },\n};\n\n// Add reducer\nreducers: {\n  setMyFilter: (state, action: PayloadAction<string>) => {\n    state.filters.myFilter = action.payload;\n  },\n}\n```\n\n**Step 3**: Implement filter logic\n\n```typescript\n// src/utils/graphHelpers.ts\nexport const filterEntitiesByMyFilter = (\n  entities: Entity[],\n  filterValue: string\n): Entity[] => {\n  if (filterValue === 'all') return entities;\n  return entities.filter(e => /* filter logic */);\n};\n```\n\n**Step 4**: Use in component\n\n```typescript\n// src/components/KnowledgeGraph/index.tsx\nimport { MyFilter } from '../Filters/MyFilter';\n\n// In component\n<MyFilter />\n```\n\n### 2. Adding a New Visualization\n\n**Step 1**: Create visualization component\n\n```typescript\n// src/components/MyVisualization.tsx\nimport { useEffect, useRef } from 'react';\nimport * as d3 from 'd3';\n\ninterface Props {\n  data: GraphData;\n}\n\nexport const MyVisualization: React.FC<Props> = ({ data }) => {\n  const svgRef = useRef<SVGSVGElement>(null);\n\n  useEffect(() => {\n    if (!svgRef.current) return;\n\n    const svg = d3.select(svgRef.current);\n    // D3 visualization code\n  }, [data]);\n\n  return <svg ref={svgRef} />;\n};\n```\n\n**Step 2**: Add routing/switching logic\n\n**Step 3**: Connect to Redux state\n\n**Step 4**: Add controls and interactions\n\n### 3. Adding a New Data Source\n\n**Step 1**: Implement data source interface\n\n```typescript\n// src/api/myDataSource.ts\nexport class MyDataSource {\n  async loadData(): Promise<GraphData> {\n    // Fetch data from source\n    const response = await fetch('...');\n    const data = await response.json();\n\n    // Transform to standard format\n    return this.transformData(data);\n  }\n\n  private transformData(raw: any): GraphData {\n    return {\n      entities: raw.nodes.map(/* transform */),\n      relations: raw.edges.map(/* transform */),\n    };\n  }\n}\n```\n\n**Step 2**: Register in database client\n\n```typescript\n// src/api/databaseClient.ts\nimport { MyDataSource } from './myDataSource';\n\nexport const loadFromMySource = async () => {\n  const source = new MyDataSource();\n  return await source.loadData();\n};\n```\n\n**Step 3**: Add UI for source selection\n\n---\n\n## Testing\n\n### Unit Testing (Future)\n\nRecommended setup:\n```bash\nnpm install --save-dev vitest @testing-library/react @testing-library/jest-dom\n```\n\nExample test:\n```typescript\nimport { render, screen } from '@testing-library/react';\nimport { MyComponent } from './MyComponent';\n\ndescribe('MyComponent', () => {\n  it('renders correctly', () => {\n    render(<MyComponent />);\n    expect(screen.getByText('Hello')).toBeInTheDocument();\n  });\n});\n```\n\n### Integration Testing\n\nTest complete workflows:\n- Load data → filter → select entity → view details\n- Upload JSON → validate → render → interact\n- Switch teams → reload → verify isolation\n\n### E2E Testing\n\nUse Playwright or Cypress for end-to-end testing:\n\n```typescript\ntest('loads and displays graph', async ({ page }) => {\n  await page.goto('http://localhost:5173');\n  await page.setInputFiles('input[type=file]', 'test-data.json');\n  await expect(page.locator('svg')).toBeVisible();\n});\n```\n\n---\n\n## Performance Optimization\n\n### React Optimization\n\n**Memoization**:\n```typescript\nimport { memo, useMemo, useCallback } from 'react';\n\n// Memoize component\nexport const MyComponent = memo(({ data }: Props) => {\n  // Memoize expensive calculations\n  const processedData = useMemo(() => {\n    return expensiveCalculation(data);\n  }, [data]);\n\n  // Memoize callbacks\n  const handleClick = useCallback(() => {\n    // Handler logic\n  }, [/* dependencies */]);\n\n  return <div>...</div>;\n});\n```\n\n**Code Splitting**:\n```typescript\nimport { lazy, Suspense } from 'react';\n\nconst HeavyComponent = lazy(() => import('./HeavyComponent'));\n\nfunction App() {\n  return (\n    <Suspense fallback={<Loading />}>\n      <HeavyComponent />\n    </Suspense>\n  );\n}\n```\n\n### D3 Optimization\n\n**Canvas Fallback** for large graphs:\n```typescript\nif (nodes.length > 1000) {\n  // Use canvas instead of SVG\n  const canvas = document.createElement('canvas');\n  const ctx = canvas.getContext('2d');\n  // Canvas rendering\n} else {\n  // SVG rendering\n}\n```\n\n**Throttle Updates**:\n```typescript\nimport { throttle } from 'lodash';\n\nconst handleTick = throttle(() => {\n  // Update visualization\n}, 16); // ~60fps\n\nsimulation.on('tick', handleTick);\n```\n\n### Bundle Optimization\n\n**Vite Configuration**:\n```typescript\n// vite.config.ts\nexport default defineConfig({\n  build: {\n    rollupOptions: {\n      output: {\n        manualChunks: {\n          'd3': ['d3'],\n          'react-vendor': ['react', 'react-dom'],\n          'redux-vendor': ['@reduxjs/toolkit', 'react-redux'],\n        },\n      },\n    },\n  },\n});\n```\n\n---\n\n## Debugging\n\n### React DevTools\n\nInstall React DevTools browser extension:\n- Inspect component tree\n- View props and state\n- Profile performance\n- Track re-renders\n\n### Redux DevTools\n\nInstall Redux DevTools extension:\n- View state changes\n- Time-travel debugging\n- Action replay\n- State export/import\n\n### Browser DevTools\n\n**Console**: Check for errors and warnings\n\n**Network**: Monitor data loading\n\n**Performance**: Profile rendering performance\n\n**Sources**: Set breakpoints in TypeScript\n\n---\n\n## Building for Production\n\n### Build Process\n\n```bash\nnpm run build\n```\n\n**Output**: `dist/` directory containing:\n- Optimized JavaScript bundles\n- Minified CSS\n- Static assets\n- index.html entry point\n\n### Build Optimizations\n\nVite automatically:\n- Tree-shaking for dead code elimination\n- Minification of JS/CSS\n- Asset optimization (images, fonts)\n- Code splitting for lazy loading\n- Cache busting with content hashes\n\n### Environment Variables\n\nCreate `.env` files:\n\n```bash\n# .env.production\nVITE_API_URL=https://api.production.com\nVITE_ENABLE_ANALYTICS=true\n```\n\nAccess in code:\n```typescript\nconst apiUrl = import.meta.env.VITE_API_URL;\n```\n\n---\n\n## Deployment\n\n### Static Hosting\n\n**Vercel**:\n```bash\nnpm install -g vercel\nvercel --prod\n```\n\n**Netlify**:\n```bash\nnpm install -g netlify-cli\nnetlify deploy --prod --dir=dist\n```\n\n**GitHub Pages**:\n```bash\nnpm run build\n# Copy dist/ to gh-pages branch\n```\n\n### Docker Deployment\n\n```dockerfile\n# Dockerfile\nFROM node:18-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\nEXPOSE 80\nCMD [\"nginx\", \"-g\", \"daemon off;\"]\n```\n\nBuild and run:\n```bash\ndocker build -t memory-visualizer .\ndocker run -p 8080:80 memory-visualizer\n```\n\n---\n\n## Contributing\n\n### Code Style\n\nFollow existing patterns:\n- TypeScript strict mode\n- Functional components with hooks\n- Redux Toolkit for state\n- TailwindCSS for styling\n- Descriptive variable names\n\n### Commit Messages\n\nUse conventional commits:\n```\nfeat: add team filter component\nfix: resolve D3 force simulation bug\ndocs: update architecture documentation\nstyle: format code with prettier\nrefactor: extract graph helpers\ntest: add unit tests for filters\n```\n\n### Pull Request Process\n\n1. Fork repository\n2. Create feature branch\n3. Make changes with tests\n4. Update documentation\n5. Submit PR with description\n6. Address review feedback\n\n---\n\n## Troubleshooting\n\n### Common Issues\n\n**Issue**: TypeScript errors in D3 code\n\n**Solution**: Use type assertions or install @types/d3\n\n**Issue**: HMR not working\n\n**Solution**: Check Vite config, restart dev server\n\n**Issue**: Build fails with memory error\n\n**Solution**: Increase Node memory: `NODE_OPTIONS=--max-old-space-size=4096 npm run build`\n\n---\n\n## Resources\n\n- **React Documentation**: https://react.dev\n- **TypeScript Handbook**: https://www.typescriptlang.org/docs\n- **Redux Toolkit**: https://redux-toolkit.js.org\n- **D3.js**: https://d3js.org\n- **Vite**: https://vitejs.dev\n- **TailwindCSS**: https://tailwindcss.com\n\n---\n\n*Development Guide for Memory Visualizer v1.0.0*\n"
}
```

### User

**Result:** ✅ Success

File created successfully at: /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/development.md

### Assistant

Now let me rewrite the main README.md to tie everything together:

### Assistant

**Tool:** TodoWrite
**Input:** ```json
{
  "todos": [
    {
      "content": "Create PlantUML architecture diagrams",
      "status": "completed",
      "activeForm": "Creating PlantUML diagrams"
    },
    {
      "content": "Generate PNG images from PlantUML files",
      "status": "completed",
      "activeForm": "Generating PNG diagrams"
    },
    {
      "content": "Create comprehensive documentation files",
      "status": "completed",
      "activeForm": "Creating documentation files"
    },
    {
      "content": "Rewrite top-level README.md",
      "status": "in_progress",
      "activeForm": "Rewriting README.md"
    }
  ]
}
```

### Assistant

**Tool:** Write
**Input:** ```json
{
  "file_path": "/Users/q284340/Agentic/coding/integrations/memory-visualizer/README.md",
  "content": "# Memory Visualizer\n\nInteractive web-based knowledge graph visualizer for Anthropic's Memory MCP format and GraphDB (LevelDB) storage. Explore, debug, and analyze entities, relations, and observations with a powerful D3.js-powered interface.\n\n![Memory Visualizer Main Interface](docs/images/viewer.png)\n\n*Interactive force-directed graph visualization with real-time filtering and entity details*\n\n---\n\n## ✨ Features\n\n### Core Capabilities\n\n- **📊 Interactive Graph Visualization** - Force-directed layout with D3.js\n- **🔍 Real-Time Filtering** - Filter by entity type, relation type, team, or search\n- **📝 Rich Entity Details** - View observations with markdown and diagram support\n- **👥 Multi-Team Support** - Isolated knowledge bases per team/domain\n- **📂 Flexible Data Sources** - Upload JSON files or connect to GraphDB (LevelDB)\n- **🎨 Smart Rendering** - Syntax highlighting and Mermaid diagram support\n\n### User Experience\n\n- **Drag & Drop**: Upload memory.json files or paste from clipboard\n- **Zoom & Pan**: Navigate large graphs smoothly\n- **Node Details**: Click entities to view observations and relations\n- **Search**: Real-time text search across all entities\n- **Team Navigation**: Switch between team-specific knowledge bases\n\n---\n\n## 🚀 Quick Start\n\n### Online Access\n\n**Live Demo**: [https://memviz.herich.tech](https://memviz.herich.tech)\n\nUpload your `memory.json` file or paste from clipboard to get started instantly.\n\n### Local Installation\n\n```bash\n# Navigate to directory\ncd integrations/memory-visualizer\n\n# Install dependencies\nnpm install\n\n# Start development server\nnpm run dev\n\n# Open browser to http://localhost:5173\n```\n\n---\n\n## 📸 Screenshots\n\n### Main Graph View\n\n![Memory Visualizer Main View](docs/images/viewer.png)\n\n*Interactive knowledge graph with filtering controls and statistics*\n\n### Entity Details Panel\n\n![Entity Insights View](docs/images/insights.png)\n\n*Detailed entity information showing observations, relations, and markdown content*\n\n---\n\n## 🎯 Use Cases\n\n### For Claude Desktop Users\n\nVisualize and debug the knowledge graph created by Claude's Memory MCP server:\n\n1. Configure Claude Desktop with Memory MCP server\n2. Have conversations that create entities and relations\n3. Export or load `memory.json` into visualizer\n4. Explore the knowledge graph visually\n\n### For Coding Project Users\n\nReal-time visualization of the GraphDB knowledge base:\n\n1. Start visualizer locally with `npm run dev`\n2. GraphDB automatically connects to `.data/knowledge-graph/`\n3. Select team to view team-specific knowledge\n4. Explore entities created by UKB, VKB, or Continuous Learning\n\n### For Knowledge Management\n\nAnalyze and debug knowledge structures:\n\n- **Pattern Discovery**: Identify entity clusters and relationships\n- **Quality Assurance**: Verify entity types and relation consistency\n- **Gap Analysis**: Find disconnected entities or missing relations\n- **Team Collaboration**: Share knowledge graphs across teams\n\n---\n\n## 📖 Documentation\n\n### User Documentation\n\n- **[User Guide](docs/user-guide.md)** - Complete usage guide with screenshots\n  - Loading data (JSON upload, GraphDB connection)\n  - Navigating the graph (zoom, pan, select)\n  - Filtering and search\n  - Understanding visualizations\n  - Keyboard shortcuts and tips\n\n### Technical Documentation\n\n- **[Architecture](docs/architecture.md)** - System architecture and design\n  - Component structure and modules\n  - Data flow and state management\n  - Visualization layer (D3.js)\n  - Performance characteristics\n  - Technology stack details\n\n- **[Development Guide](docs/development.md)** - For contributors and developers\n  - Setup and installation\n  - Project structure\n  - Adding new features (filters, visualizations, data sources)\n  - Testing and debugging\n  - Build and deployment\n\n### Architecture Diagrams\n\n![System Architecture](docs/images/architecture.png)\n\n*Complete system architecture showing frontend, visualization layer, and data sources*\n\n![Data Flow](docs/images/data-flow.png)\n\n*End-to-end data flow from initialization through user interactions*\n\n![Component Structure](docs/images/component-structure.png)\n\n*Detailed component hierarchy and module relationships*\n\n---\n\n## 🛠️ Technology Stack\n\n### Core Framework\n\n- **React 18.2** - UI framework with concurrent features\n- **TypeScript 5.3** - Type-safe development\n- **Vite 6.0** - Lightning-fast build tool and dev server\n\n### State & Data\n\n- **Redux Toolkit 2.9** - State management with modern patterns\n- **D3.js 7.8** - Data visualization and force simulation\n- **GraphDB (LevelDB)** - Persistent knowledge graph storage\n\n### UI & Styling\n\n- **TailwindCSS 3.4** - Utility-first CSS framework\n- **react-markdown** - GitHub-flavored markdown rendering\n- **Mermaid 11.6** - Diagram rendering in markdown\n- **highlight.js 11.11** - Syntax highlighting for code blocks\n\n---\n\n## 💾 Data Format\n\n### Memory.json Structure\n\nStandard Anthropic Memory MCP format:\n\n```json\n{\n  \"entities\": [\n    {\n      \"name\": \"React Hooks\",\n      \"entityType\": \"Pattern\",\n      \"observations\": [\n        \"useState manages local component state\",\n        \"useEffect handles side effects and lifecycle\",\n        \"Custom hooks enable reusable stateful logic\"\n      ]\n    },\n    {\n      \"name\": \"React\",\n      \"entityType\": \"Library\",\n      \"observations\": [\n        \"JavaScript library for building UIs\",\n        \"Component-based architecture\",\n        \"Virtual DOM for efficient updates\"\n      ]\n    }\n  ],\n  \"relations\": [\n    {\n      \"from\": \"React Hooks\",\n      \"to\": \"React\",\n      \"relationType\": \"part_of\"\n    }\n  ]\n}\n```\n\n### GraphDB (LevelDB) Format\n\nPersistent storage at `.data/knowledge-graph/`:\n\n**Features**:\n- Multi-team isolation\n- Domain-specific knowledge bases\n- Bidirectional sync with JSON exports\n- Real-time queries\n\n**Structure**:\n```\n.data/knowledge-graph/\n├── entities/\n│   ├── team-a/\n│   └── team-b/\n├── relations/\n│   ├── team-a/\n│   └── team-b/\n└── metadata/\n```\n\n---\n\n## 🔌 Integration\n\n### With Claude Desktop\n\nConfigure Memory MCP server in Claude Desktop:\n\n```json\n{\n  \"memory\": {\n    \"command\": \"npx\",\n    \"args\": [\"-y\", \"@modelcontextprotocol/server-memory\"],\n    \"env\": {\n      \"MEMORY_FILE_PATH\": \"/path/to/memory.json\"\n    }\n  }\n}\n```\n\nThen visualize the generated `memory.json` file.\n\n### With Coding Project\n\nThe visualizer integrates seamlessly with the coding project's knowledge management:\n\n1. **UKB (Update Knowledge Base)**: Manual knowledge capture\n2. **VKB (Visualize Knowledge Base)**: Web-based graph viewer (port 8080)\n3. **Memory Visualizer**: Alternative D3-based visualization (port 5173)\n4. **Continuous Learning**: Automatic session knowledge extraction\n\nAll systems share the same GraphDB (LevelDB) storage.\n\n---\n\n## 🚢 Deployment\n\n### Development\n\n```bash\nnpm run dev\n```\n\nRuns on `http://localhost:5173` with hot module replacement.\n\n### Production Build\n\n```bash\nnpm run build\n```\n\nGenerates optimized static files in `dist/` directory.\n\n### Preview Build\n\n```bash\nnpm run preview\n```\n\nPreview production build locally before deployment.\n\n### Hosting Options\n\n**Static Hosting**:\n- Vercel (recommended)\n- Netlify\n- GitHub Pages\n- Cloudflare Pages\n\n**Self-Hosted**:\n- Nginx/Apache\n- Docker container\n- Kubernetes\n\nSee [Development Guide](docs/development.md#deployment) for detailed deployment instructions.\n\n---\n\n## 🎨 Customization\n\n### Visualization Settings\n\nEdit force simulation parameters in `GraphVisualization.tsx`:\n\n```typescript\nconst simulation = d3.forceSimulation(nodes)\n  .force('link', d3.forceLink(links).distance(100))      // Link distance\n  .force('charge', d3.forceManyBody().strength(-300))     // Repulsion strength\n  .force('center', d3.forceCenter(width / 2, height / 2)) // Centering\n  .force('collision', d3.forceCollide().radius(30));      // Collision radius\n```\n\n### Styling\n\nTailwindCSS classes can be customized in `tailwind.config.js`:\n\n```javascript\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        primary: '#your-color',\n        // ... custom colors\n      },\n    },\n  },\n};\n```\n\n### Node Colors\n\nEntity type colors defined in `GraphVisualization.tsx`:\n\n```typescript\nconst colorScale = d3.scaleOrdinal()\n  .domain(['Pattern', 'Solution', 'Tool', 'Architecture'])\n  .range(['#9333ea', '#f97316', '#06b6d4', '#10b981']);\n```\n\n---\n\n## 🤝 Contributing\n\nContributions are welcome! See [Development Guide](docs/development.md) for details.\n\n### Development Setup\n\n1. Fork the repository\n2. Create a feature branch\n3. Make your changes\n4. Add tests (future)\n5. Update documentation\n6. Submit a pull request\n\n### Code Style\n\n- TypeScript strict mode\n- Functional React components with hooks\n- Redux Toolkit for state management\n- TailwindCSS for styling\n- Conventional commit messages\n\n---\n\n## 📝 License\n\nPart of the Coding project. Copyright © 2024. All rights reserved.\n\n---\n\n## 🔗 Links\n\n- **Live Demo**: [https://memviz.herich.tech](https://memviz.herich.tech)\n- **Documentation**: [docs/](docs/)\n- **Architecture**: [docs/architecture.md](docs/architecture.md)\n- **User Guide**: [docs/user-guide.md](docs/user-guide.md)\n- **Development**: [docs/development.md](docs/development.md)\n\n---\n\n## 📊 Project Status\n\n**Version**: 1.0.0\n**Status**: Production Ready ✅\n**Last Updated**: 2025-10-26\n\n### Features Complete\n\n- ✅ Interactive D3.js force-directed graph\n- ✅ Entity and relation type filtering\n- ✅ Real-time text search\n- ✅ Multi-team support with GraphDB\n- ✅ JSON file upload (drag & drop, clipboard)\n- ✅ Markdown rendering with syntax highlighting\n- ✅ Mermaid diagram support\n- ✅ Responsive design\n- ✅ Comprehensive documentation\n\n### Future Enhancements\n\n- ⏳ Graph export (PNG, SVG, JSON subgraphs)\n- ⏳ Advanced analytics and metrics\n- ⏳ Custom visualization layouts\n- ⏳ Collaborative annotations\n- ⏳ Version history and diff view\n\n---\n\n*Built with ❤️ for knowledge graph exploration and debugging*\n"
}
```

### User

**Result:** ✅ Success

Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable

### User

**Result:** ✅ Success

The file /Users/q284340/Agentic/coding/integrations/memory-visualizer/README.md has been updated. Here's the result of running `cat -n` on a snippet of the edited file:
     1→# Memory Visualizer
     2→
     3→Interactive web-based knowledge graph visualizer for Anthropic's Memory MCP format and GraphDB (LevelDB) storage. Explore, debug, and analyze entities, relations, and observations with a powerful D3.js-powered interface.
     4→
     5→![Memory Visualizer Main Interface](docs/images/viewer.png)
     6→
     7→*Interactive force-directed graph visualization with real-time filtering and entity details*
     8→
     9→---
    10→
    11→## ✨ Features
    12→
    13→### Core Capabilities
    14→
    15→- **📊 Interactive Graph Visualization** - Force-directed layout with D3.js
    16→- **🔍 Real-Time Filtering** - Filter by entity type, relation type, team, or search
    17→- **📝 Rich Entity Details** - View observations with markdown and diagram support
    18→- **👥 Multi-Team Support** - Isolated knowledge bases per team/domain
    19→- **📂 Flexible Data Sources** - Upload JSON files or connect to GraphDB (LevelDB)
    20→- **🎨 Smart Rendering** - Syntax highlighting and Mermaid diagram support
    21→
    22→### User Experience
    23→
    24→- **Drag & Drop**: Upload memory.json files or paste from clipboard
    25→- **Zoom & Pan**: Navigate large graphs smoothly
    26→- **Node Details**: Click entities to view observations and relations
    27→- **Search**: Real-time text search across all entities
    28→- **Team Navigation**: Switch between team-specific knowledge bases
    29→
    30→---
    31→
    32→## 🚀 Quick Start
    33→
    34→### Online Access
    35→
    36→**Live Demo**: [https://memviz.herich.tech](https://memviz.herich.tech)
    37→
    38→Upload your `memory.json` file or paste from clipboard to get started instantly.
    39→
    40→### Local Installation
    41→
    42→```bash
    43→# Navigate to directory
    44→cd integrations/memory-visualizer
    45→
    46→# Install dependencies
    47→npm install
    48→
    49→# Start development server
    50→npm run dev
    51→
    52→# Open browser to http://localhost:5173
    53→```
    54→
    55→---
    56→
    57→## 📸 Screenshots
    58→
    59→### Main Graph View
    60→
    61→![Memory Visualizer Main View](docs/images/viewer.png)
    62→
    63→*Interactive knowledge graph with filtering controls and statistics*
    64→
    65→### Entity Details Panel
    66→
    67→![Entity Insights View](docs/images/insights.png)
    68→
    69→*Detailed entity information showing observations, relations, and markdown content*
    70→
    71→---
    72→
    73→## 🎯 Use Cases
    74→
    75→### For Claude Desktop Users
    76→
    77→Visualize and debug the knowledge graph created by Claude's Memory MCP server:
    78→
    79→1. Configure Claude Desktop with Memory MCP server
    80→2. Have conversations that create entities and relations
    81→3. Export or load `memory.json` into visualizer
    82→4. Explore the knowledge graph visually
    83→
    84→### For Coding Project Users
    85→
    86→Real-time visualization of the GraphDB knowledge base:
    87→
    88→1. Start visualizer locally with `npm run dev`
    89→2. GraphDB automatically connects to `.data/knowledge-graph/`
    90→3. Select team to view team-specific knowledge
    91→4. Explore entities created by UKB, VKB, or Continuous Learning
    92→
    93→### For Knowledge Management
    94→
    95→Analyze and debug knowledge structures:
    96→
    97→- **Pattern Discovery**: Identify entity clusters and relationships
    98→- **Quality Assurance**: Verify entity types and relation consistency
    99→- **Gap Analysis**: Find disconnected entities or missing relations
   100→- **Team Collaboration**: Share knowledge graphs across teams
   101→
   102→---
   103→
   104→## 📖 Documentation
   105→
   106→### User Documentation
   107→
   108→- **[User Guide](docs/user-guide.md)** - Complete usage guide with screenshots
   109→  - Loading data (JSON upload, GraphDB connection)
   110→  - Navigating the graph (zoom, pan, select)
   111→  - Filtering and search
   112→  - Understanding visualizations
   113→  - Keyboard shortcuts and tips
   114→
   115→### Technical Documentation
   116→
   117→- **[Architecture](docs/architecture.md)** - System architecture and design
   118→  - Component structure and modules
   119→  - Data flow and state management
   120→  - Visualization layer (D3.js)
   121→  - Performance characteristics
   122→  - Technology stack details
   123→
   124→- **[Development Guide](docs/development.md)** - For contributors and developers
   125→  - Setup and installation
   126→  - Project structure
   127→  - Adding new features (filters, visualizations, data sources)
   128→  - Testing and debugging
   129→  - Build and deployment
   130→
   131→### Architecture Diagrams
   132→
   133→![System Architecture](docs/images/architecture.png)
   134→
   135→*Complete system architecture showing frontend, visualization layer, and data sources*
   136→
   137→![Data Flow](docs/images/data-flow.png)
   138→
   139→*End-to-end data flow from initialization through user interactions*
   140→
   141→![Component Structure](docs/images/component-structure.png)
   142→
   143→*Detailed component hierarchy and module relationships*
   144→
   145→---
   146→
   147→## 🛠️ Technology Stack
   148→
   149→### Core Framework
   150→
   151→- **React 18.2** - UI framework with concurrent features
   152→- **TypeScript 5.3** - Type-safe development
   153→- **Vite 6.0** - Lightning-fast build tool and dev server
   154→
   155→### State & Data
   156→
   157→- **Redux Toolkit 2.9** - State management with modern patterns
   158→- **D3.js 7.8** - Data visualization and force simulation
   159→- **GraphDB (LevelDB)** - Persistent knowledge graph storage
   160→
   161→### UI & Styling
   162→
   163→- **TailwindCSS 3.4** - Utility-first CSS framework
   164→- **react-markdown** - GitHub-flavored markdown rendering
   165→- **Mermaid 11.6** - Diagram rendering in markdown
   166→- **highlight.js 11.11** - Syntax highlighting for code blocks
   167→
   168→---
   169→
   170→## 💾 Data Format
   171→
   172→### Memory.json Structure
   173→
   174→Standard Anthropic Memory MCP format:
   175→
   176→```json
   177→{
   178→  "entities": [
   179→    {
   180→      "name": "React Hooks",
   181→      "entityType": "Pattern",
   182→      "observations": [
   183→        "useState manages local component state",
   184→        "useEffect handles side effects and lifecycle",
   185→        "Custom hooks enable reusable stateful logic"
   186→      ]
   187→    },
   188→    {
   189→      "name": "React",
   190→      "entityType": "Library",
   191→      "observations": [
   192→        "JavaScript library for building UIs",
   193→        "Component-based architecture",
   194→        "Virtual DOM for efficient updates"
   195→      ]
   196→    }
   197→  ],
   198→  "relations": [
   199→    {
   200→      "from": "React Hooks",
   201→      "to": "React",
   202→      "relationType": "part_of"
   203→    }
   204→  ]
   205→}
   206→```
   207→
   208→### GraphDB (LevelDB) Format
   209→
   210→Persistent storage at `.data/knowledge-graph/`:
   211→
   212→**Features**:
   213→- Multi-team isolation
   214→- Domain-specific knowledge bases
   215→- Bidirectional sync with JSON exports
   216→- Real-time queries
   217→
   218→**Structure**:
   219→```
   220→.data/knowledge-graph/
   221→├── entities/
   222→│   ├── team-a/
   223→│   └── team-b/
   224→├── relations/
   225→│   ├── team-a/
   226→│   └── team-b/
   227→└── metadata/
   228→```
   229→
   230→---
   231→
   232→## 🔌 Integration
   233→
   234→### With Claude Desktop
   235→
   236→Configure Memory MCP server in Claude Desktop:
   237→
   238→```json
   239→{
   240→  "memory": {
   241→    "command": "npx",
   242→    "args": ["-y", "@modelcontextprotocol/server-memory"],
   243→    "env": {
   244→      "MEMORY_FILE_PATH": "/path/to/memory.json"
   245→    }
   246→  }
   247→}
   248→```
   249→
   250→Then visualize the generated `memory.json` file.
   251→
   252→### With Coding Project
   253→
   254→The visualizer integrates seamlessly with the coding project's knowledge management:
   255→
   256→1. **UKB (Update Knowledge Base)**: Manual knowledge capture
   257→2. **VKB (Visualize Knowledge Base)**: Web-based graph viewer (port 8080)
   258→3. **Memory Visualizer**: Alternative D3-based visualization (port 5173)
   259→4. **Continuous Learning**: Automatic session knowledge extraction
   260→
   261→All systems share the same GraphDB (LevelDB) storage.
   262→
   263→---
   264→
   265→## 🚢 Deployment
   266→
   267→### Development
   268→
   269→```bash
   270→npm run dev
   271→```
   272→
   273→Runs on `http://localhost:5173` with hot module replacement.
   274→
   275→### Production Build
   276→
   277→```bash
   278→npm run build
   279→```
   280→
   281→Generates optimized static files in `dist/` directory.
   282→
   283→### Preview Build
   284→
   285→```bash
   286→npm run preview
   287→```
   288→
   289→Preview production build locally before deployment.
   290→
   291→### Hosting Options
   292→
   293→**Static Hosting**:
   294→- Vercel (recommended)
   295→- Netlify
   296→- GitHub Pages
   297→- Cloudflare Pages
   298→
   299→**Self-Hosted**:
   300→- Nginx/Apache
   301→- Docker container
   302→- Kubernetes
   303→
   304→See [Development Guide](docs/development.md#deployment) for detailed deployment instructions.
   305→
   306→---
   307→
   308→## 🎨 Customization
   309→
   310→### Visualization Settings
   311→
   312→Edit force simulation parameters in `GraphVisualization.tsx`:
   313→
   314→```typescript
   315→const simulation = d3.forceSimulation(nodes)
   316→  .force('link', d3.forceLink(links).distance(100))      // Link distance
   317→  .force('charge', d3.forceManyBody().strength(-300))     // Repulsion strength
   318→  .force('center', d3.forceCenter(width / 2, height / 2)) // Centering
   319→  .force('collision', d3.forceCollide().radius(30));      // Collision radius
   320→```
   321→
   322→### Styling
   323→
   324→TailwindCSS classes can be customized in `tailwind.config.js`:
   325→
   326→```javascript
   327→module.exports = {
   328→  theme: {
   329→    extend: {
   330→      colors: {
   331→        primary: '#your-color',
   332→        // ... custom colors
   333→      },
   334→    },
   335→  },
   336→};
   337→```
   338→
   339→### Node Colors
   340→
   341→Entity type colors defined in `GraphVisualization.tsx`:
   342→
   343→```typescript
   344→const colorScale = d3.scaleOrdinal()
   345→  .domain(['Pattern', 'Solution', 'Tool', 'Architecture'])
   346→  .range(['#9333ea', '#f97316', '#06b6d4', '#10b981']);
   347→```
   348→
   349→---
   350→
   351→## 🤝 Contributing
   352→
   353→Contributions are welcome! See [Development Guide](docs/development.md) for details.
   354→
   355→### Development Setup
   356→
   357→1. Fork the repository
   358→2. Create a feature branch
   359→3. Make your changes
   360→4. Add tests (future)
   361→5. Update documentation
   362→6. Submit a pull request
   363→
   364→### Code Style
   365→
   366→- TypeScript strict mode
   367→- Functional React components with hooks
   368→- Redux Toolkit for state management
   369→- TailwindCSS for styling
   370→- Conventional commit messages
   371→
   372→---
   373→
   374→## 📝 License
   375→
   376→Part of the Coding project. Copyright © 2024. All rights reserved.
   377→
   378→---
   379→
   380→## 🔗 Links
   381→
   382→- **Live Demo**: [https://memviz.herich.tech](https://memviz.herich.tech)
   383→- **Documentation**: [docs/](docs/)
   384→- **Architecture**: [docs/architecture.md](docs/architecture.md)
   385→- **User Guide**: [docs/user-guide.md](docs/user-guide.md)
   386→- **Development**: [docs/development.md](docs/development.md)
   387→
   388→---
   389→
   390→## 📊 Project Status
   391→
   392→**Version**: 1.0.0
   393→**Status**: Production Ready ✅
   394→**Last Updated**: 2025-10-26
   395→
   396→### Features Complete
   397→
   398→- ✅ Interactive D3.js force-directed graph
   399→- ✅ Entity and relation type filtering
   400→- ✅ Real-time text search
   401→- ✅ Multi-team support with GraphDB
   402→- ✅ JSON file upload (drag & drop, clipboard)
   403→- ✅ Markdown rendering with syntax highlighting
   404→- ✅ Mermaid diagram support
   405→- ✅ Responsive design
   406→- ✅ Comprehensive documentation
   407→
   408→### Future Enhancements
   409→
   410→- ⏳ Graph export (PNG, SVG, JSON subgraphs)
   411→- ⏳ Advanced analytics and metrics
   412→- ⏳ Custom visualization layouts
   413→- ⏳ Collaborative annotations
   414→- ⏳ Version history and diff view
   415→
   416→---
   417→
   418→*Built with ❤️ for knowledge graph exploration and debugging*
   419→

### Assistant

Perfect! Now let me mark the task as complete and verify all documentation is properly linked:

### Assistant

**Tool:** TodoWrite
**Input:** ```json
{
  "todos": [
    {
      "content": "Create PlantUML architecture diagrams",
      "status": "completed",
      "activeForm": "Creating PlantUML diagrams"
    },
    {
      "content": "Generate PNG images from PlantUML files",
      "status": "completed",
      "activeForm": "Generating PNG diagrams"
    },
    {
      "content": "Create comprehensive documentation files",
      "status": "completed",
      "activeForm": "Creating documentation files"
    },
    {
      "content": "Rewrite top-level README.md",
      "status": "completed",
      "activeForm": "Rewriting README.md"
    }
  ]
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "ls -la /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/",
  "description": "List all documentation files"
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "ls -la /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/puml/",
  "description": "List PlantUML source files"
}
```

### Assistant

**Tool:** Bash
**Input:** ```json
{
  "command": "ls -la /Users/q284340/Agentic/coding/integrations/memory-visualizer/docs/images/",
  "description": "List generated diagram images"
}
```

### User

**Result:** ✅ Success

Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable

### User

**Result:** ✅ Success

total 24
drwxr-xr-x@ 5 q284340  staff   160 Oct 26 12:18 .
drwxr-xr-x@ 8 q284340  staff   256 Oct 26 12:21 ..
-rw-r--r--@ 1 q284340  staff  2099 Oct 26 12:17 architecture.puml
-rw-r--r--@ 1 q284340  staff  2585 Oct 26 12:17 component-structure.puml
-rw-r--r--@ 1 q284340  staff  3335 Oct 26 12:17 data-flow.puml

### User

**Result:** ✅ Success

total 96
drwxr-xr-x@  8 q284340  staff    256 Oct 26 12:21 .
drwxr-xr-x@ 25 q284340  staff    800 Oct 26 12:22 ..
-rw-r--r--@  1 q284340  staff   6148 Oct 26 12:15 .DS_Store
-rw-r--r--@  1 q284340  staff   9363 Oct 26 12:19 architecture.md
-rw-r--r--@  1 q284340  staff  13779 Oct 26 12:21 development.md
drwxr-xr-x@  7 q284340  staff    224 Oct 26 12:18 images
drwxr-xr-x@  5 q284340  staff    160 Oct 26 12:18 puml
-rw-r--r--@  1 q284340  staff   9112 Oct 26 12:20 user-guide.md

### User

**Result:** ✅ Success

total 4712
drwxr-xr-x@ 7 q284340  staff      224 Oct 26 12:18 .
drwxr-xr-x@ 8 q284340  staff      256 Oct 26 12:21 ..
-rw-r--r--@ 1 q284340  staff   121515 Oct 26 12:18 architecture.png
-rw-r--r--@ 1 q284340  staff   134814 Oct 26 12:18 component-structure.png
-rw-r--r--@ 1 q284340  staff   146002 Oct 26 12:18 data-flow.png
-rw-r--r--@ 1 q284340  staff   889919 Oct 26 12:10 insights.png
-rw-r--r--@ 1 q284340  staff  1045376 Oct 26 12:12 viewer.png

### Assistant

Excellent! Now let me create a summary of what was accomplished:

## Documentation Complete for Memory Visualizer! ✅

I've successfully created comprehensive documentation for the memory-visualizer integration with the following structure:

### Documentation Files Created

**Main Documentation** (`/docs/`):
1. **architecture.md** (9.4 KB) - Complete system architecture
   - Component structure and modules
   - Data flow and state management
   - Visualization layer details
   - Performance characteristics
   - Technology stack

2. **user-guide.md** (9.1 KB) - End-user documentation
   - Quick start and interface overview
   - Loading data (JSON upload, GraphDB)
   - Navigation and interaction
   - Filtering and search features
   - Tips and troubleshooting

3. **development.md** (13.8 KB) - Developer guide
   - Setup and installation
   - Project structure
   - Adding new features
   - Testing and debugging
   - Build and deployment

### PlantUML Diagrams (`/docs/puml/`)

1. **architecture.puml** - System architecture overview
2. **data-flow.puml** - Data flow sequence diagram
3. **component-structure.puml** - Component hierarchy

All using the standard `coding/docs/puml/_standard-style.puml` with vertical orientation.

### Generated Diagrams (`/docs/images/`)

1. **architecture.png** (121 KB) - System architecture
2. **data-flow.png** (146 KB) - Data flow sequence
3. **component-structure.png** (135 KB) - Component structure
4. **viewer.png** (1 MB) - Main interface screenshot
5. **insights.png** (890 KB) - Entity details screenshot

### Updated README.md

Completely rewritten top-level README with:
- Feature highlights and screenshots
- Quick start instructions
- Use cases (Claude Desktop, Coding project, general knowledge management)
- Complete documentation links
- Technology stack details
- Data format specifications
- Integration guides
- Deployment options
- Project status and roadmap

### Key Features of Documentation

✅ **All documents reachable from README.md**
✅ **Screenshots properly referenced** (viewer.png, insights.png)
✅ **Vertically-oriented PlantUML diagrams**
✅ **Standard style inclusion** from coding/docs/puml/_standard-style.puml
✅ **PNG diagrams in images folder**
✅ **Comprehensive coverage** of architecture, usage, and development
✅ **Clear navigation** between documents
✅ **Professional formatting** with tables, code blocks, and diagrams

The memory-visualizer is now fully documented and ready for use!

---

