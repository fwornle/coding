# CommitHashRegistry

**Type:** Detail

CommitHashRegistry persists processed commit hashes to a checkpoint file (e.g., `checkpoint_manager.py`) so the `OnlineLearning` pipeline's incremental processing logic can call a function like `is_commit_processed(commit_hash)` to skip already-seen git history on subsequent runs.

## What It Is

CommitHashRegistry is a persistence mechanism within CheckpointManager (`src/utils/checkpoint-manager.ts`) that stores processed commit hashes, enabling the OnlineLearning pipeline to skip already-seen git history on subsequent runs.

## Architecture and Design

The registry implements an **idempotent checkpoint pattern** — by maintaining a set of processed commit hashes, pipeline runs become safe to restart or re-run without duplicating knowledge graph updates. This is a gate mechanism: before processing a commit, the pipeline <USER_ID_REDACTED> something like `is_commit_processed(commit_hash)` and skips if already recorded.

## Implementation Details

The registry persists commit hashes to a checkpoint file. The core operation is a lookup-before-process pattern: check registry, process if new, then record the hash. This lives within CheckpointManager at `src/utils/checkpoint-manager.ts`.

## Integration Points

Consumed by the OnlineLearning pipeline's incremental processing logic. CheckpointManager is the parent container that manages this registry alongside any other checkpoint state.

## Usage Guidelines

The registry makes pipelines restartable by default. Developers should ensure commit hashes are recorded only after successful processing to avoid skipping failed commits on retry.


## Hierarchy Context

### Parent
- [CheckpointManager](./CheckpointManager.md) -- CheckpointManager at src/utils/checkpoint-manager.ts stores commit hashes as markers so the OnlineLearning pipeline can skip already-processed git history on subsequent runs


---

*Generated from 3 observations*
