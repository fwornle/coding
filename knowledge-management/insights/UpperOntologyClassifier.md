# UpperOntologyClassifier

**Type:** Detail

The hierarchical classification model implemented in the UpperOntologyClassifier enables the OntologyClassifier to efficiently categorize and resolve entities within the ontology.

## What It Is

- The UpperOntologyClassifier relies on the definitions in ontology-definition.yaml to determine the upper ontology classes and their relationships.

- The hierarchical classification model implemented in the UpperOntologyClassifier enables the OntologyClassifier to efficiently categorize and resolve entities within the ontology.

- The UpperOntologyClassifier is a key component of the OntologyClassifier, as it provides the foundational structure for the lower ontology classes and entity resolution.

## Related Entities

### Used By

- Ontology (contains)

## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- OntologyClassifier uses a hierarchical classification model with upper and lower ontology definitions in ontology-definition.yaml

### Siblings
- [LowerOntologyResolver](./LowerOntologyResolver.md) -- The LowerOntologyResolver utilizes the upper ontology classes defined by the UpperOntologyClassifier to establish more specific and detailed relationships between entities.
- [EntityTypeResolver](./EntityTypeResolver.md) -- The EntityTypeResolver relies on the definitions in ontology-definition.yaml to determine the entity types and their relationships.

---

*Generated from 3 observations*
