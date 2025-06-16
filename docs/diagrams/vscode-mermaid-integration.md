# VSCode Extension Integration - Mermaid Diagrams

## System Overview

```mermaid
graph TB
    subgraph "Developer Environment"
        A[VSCode IDE]
        B[GitHub Copilot Chat]
        C[Command Palette]
        D[Status Bar]
    end
    
    subgraph "Extension Layer"
        E[Extension Bridge]
        F[Chat Participant @km]
        G[Fallback Client]
        H[WebSocket Client]
    end
    
    subgraph "Service Layer"
        I[HTTP Server :8765]
        J[Service Manager]
        K[WebSocket Server]
    end
    
    subgraph "Knowledge Layer"
        L[UKB Command]
        M[VKB Command]
        N[shared-memory.json]
        O[Memory Visualizer :8080]
    end
    
    A --> B
    A --> C
    A --> D
    B --> F
    C --> E
    F --> G
    G --> I
    G --> H
    H --> K
    I --> J
    J --> L
    J --> M
    L --> N
    M --> O
    N --> O
    K --> H
    
    style A fill:#e3f2fd
    style F fill:#f3e5f5
    style I fill:#e8f5e8
    style N fill:#fff3e0
```

## Command Flow Sequence

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant VS as VSCode
    participant Ext as Extension
    participant HTTP as HTTP Server
    participant UKB as UKB Service
    participant KB as Knowledge Base
    
    Dev->>VS: @KM ukb Problem: X, Solution: Y
    VS->>Ext: Route chat command
    Ext->>Ext: Parse pattern structure
    Ext->>HTTP: POST /api/knowledge/update
    HTTP->>UKB: Execute UKB with pattern
    UKB->>KB: Update shared-memory.json
    KB-->>UKB: Confirmation
    UKB-->>HTTP: Success response
    HTTP-->>Ext: Entity details
    Ext->>VS: Formatted response + buttons
    VS->>Dev: Show pattern confirmation
```

## Auto-Analysis Workflow

```mermaid
flowchart TD
    A[Developer: @KM ukb] --> B{Pattern Specified?}
    B -->|No| C[Auto-Analysis Mode]
    B -->|Yes| D[Manual Pattern Entry]
    
    C --> E[Analyze Git Commits]
    C --> F[Process Conversation Logs]
    E --> G[Extract Code Patterns]
    F --> H[Extract Discussion Insights]
    G --> I[Combine Insights]
    H --> I
    I --> J[Score Significance]
    J --> K[Update Knowledge Base]
    K --> L[Return Discovered Patterns]
    
    D --> M[Parse Problem/Solution]
    M --> N[Create Entity]
    N --> K
    K --> O[Return Pattern Entity]
    
    L --> P[Display Multiple Insights]
    O --> Q[Display Single Pattern]
    
    style C fill:#ffeb3b
    style D fill:#4caf50
    style K fill:#ff9800
```

## Service Communication Architecture

```mermaid
graph LR
    subgraph "VSCode Extension"
        A[Chat Participant]
        B[HTTP Client]
        C[WebSocket Client]
    end
    
    subgraph "API Layer"
        D[HTTP Server :8765]
        E[WebSocket Server]
        F[Health Endpoint]
        G[Knowledge API]
        H[Viewer API]
    end
    
    subgraph "Service Layer"
        I[Service Manager]
        J[UKB Handler]
        K[VKB Handler]
        L[Search Handler]
    end
    
    subgraph "Data Layer"
        M[shared-memory.json]
        N[Memory Visualizer]
        O[Git Repository]
    end
    
    A --> B
    A --> C
    B --> D
    C --> E
    D --> F
    D --> G
    D --> H
    G --> I
    I --> J
    I --> K
    I --> L
    J --> M
    K --> N
    L --> M
    M --> O
    
    style A fill:#e1f5fe
    style D fill:#e8f5e8
    style M fill:#fff3e0
```

## Real-time Update Flow

```mermaid
sequenceDiagram
    participant Ext as VSCode Extension
    participant WS as WebSocket Server
    participant Svc as Service Manager
    participant KB as Knowledge Base
    participant UI as VSCode UI
    
    Note over Ext,WS: Initial Connection
    Ext->>WS: Connect to ws://localhost:8765/ws
    WS-->>Ext: Connection established
    
    Note over Svc,KB: Knowledge Update
    Svc->>KB: Update shared-memory.json
    KB-->>Svc: Write confirmation
    Svc->>WS: Broadcast knowledge_updated
    WS->>Ext: WebSocket message
    Ext->>UI: Show notification
    
    Note over Svc,UI: Service Status
    Svc->>WS: Broadcast service_status
    WS->>Ext: Status message
    Ext->>UI: Update status bar
    
    Note over Ext,UI: Error Handling
    WS->>Ext: Connection error
    Ext->>UI: Show warning message
    Ext->>WS: Attempt reconnection
```

## Pattern Search and Discovery

```mermaid
graph TD
    A[Search Query: @KM search React] --> B[Extract Search Terms]
    B --> C[Query Knowledge Base]
    C --> D{Results Found?}
    
    D -->|Yes| E[Rank by Relevance]
    D -->|No| F[Show No Results]
    
    E --> G[Filter by Significance]
    G --> H[Format Results]
    H --> I[Display in Chat]
    
    I --> J[Show Pattern Details]
    J --> K[Problem Description]
    J --> L[Solution Approach]
    J --> M[Code Examples]
    J --> N[Related Patterns]
    
    N --> O[Clickable Links]
    O --> P[Navigate to Related]
    
    style C fill:#2196f3
    style E fill:#ff9800
    style H fill:#4caf50
```

## Team Knowledge Sharing

```mermaid
flowchart TB
    subgraph "Developer A Environment"
        A1[VSCode A]
        A2[Extension A]
        A3[Local Git]
    end
    
    subgraph "Developer B Environment" 
        B1[VSCode B]
        B2[Extension B]
        B3[Local Git]
    end
    
    subgraph "Shared Resources"
        S1[Git Repository]
        S2[shared-memory.json]
        S3[Team Knowledge Base]
    end
    
    A2 --> A3: Update local KB
    A3 --> S1: Push changes
    S1 --> S2: Sync shared-memory.json
    S2 --> S3: Update team knowledge
    S3 --> B3: Pull changes
    B3 --> B2: Load new patterns
    B2 --> B1: Display in VSCode
    
    style S2 fill:#ff9800
    style S3 fill:#4caf50
```

## Extension Lifecycle Management

```mermaid
stateDiagram-v2
    [*] --> Installing: npm install
    Installing --> Inactive: Installation complete
    Inactive --> Activating: VSCode loads extension
    Activating --> ServiceCheck: Check fallback services
    
    ServiceCheck --> ServicesRunning: Port 8765 responds
    ServiceCheck --> StartingServices: No response
    
    StartingServices --> ServicesRunning: Services started
    StartingServices --> Error: Failed to start
    
    ServicesRunning --> Active: Register chat participant
    Active --> Connected: WebSocket connected
    Connected --> Ready: Show "KM Ready"
    
    Ready --> Processing: Handle @KM command
    Processing --> Ready: Command complete
    
    Ready --> Disconnected: Service failure
    Disconnected --> Reconnecting: Attempt reconnect
    Reconnecting --> Connected: Success
    Reconnecting --> Error: Failed
    
    Error --> Inactive: Extension disabled
    Ready --> Deactivating: VSCode closes
    Deactivating --> [*]: Cleanup complete
```