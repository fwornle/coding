# LowerOntologyResolver

**Type:** Detail

The LowerOntologyResolver plays a crucial role in the entity resolution process, as it enables the OntologyClassifier to accurately categorize and resolve entities within the ontology.

## What It Is

- The LowerOntologyResolver utilizes the upper ontology classes defined by the UpperOntologyClassifier to establish more specific and detailed relationships between entities.

- The LowerOntologyResolver is designed to be flexible and adaptable, allowing for the addition of new lower ontology classes and relationships as needed.

## How It Works

- The LowerOntologyResolver plays a crucial role in the entity resolution process, as it enables the OntologyClassifier to accurately categorize and resolve entities within the ontology.

## Related Entities

### Used By

- Ontology (contains)

## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- OntologyClassifier uses a hierarchical classification model with upper and lower ontology definitions in ontology-definition.yaml

### Siblings
- [UpperOntologyClassifier](./UpperOntologyClassifier.md) -- The UpperOntologyClassifier relies on the definitions in ontology-definition.yaml to determine the upper ontology classes and their relationships.
- [EntityTypeResolver](./EntityTypeResolver.md) -- The EntityTypeResolver relies on the definitions in ontology-definition.yaml to determine the entity types and their relationships.

---

*Generated from 3 observations*
