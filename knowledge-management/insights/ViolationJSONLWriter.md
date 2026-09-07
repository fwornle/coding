# ViolationJSONLWriter

**Type:** Detail

ViolationJSONLWriter in violation-capture-service.js appends each violation event as a single JSON-stringified line to the log file using a file append operation (e.g., fs.appendFile/appendFileSync), avoiding the need to read and rewrite the entire violations log on every capture.

# ViolationJSONLWriter — Technical Insight Document

## What It Is

ViolationJSONLWriter is implemented within `violation-capture-service.js`, functioning as a focused sub-component of the broader ViolationCaptureService. Its defining responsibility is to persist individual violation events to a log file using the JSON Lines (JSONL) format — where each violation event is serialized independently as a single JSON-stringified line and appended to the log file. Rather than treating the violations log as a monolithic document to be rewritten, ViolationJSONLWriter treats it as an ever-growing sequence of discrete, append-only records.

## Architecture and Design

The core architectural pattern here is **append-only logging**, a design choice explicitly identified as the defining behavior of its parent, ViolationCaptureService. Instead of reading the entire violations log into memory, modifying it, and rewriting it to disk on every new violation event, ViolationJSONLWriter performs a targeted file append operation (e.g., `fs.appendFile`/`fs.appendFileSync`). This avoids the read-modify-write cycle entirely.

This design reflects a trade-off favoring write efficiency and reduced I/O overhead over query flexibility. By forgoing a structure that supports in-place updates or random access modification, the system gains constant-time write complexity per event, regardless of how large the existing log has grown. The JSONL format itself is a natural complement to this pattern: since each line is independently parseable JSON, there is no need to manage array brackets, commas, or other structural elements that would require awareness of the file's existing contents — a requirement that would otherwise force a full rewrite.

## Implementation Details

The mechanics center on a simple but deliberate sequence: each violation event is JSON-stringified into a single line, and that line is appended to the log file via a file append operation. The lack of read-back or file-locking logic (as described in the observations) implies that the writer treats each append as an atomic, independent operation rather than part of a larger transactional unit. This keeps the implementation lightweight, with the append operation being the sole point of interaction with the filesystem for each captured violation.

Because the component is described only at a high level (no distinct class/function symbols were enumerated in the code structure), it should be understood as a behavioral role within `violation-capture-service.js` rather than a separately instantiated, heavily parameterized module — its logic is likely encapsulated in a narrowly scoped function or method rather than spread across multiple files.

## Integration Points

ViolationJSONLWriter is directly contained within ViolationCaptureService, and this containment relationship is the primary integration point: the parent orchestrates violation event capture, while ViolationJSONLWriter serves as the persistence layer that turns captured events into durable JSONL log entries. Any component responsible for detecting or generating violation events upstream would presumably hand off structured event data to this writer for durable storage, though the specifics of that hand-off are not detailed beyond the parent-child relationship.

## Usage Guidelines

Developers extending or maintaining this component should preserve the append-only invariant — introducing any logic that reads and rewrites the full log file would undermine the core efficiency rationale for this design. Each violation event should be serializable to a single JSON line without embedded newlines, since JSONL format depends on one JSON object per line for correct downstream parsing. Consumers of the resulting log file should expect to parse it line-by-line rather than as a single JSON document (e.g., not as a JSON array), and should be aware that consecutive lines are independent, unordered-by-structure JSON records reflecting individual violation captures over time.


## Hierarchy Context

### Parent
- [ViolationCaptureService](./ViolationCaptureService.md) -- violation-capture-service.js persists individual violation events as JSONL log lines, appending rather than rewriting the whole log per capture


---

*Generated from 3 observations*
