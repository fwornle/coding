# EntityCreation

**Type:** Detail

The custom EntityFactory class allows for flexibility in entity creation, enabling the addition of new entity types or modification of existing ones without affecting the controller logic.

## What It Is

- The EntityFactory class in entity_factory.py creates new knowledge entities based on user input, following a specific creation pattern.

- ManualLearningController uses the EntityFactory class to instantiate new entities, providing a clear separation of concerns between entity creation and controller logic.

- The custom EntityFactory class allows for flexibility in entity creation, enabling the addition of new entity types or modification of existing ones without affecting the controller logic.


## Related Entities

### Used By

- ManualLearning (contains)



## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- ManualLearningController uses a custom EntityFactory class in entity_factory.py to create new knowledge entities from manual user input

### Siblings
- [EntityEditing](./EntityEditing.md) -- The ManualLearningController likely interacts with the EntityFactory class to update existing entities, ensuring consistency in entity creation and editing processes.


---

*Generated from 3 observations*
