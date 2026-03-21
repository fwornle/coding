# WorkflowValidationHandler

**Type:** Detail

The WorkflowValidationHandler is responsible for checking workflows against the WorkflowDataModel, ensuring that all workflows conform to the defined structure and constraints.

## How It Works

- The WorkflowValidationHandler is responsible for checking workflows against the WorkflowDataModel, ensuring that all workflows conform to the defined structure and constraints.

- The WorkflowValidationHandler is called by the GsdWorkflowManager whenever a workflow is created, updated, or deleted, to validate the workflow data.

- The WorkflowValidationHandler reports any validation errors or inconsistencies to the GsdWorkflowManager, which can then take corrective action to resolve the issues.

## Related Entities

### Used By

- GsdWorkflowManager (contains)

## Hierarchy Context

### Parent
- [GsdWorkflowManager](./GsdWorkflowManager.md) -- GsdWorkflowManager uses a workflow data model, as defined in the Workflow.js file, to provide a standardized representation of GSD workflows.

### Siblings
- [WorkflowDataModel](./WorkflowDataModel.md) -- The WorkflowDataModel is defined in the Workflow.js file, which specifies the structure and constraints of the workflow data.

---

*Generated from 3 observations*
