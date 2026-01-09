# Specifications for codex-mem

This document defines the project-level expectations for behavior, reliability, and development workflow.
Agents must follow these requirements when implementing changes.

## Core behavior

- Keep the memory store append-only using JSONL. Do not rewrite existing lines except during explicit compaction.
- Preserve deterministic behavior: same inputs produce the same outputs (ordering, scoring, and metadata).
- Do not silently drop data; surface errors and continue with best-effort reads where safe.
- Ensure updates are idempotent; repeated operations should not corrupt state.

## Concurrency and integrity

- All writes to the memory JSONL and index JSON must be serialized (file locks or equivalent).
- Use atomic writes for index updates (write temp, replace, fallback to backup on failure).
- Never leave partial writes behind; prefer fail-fast with a clear error.

## Data model and compatibility

- Do not change the JSONL schema without a migration plan and version bump.
- Maintain backward compatibility for existing memory files and indexes.
- New fields must be optional and safe to ignore by older builds.

## Retrieval quality

- Prioritize correctness over speed; do not change scoring semantics without tests.
- Any scoring or ranking change must include a regression test that covers the expected order.

## Error handling and observability

- Favor actionable errors with context (file path, operation, item id when available).
- Avoid noisy logging; use structured errors over console spam.

## Testing and validation

- If code changes, run `npm run build` and `npm test`.
- Add tests for any new behavior or bug fix when feasible.
- Do not leave new tests unrun.

## Workflow

- Use beads (`bd`) for all issue tracking and keep `.beads/issues.jsonl` committed with code changes.
- Keep the repo root clean; put ephemeral planning files in `history/`.
