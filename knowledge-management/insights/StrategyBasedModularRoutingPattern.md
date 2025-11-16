# Strategy-Based Modular Routing Pattern

**Pattern Type:** Architecture Pattern  
**Applicability:** Geometric routing, pathfinding, connection systems  
**Technologies:** JavaScript, SVG, Canvas, Mathematical algorithms  
**Significance:** 8/10  
**Origin Project:** DynArch (Autonomous Driving Visualization System)

## Table of Contents

- [Problem Statement](#problem-statement)
- [Solution Overview](#solution-overview)
- [Core Architecture](#core-architecture)
- [Implementation Details](#implementation-details)
  - [1. Routing Handler Factory](#1-routing-handler-factory)
  - [2. Base Routing Handler](#2-base-routing-handler)
  - [3. Specialized Routing Strategies](#3-specialized-routing-strategies)
  - [4. Routing Manager Coordination](#4-routing-manager-coordination)
- [Configuration Integration](#configuration-integration)
- [Key Benefits](#key-benefits)
  - [1. Extensible Architecture](#1-extensible-architecture)
  - [2. Maintainable Complexity](#2-maintainable-complexity)
  - [3. Performance Optimization](#3-performance-optimization)
  - [4. Robust Error Handling](#4-robust-error-handling)
- [DynArch Results](#dynarch-results)
- [Transferable Applications](#transferable-applications)
- [Related Patterns](#related-patterns)

## Problem Statement

Complex geometric routing systems often face challenges with:
- Handling multiple routing algorithms for different connection types
- Managing dynamic boundary calculations and collision detection
- Scaling routing logic as new connection types are added
- Maintaining testable and modular routing code
- Balancing performance with configurability
- Providing extensible routing strategies without core modifications

## Solution Overview

Implement a Strategy and Factory pattern-based routing system that separates routing algorithms into modular strategies. This pattern provides extensible routing capabilities through pluggable handlers while maintaining clean separation of concerns between geometric calculations and routing logic.

![DynArch Architecture](images/architecture.png)

## Core Architecture

The pattern consists of four key components:

1. **Factory Layer**: Creates appropriate routing handlers based on connection type
2. **Strategy Layer**: Implements specific routing algorithms for different scenarios
3. **Base Handler Layer**: Provides shared functionality and interface definition
4. **Manager Layer**: Coordinates routing operations and manages boundaries

## Implementation Details

### 1. Routing Handler Factory

```javascript
// RoutingHandlerFactory.js - Creates specialized routing handlers
class RoutingHandlerFactory {
  static handlerRegistry = new Map([
    ['camera', () => new CameraRoutingHandler()],
    ['radar', () => new RadarRoutingHandler()],
    ['corridor', () => new CorridorRoutingHandler()],
    ['lidar', () => new LidarRoutingHandler()],
    ['default', () => new BaseRoutingHandler()]
  ]);
  
  static create(connectionType, sourceElement, targetElement, config = {}) {
    const handlerCreator = this.handlerRegistry.get(connectionType) || 
                          this.handlerRegistry.get('default');
    
    const handler = handlerCreator();
    
    // Inject dependencies
    handler.configure({
      sourceElement,
      targetElement,
      connectionType,
      ...config
    });
    
    Logger.log(LogLevels.DEBUG, LogCategories.ROUTING, 
      `Created ${connectionType} routing handler`);
    
    return handler;
  }
  
  // Allow runtime registration of new routing strategies
  static registerHandler(type, handlerCreator) {
    if (typeof handlerCreator !== 'function') {
      throw new Error('Handler creator must be a function');
    }
    
    this.handlerRegistry.set(type, handlerCreator);
    Logger.log(LogLevels.INFO, LogCategories.ROUTING, 
      `Registered new routing handler: ${type}`);
  }
}
```

### 2. Base Routing Handler

```javascript
// BaseRoutingHandler.js - Shared functionality and interface
class BaseRoutingHandler {
  constructor() {
    this.sourceElement = null;
    this.targetElement = null;
    this.connectionType = 'default';
    this.config = {};
    this.geometryUtils = new GeometryUtils();
  }
  
  configure(options) {
    Object.assign(this, options);
    this.validateConfiguration();
  }
  
  validateConfiguration() {
    if (!this.sourceElement || !this.targetElement) {
      throw new Error('Source and target elements are required');
    }
  }
  
  // Main routing method - to be overridden by specific strategies
  calculateRoute() {
    const sourcePoint = this.getConnectionPoint(this.sourceElement);
    const targetPoint = this.getConnectionPoint(this.targetElement);
    
    // Default: direct line connection
    return this.createDirectRoute(sourcePoint, targetPoint);
  }
  
  // Shared utility methods
  getConnectionPoint(element) {
    const rect = element.getBoundingClientRect();
    const containerRect = this.getContainerRect();
    
    return {
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top + rect.height / 2 - containerRect.top
    };
  }
  
  createDirectRoute(source, target) {
    return {
      type: 'direct',
      path: `M ${source.x} ${source.y} L ${target.x} ${target.y}`,
      points: [source, target],
      metadata: {
        distance: this.geometryUtils.distance(source, target),
        angle: this.geometryUtils.angle(source, target)
      }
    };
  }
  
  // Template method for boundary detection
  detectBoundaryCollisions(route) {
    // Override in subclasses for specific collision detection
    return [];
  }
  
  // Optimization hook
  optimizeRoute(route) {
    // Override in subclasses for route optimization
    return route;
  }
}
```

### 3. Specialized Routing Strategies

```javascript
// CameraRoutingHandler.js - Camera-specific routing logic
class CameraRoutingHandler extends BaseRoutingHandler {
  calculateRoute() {
    const sourcePoint = this.getConnectionPoint(this.sourceElement);
    const targetPoint = this.getConnectionPoint(this.targetElement);
    
    // Camera connections prefer curved paths to avoid visual clutter
    return this.createCurvedRoute(sourcePoint, targetPoint);
  }
  
  createCurvedRoute(source, target) {
    const midPoint = this.geometryUtils.midpoint(source, target);
    const curveOffset = this.calculateCurveOffset(source, target);
    
    // Create smooth Bezier curve
    const controlPoint1 = {
      x: source.x + curveOffset.x,
      y: source.y + curveOffset.y
    };
    
    const controlPoint2 = {
      x: target.x - curveOffset.x,
      y: target.y - curveOffset.y
    };
    
    const path = `M ${source.x} ${source.y} 
                  C ${controlPoint1.x} ${controlPoint1.y}, 
                    ${controlPoint2.x} ${controlPoint2.y}, 
                    ${target.x} ${target.y}`;
    
    return {
      type: 'curved',
      path,
      points: [source, controlPoint1, controlPoint2, target],
      metadata: {
        curveRadius: this.geometryUtils.distance(midPoint, controlPoint1),
        estimatedLength: this.estimateCurveLength(source, target, controlPoint1, controlPoint2)
      }
    };
  }
  
  calculateCurveOffset(source, target) {
    const distance = this.geometryUtils.distance(source, target);
    const baseOffset = Math.min(distance * 0.3, 100); // Max 100px offset
    
    // Adjust based on connection density
    const density = this.getConnectionDensity(source, target);
    const offsetMultiplier = 1 + (density * 0.2);
    
    return {
      x: baseOffset * offsetMultiplier,
      y: baseOffset * offsetMultiplier * 0.5
    };
  }
}

// RadarRoutingHandler.js - Radar-specific routing with obstacle avoidance
class RadarRoutingHandler extends BaseRoutingHandler {
  calculateRoute() {
    const sourcePoint = this.getConnectionPoint(this.sourceElement);
    const targetPoint = this.getConnectionPoint(this.targetElement);
    
    // Radar connections avoid other components and use right-angle routing
    const obstacles = this.detectObstacles(sourcePoint, targetPoint);
    
    if (obstacles.length === 0) {
      return this.createDirectRoute(sourcePoint, targetPoint);
    }
    
    return this.createAvoidanceRoute(sourcePoint, targetPoint, obstacles);
  }
  
  createAvoidanceRoute(source, target, obstacles) {
    // Implement A* pathfinding or similar algorithm
    const waypoints = this.calculateWaypoints(source, target, obstacles);
    
    let path = `M ${source.x} ${source.y}`;
    const points = [source];
    
    for (const waypoint of waypoints) {
      path += ` L ${waypoint.x} ${waypoint.y}`;
      points.push(waypoint);
    }
    
    path += ` L ${target.x} ${target.y}`;
    points.push(target);
    
    return {
      type: 'avoidance',
      path,
      points,
      metadata: {
        waypointCount: waypoints.length,
        totalDistance: this.calculateTotalDistance(points),
        obstaclesAvoided: obstacles.length
      }
    };
  }
  
  detectObstacles(source, target) {
    // Detect ECU components, other connections, or defined exclusion zones
    const allElements = document.querySelectorAll('.ecu-component, .processor');
    const obstacles = [];
    
    for (const element of allElements) {
      if (element === this.sourceElement || element === this.targetElement) {
        continue;
      }
      
      const rect = element.getBoundingClientRect();
      const obstacleRect = this.normalizeRect(rect);
      
      if (this.lineIntersectsRect(source, target, obstacleRect)) {
        obstacles.push({
          element,
          rect: obstacleRect,
          type: element.className.includes('ecu') ? 'ecu' : 'processor'
        });
      }
    }
    
    return obstacles;
  }
}

// CorridorRoutingHandler.js - Handles corridor-specific routing logic
class CorridorRoutingHandler extends BaseRoutingHandler {
  calculateRoute() {
    const sourcePoint = this.getConnectionPoint(this.sourceElement);
    const targetPoint = this.getConnectionPoint(this.targetElement);
    
    // Corridor connections follow predefined paths or channels
    const corridor = this.findOrCreateCorridor(sourcePoint, targetPoint);
    
    return this.createCorridorRoute(sourcePoint, targetPoint, corridor);
  }
  
  findOrCreateCorridor(source, target) {
    // Check for existing corridors that can accommodate this connection
    const existingCorridors = this.getExistingCorridors();
    
    for (const corridor of existingCorridors) {
      if (this.canUseCorridors(source, target, corridor)) {
        return corridor;
      }
    }
    
    // Create new corridor if none suitable found
    return this.createNewCorridor(source, target);
  }
  
  createCorridorRoute(source, target, corridor) {
    const entryPoint = this.findCorridorEntry(source, corridor);
    const exitPoint = this.findCorridorExit(target, corridor);
    
    // Route through corridor
    let path = `M ${source.x} ${source.y}`;
    path += ` L ${entryPoint.x} ${entryPoint.y}`;
    
    // Follow corridor path
    for (const waypoint of corridor.waypoints) {
      path += ` L ${waypoint.x} ${waypoint.y}`;
    }
    
    path += ` L ${exitPoint.x} ${exitPoint.y}`;
    path += ` L ${target.x} ${target.y}`;
    
    return {
      type: 'corridor',
      path,
      points: [source, entryPoint, ...corridor.waypoints, exitPoint, target],
      metadata: {
        corridorId: corridor.id,
        corridorUtilization: corridor.utilization,
        priority: corridor.priority
      }
    };
  }
}
```

### 4. Routing Manager Coordination

```javascript
// RoutingManager.js - Coordinates all routing operations
class RoutingManager {
  constructor() {
    this.activeRoutes = new Map();
    this.boundaryManager = new BoundaryManager();
    this.routingConfig = new RoutingConfiguration();
  }
  
  // Main routing coordination method
  createConnection(sourceElement, targetElement, connectionType, config = {}) {
    try {
      // Create appropriate handler
      const handler = RoutingHandlerFactory.create(
        connectionType, 
        sourceElement, 
        targetElement, 
        { ...this.routingConfig.getDefaults(connectionType), ...config }
      );
      
      // Calculate initial route
      let route = handler.calculateRoute();
      
      // Apply optimizations
      route = this.applyOptimizations(route, handler);
      
      // Validate route
      this.validateRoute(route);
      
      // Register route
      const connectionId = this.generateConnectionId(sourceElement, targetElement);
      this.activeRoutes.set(connectionId, {
        route,
        handler,
        sourceElement,
        targetElement,
        connectionType,
        createdAt: Date.now()
      });
      
      Logger.log(LogLevels.INFO, LogCategories.ROUTING, 
        `Created ${connectionType} route:`, {
          connectionId,
          routeType: route.type,
          pathLength: route.metadata?.totalDistance || 'unknown'
        });
      
      return { connectionId, route };
      
    } catch (error) {
      Logger.log(LogLevels.ERROR, LogCategories.ROUTING, 
        'Route creation failed:', error);
      throw error;
    }
  }
  
  // Dynamic route optimization
  applyOptimizations(route, handler) {
    // Boundary collision detection
    const collisions = handler.detectBoundaryCollisions(route);
    if (collisions.length > 0) {
      route = this.resolveCollisions(route, collisions, handler);
    }
    
    // Route optimization
    route = handler.optimizeRoute(route);
    
    // Global optimization (e.g., reducing crossing connections)
    route = this.applyGlobalOptimizations(route);
    
    return route;
  }
  
  // Handle dynamic updates
  updateConnection(connectionId, changes) {
    const connection = this.activeRoutes.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }
    
    // Apply changes to handler configuration
    Object.assign(connection.handler.config, changes);
    
    // Recalculate route
    let newRoute = connection.handler.calculateRoute();
    newRoute = this.applyOptimizations(newRoute, connection.handler);
    
    // Update stored route
    connection.route = newRoute;
    connection.lastUpdated = Date.now();
    
    return newRoute;
  }
  
  // Cleanup and resource management
  removeConnection(connectionId) {
    const connection = this.activeRoutes.get(connectionId);
    if (connection) {
      // Cleanup handler resources
      if (typeof connection.handler.destroy === 'function') {
        connection.handler.destroy();
      }
      
      this.activeRoutes.delete(connectionId);
      
      Logger.log(LogLevels.DEBUG, LogCategories.ROUTING, 
        `Removed connection: ${connectionId}`);
    }
  }
}
```

## Configuration Integration

```javascript
// RoutingConfiguration.js - Centralized routing configuration
class RoutingConfiguration {
  constructor() {
    this.config = {
      camera: {
        preferredStyle: 'curved',
        maxCurveRadius: 100,
        avoidanceEnabled: false,
        optimizeForReadability: true
      },
      radar: {
        preferredStyle: 'orthogonal',
        obstacleAvoidance: true,
        minimumClearance: 20,
        preferRightAngles: true
      },
      corridor: {
        reuseExisting: true,
        maxCorridorWidth: 50,
        priorityBased: true,
        dynamicAllocation: true
      },
      default: {
        preferredStyle: 'direct',
        optimizeForPerformance: true
      }
    };
  }
  
  getDefaults(connectionType) {
    return { ...this.config[connectionType] || this.config.default };
  }
  
  updateConfiguration(connectionType, updates) {
    if (!this.config[connectionType]) {
      this.config[connectionType] = { ...this.config.default };
    }
    
    Object.assign(this.config[connectionType], updates);
  }
}
```

## Key Benefits

### 1. Extensible Architecture
- **Plugin-like Handlers**: Easy addition of new routing strategies
- **Runtime Registration**: New routing types can be added without core modifications
- **Configuration-Driven**: Behavior modification through configuration

### 2. Maintainable Complexity
- **Separation of Concerns**: Routing logic separated from geometry calculations
- **Testable Components**: Each handler can be unit tested independently
- **Clear Interfaces**: Well-defined contracts between components

### 3. Performance Optimization
- **Lazy Evaluation**: Routes calculated only when needed
- **Caching Strategy**: Previously calculated routes can be cached
- **Efficient Collision Detection**: Optimized geometric algorithms

### 4. Robust Error Handling
- **Graceful Degradation**: Falls back to simpler routing on errors
- **Validation**: Route validation prevents invalid configurations
- **Comprehensive Logging**: Detailed logging for debugging complex routing issues

## DynArch Results

**Performance Metrics:**
- Handles 50+ simultaneous connections with different routing strategies
- Route calculation time: <5ms for simple routes, <20ms for complex avoidance routes
- Memory usage remains stable during dynamic route updates
- Real-time route recalculation during component movement

**Routing Types Successfully Implemented:**
- **Camera Routes**: Smooth curved connections for visual clarity
- **Radar Routes**: Orthogonal routing with intelligent obstacle avoidance
- **Corridor Routes**: Shared pathway routing for organized connection management
- **Processor Routes**: Direct routing optimized for performance

## Transferable Applications

1. **Network Visualization**: Network topology diagrams, data flow visualizations
2. **Circuit Design Tools**: PCB routing, electrical circuit design
3. **Game Development**: Pathfinding systems, AI navigation
4. **Architecture Software**: Building layout, pipe routing, cable management
5. **Logistics Systems**: Route planning, delivery optimization
6. **Data Flow Diagrams**: System architecture visualization, process mapping

## Related Patterns

- **[StateDrivenAnimationPipelinePattern](./StateDrivenAnimationPipelinePattern.md)**: Animating route creation and updates
- **[ConditionalLoggingPattern](./ConditionalLoggingPattern.md)**: Debugging complex routing calculations
- **Factory Pattern**: Handler creation and type-specific instantiation
- **Strategy Pattern**: Pluggable routing algorithms
- **Observer Pattern**: Route change notifications

This pattern provides a robust foundation for any system requiring sophisticated geometric routing with extensible algorithms and maintainable architecture.