# Redux MVI Pattern Generalization

*Extracted from Timeline Visualization Project - January 2025*

## Table of Contents

- [Overview](#overview)
- [Core Architecture: MVI with Redux Toolkit](#core-architecture-mvi-with-redux-toolkit)
- [Key Patterns](#key-patterns)
  - [Intent-Driven State Management](#1-intent-driven-state-management)
  - [Automatic State Persistence Pattern](#2-automatic-state-persistence-pattern)
  - [Typed Redux Hooks](#3-typed-redux-hooks)
  - [Non-Serializable Object Handling](#4-non-serializable-object-handling)
  - [State Coordination Pattern](#5-state-coordination-pattern)
  - [Intelligent Caching Pattern](#6-intelligent-caching-pattern)
  - [Migration Pattern for Evolving State](#7-migration-pattern-for-evolving-state)
  - [Debug-Friendly Middleware](#8-debug-friendly-middleware)
- [Best Practices](#best-practices)
  - [State Structure](#1-state-structure)
  - [Intent Design](#2-intent-design)
  - [Persistence Strategy](#3-persistence-strategy)
  - [Performance Optimization](#4-performance-optimization)
  - [Error Handling](#5-error-handling)
  - [Testing Strategy](#6-testing-strategy)
- [Implementation Checklist](#implementation-checklist)
- [Advantages of This Pattern](#advantages-of-this-pattern)
- [When to Use This Pattern](#when-to-use-this-pattern)
- [Conclusion](#conclusion)

## Overview

This document captures a generalized Redux implementation pattern that combines Model-View-Intent (MVI) architecture with Redux Toolkit, automatic state persistence, and advanced state coordination patterns. This approach has proven effective for complex applications requiring real-time 3D visualization, state persistence, and sophisticated user interactions.

## Core Architecture: MVI with Redux Toolkit

The pattern implements a clean separation of concerns using the MVI paradigm:

![Redux MVI Architecture](images/redux-mvi-architecture.png)

## Key Patterns

### 1. Intent-Driven State Management

Intents serve as the primary interface for all complex operations:

```typescript
// Intent coordinates multiple state updates + side effects
export const performComplexOperation = createAsyncThunk(
  'domain/performOperation',
  async (params, { dispatch, getState }) => {
    // 1. Validate current state
    const state = getState();
    if (!canPerformOperation(state)) {
      throw new Error('Invalid state for operation');
    }
    
    // 2. Perform async operations
    const result = await apiCall(params);
    
    // 3. Update multiple slices
    dispatch(updateDomainState(result));
    dispatch(updateUIState({ loading: false }));
    
    // 4. Trigger persistence
    dispatch(persistStateToStorage());
    
    // 5. Handle side effects
    dispatch(notifyUser({ message: 'Operation complete' }));
    
    return result;
  }
);
```

### 2. Automatic State Persistence Pattern

Build persistence directly into slice reducers for seamless state preservation:

```typescript
const createPersistentSlice = (name: string, initialState: any) => {
  return createSlice({
    name,
    initialState: loadFromStorage(name) || initialState,
    reducers: {
      updateState: (state, action) => {
        Object.assign(state, action.payload);
        // Automatic persistence on every update
        saveToStorage(name, state);
      },
    },
  });
};
```

### 3. Typed Redux Hooks

Export typed hooks for better TypeScript integration:

```typescript
// store/index.ts
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
```

### 4. Non-Serializable Object Handling

Pattern for integrating with libraries that use non-serializable objects:

```typescript
// Store plain objects in Redux
interface Position {
  x: number;
  y: number;
  z: number;
}

// Convert to library objects in components/intents
const vector3 = new THREE.Vector3(position.x, position.y, position.z);

// Configure store to ignore serialization checks for performance
const store = configureStore({
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['ui/updatePosition'],
        ignoredPaths: ['ui.tempVector'], // For temporary non-serializable data
      },
    }),
});
```

### 5. State Coordination Pattern

Complex UI states require coordination across multiple slices:

```typescript
// Intent that coordinates multiple state aspects
export const focusOnElement = createAsyncThunk(
  'ui/focusOnElement',
  async (elementId: string, { dispatch, getState }) => {
    const element = selectElementById(getState(), elementId);
    
    if (!element) {
      throw new Error(`Element ${elementId} not found`);
    }
    
    // Coordinate camera movement
    dispatch(animateCameraTo({
      target: element.position,
      duration: 1000,
    }));
    
    // Update UI state
    dispatch(setSelectedElement(elementId));
    dispatch(setUIMode('focused'));
    
    // Update visual states
    dispatch(fadeOtherElements(elementId));
    
    // Persist focus state
    dispatch(saveUserPreference({ lastFocused: elementId }));
  }
);
```

### 6. Intelligent Caching Pattern

Build caching directly into Redux slices:

```typescript
interface CachedData<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const dataSlice = createSlice({
  name: 'data',
  initialState: {
    cache: {} as Record<string, CachedData<any>>,
  },
  reducers: {
    setCachedData: (state, action) => {
      const { key, data, ttl = 3600000 } = action.payload;
      state.cache[key] = {
        data,
        timestamp: Date.now(),
        ttl,
      };
    },
  },
});

// Selector with cache validation
export const selectCachedData = (key: string) => (state: RootState) => {
  const cached = state.data.cache[key];
  if (!cached) return null;
  
  const isExpired = Date.now() - cached.timestamp > cached.ttl;
  return isExpired ? null : cached.data;
};
```

### 7. Migration Pattern for Evolving State

Handle state structure changes gracefully:

```typescript
const CURRENT_VERSION = 3;

function migrateState(state: any): any {
  if (!state.version || state.version < 2) {
    // Migrate from v1 to v2
    state = {
      ...state,
      newField: 'default',
      version: 2,
    };
  }
  
  if (state.version < 3) {
    // Migrate from v2 to v3
    state = {
      ...state,
      renamedField: state.oldField,
      version: 3,
    };
    delete state.oldField;
  }
  
  return state;
}

const loadInitialState = () => {
  const saved = loadFromStorage('appState');
  return saved ? migrateState(saved) : defaultInitialState;
};
```

### 8. Debug-Friendly Middleware

Custom middleware for debugging complex flows:

```typescript
const createDebugMiddleware = (options: DebugOptions): Middleware => {
  return store => next => action => {
    if (options.logActions && action.type.includes(options.filter)) {
      console.group(`🎯 ${action.type}`);
      console.log('Previous State:', store.getState());
      console.log('Action:', action);
      
      const result = next(action);
      
      console.log('Next State:', store.getState());
      console.groupEnd();
      
      return result;
    }
    
    return next(action);
  };
};
```

## Best Practices

### 1. **State Structure**

- Keep state normalized and flat
- Avoid deeply nested objects
- Use IDs for relationships between entities

### 2. **Intent Design**

- One intent per user interaction
- Handle all side effects in intents
- Return meaningful results for UI feedback

### 3. **Persistence Strategy**

- Persist only essential state
- Use versioning for state migrations
- Implement graceful fallbacks

### 4. **Performance Optimization**

- Use React.memo with selector results
- Implement request deduplication in intents
- Cache expensive computations

### 5. **Error Handling**

- Centralize error handling in intents
- Provide user-friendly error messages
- Implement retry logic for network operations

### 6. **Testing Strategy**

- Test intents as integration tests
- Test reducers as unit tests
- Mock storage and API calls

## Implementation Checklist

When implementing this pattern in a new project:

- [ ] Set up Redux Toolkit with TypeScript
- [ ] Create typed hooks (useAppDispatch, useAppSelector)
- [ ] Implement storage service with encoding/decoding
- [ ] Create base intent patterns for common operations
- [ ] Set up automatic persistence for critical slices
- [ ] Configure middleware for debugging
- [ ] Implement state migration system
- [ ] Create cache management utilities
- [ ] Set up error boundaries for Redux errors
- [ ] Document intent naming conventions

## Advantages of This Pattern

1. **Predictable State Management**: All state changes go through well-defined intents
2. **Automatic Persistence**: Users never lose their work
3. **Type Safety**: Full TypeScript support throughout
4. **Debugging**: Clear action flow with optional middleware
5. **Scalability**: Easy to add new features without affecting existing code
6. **Performance**: Optimized for complex UI interactions
7. **Testability**: Clear separation makes testing straightforward

## When to Use This Pattern

This pattern is ideal for:

- Complex applications with multiple interconnected features
- Apps requiring state persistence across sessions
- Projects with real-time visualization requirements
- Applications with sophisticated user interactions
- Teams prioritizing maintainability and scalability

## Conclusion

This Redux MVI pattern provides a robust foundation for building complex, stateful applications. By combining Redux Toolkit's modern approach with MVI architecture and automatic persistence, it creates a development experience that is both powerful and developer-friendly. The pattern has been battle-tested in production with complex 3D visualization requirements and has proven to scale well with application growth.
