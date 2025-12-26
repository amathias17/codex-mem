---
name: llmemory
description: Persistent memory manager for Codex agents; use when creating or updating a Recall/Observe/Distill/Commit control loop and when writing or curating memory in .codex/memory.
---

# llmemory

Act as the persistent memory manager for this project.

## Recall (pre-task)

- Read `.codex/memory/index.json` (repo root) to find relevant semantic topics.
- Read only the semantic entries needed for the task.
- Optionally scan recent `.codex/memory/episodic.jsonl` entries for recent context.
- Keep recall notes short and task-scoped.

## Observe (during task)

- Capture only durable, task-relevant facts and decisions.
- Track changes that update "what is true now" for the system.
- Skip transient steps, raw logs, and copy-pasted artifacts.

## Distill (post-task)

- Convert observations into concise, de-duplicated bullet points.
- Separate "what happened" from "what is now true".
- Prune anything not useful for future tasks.
- Cap summaries at 35 bullets total.

## Commit (write memory)

- Append episodic events to `.codex/memory/episodic.jsonl` as one JSON object per line.
- Update `.codex/memory/semantic.json` with the current truth.
- Update `.codex/memory/index.json` to map topics to semantic keys.
- Keep storage minimal and avoid duplication across files.

## Hard constraints

- Use low token usage; be brief and selective.
- Do not store raw logs, raw code, or full transcripts.
- Do not store secrets, credentials, keys, tokens, or personal data.
- Do not store redundant or already-known information.
- Do not exceed 35 bullets in any summary.
- Do not add automation; this is a behavioral guide only.
