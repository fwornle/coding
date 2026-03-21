# WorkStealingScheduler

**Type:** Detail

## Observations

- The integrations/copi/docs/hooks.md file mentions the implementation of work-stealing via shared nextIndex counter, indicating a specific architectural decision for concurrency management.
- The WaveController.runWithConcurrency function is likely responsible for managing worker tasks and implementing the work-stealing pattern, although the exact implementation details are not available in the provided source files.
- The use of a shared nextIndex counter suggests a design decision to prioritize efficiency and responsiveness in the concurrency pattern, allowing idle workers to quickly retrieve new tasks.
