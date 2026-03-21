# CreationalPatternManager

**Type:** Detail

The creational patterns are used in conjunction with the config.json file to provide a flexible and maintainable way to manage different implementations, as implied by the parent context hierarchy.

## What It Is

- The creational patterns are used in conjunction with the config.json file to provide a flexible and maintainable way to manage different implementations, as implied by the parent context hierarchy.

- The FactoryMethodPattern uses a config.json file to determine which factory to instantiate, allowing for easy switching between different implementations, as seen in the parent context hierarchy.

- The Singleton pattern is used to ensure that only one instance of a class is created, which can be seen in the way the DesignPatterns sub-component is structured to have a single point of access.

## Related Entities

### Used By

- DesignPatterns (contains)

## Hierarchy Context

### Parent
- [DesignPatterns](./DesignPatterns.md) -- FactoryMethodPattern uses a config.json file to determine which factory to instantiate, allowing for easy switching between different implementations

### Siblings
- [StructuralPatternComposite](./StructuralPatternComposite.md) -- The Adapter pattern is used to allow objects with different interfaces to work together, which can be seen in the way the DesignPatterns sub-component is designed to be adaptable to different use cases.
- [BehavioralPatternObserver](./BehavioralPatternObserver.md) -- The Observer pattern is used to allow objects to be notified of changes to other objects, which can be seen in the way the DesignPatterns sub-component is designed to have a notification system.

---

*Generated from 3 observations*
