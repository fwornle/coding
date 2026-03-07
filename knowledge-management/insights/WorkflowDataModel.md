# WorkflowDataModel

**Type:** Detail

The WorkflowDataModel is used by the GsdWorkflowManager to create, read, update, and delete workflows, ensuring data consistency and integrity.

## How It Works

- The WorkflowDataModel is defined in the Workflow.js file, which specifies the structure and constraints of the workflow data.

- The WorkflowDataModel is used by the GsdWorkflowManager to create, read, update, and delete workflows, ensuring data consistency and integrity.

- The Workflow.js file exports the WorkflowDataModel class, which is instantiated by the GsdWorkflowManager to manage workflows.


## Related Entities

### Used By

- GsdWorkflowManager (contains)



## Hierarchy Context

### Parent
- [GsdWorkflowManager](./GsdWorkflowManager.md) -- GsdWorkflowManager uses a workflow data model, as defined in the Workflow.js file, to provide a standardized representation of GSD workflows.

### Siblings
- [WorkflowValidationHandler](./WorkflowValidationHandler.md) -- The WorkflowValidationHandler is responsible for checking workflows against the WorkflowDataModel, ensuring that all workflows conform to the defined structure and constraints.


---

*Generated from 3 observations*
