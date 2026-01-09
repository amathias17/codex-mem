# codex-mem

codex-mem is a minimal MCP server that provides persistent, scoped memory for Codex. It stores append-only JSONL records, maintains a lightweight index, summarizes older memories, retrieves by deterministic scoring, and prunes with aging and dedupe.

## Install

```bash
npm install
```

This server uses only Node.js built-ins. Compile TypeScript with your existing toolchain.

## Run

```bash
node dist/server.js
```

Sanity check (verifies write, index, and search):

```bash
node dist/server.js --sanity
```

## Configuration

`codex-mem.config.json` controls storage paths and policies:

```json
{
  "memoryFile": "data/memory.jsonl",
  "indexFile": "data/index.json",
  "summarization": {
    "maxContentLength": 600,
    "olderThanDays": 30
  },
  "prune": {
    "maxPerScope": 200,
    "deleteOlderThanDays": 365,
    "compressOlderThanDays": 60,
    "dedupe": true
  },
  "scoring": {
    "scope": 2.0,
    "tag": 1.5,
    "recency": 1.0,
    "importance": 1.2,
    "text": 1.4,
    "halfLifeDays": 30
  },
  "retrieval": {
    "defaultLimit": 20
  },
  "maintenance": {
    "maxLineRatio": 2,
    "minLines": 200,
    "maxBytes": 5000000
  }
}
```

## MCP Tools

### memory.add
Adds a memory item.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "scope": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" } },
    "content": { "type": "string" },
    "metadata": { "type": "object" },
    "importance": { "type": "number" }
  },
  "required": ["scope", "content"]
}
```

### memory.search
Searches memory by scope, tags, and query text.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "scope": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" } },
    "query": { "type": "string" },
    "limit": { "type": "number" },
    "includeDeleted": { "type": "boolean" }
  }
}
```

### memory.get
Fetches a memory item by id.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" }
  },
  "required": ["id"]
}
```

### memory.update
Patches a memory item.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "patch": { "type": "object" }
  },
  "required": ["id", "patch"]
}
```

### memory.delete
Soft-deletes a memory item.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" }
  },
  "required": ["id"]
}
```

### memory.prune
Runs dedupe, summarization, and aging policies.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "scope": { "type": "string" },
    "dryRun": { "type": "boolean" }
  }
}
```

### memory.rebuildIndex
Rebuilds the JSON index from the memory store.

Input schema:
```json
{
  "type": "object",
  "properties": {}
}
```

### memory.health
Reports memory file health and compaction recommendations.

Input schema:
```json
{
  "type": "object",
  "properties": {}
}
```

### memory.repair
Repairs corrupted JSONL by quarantining invalid lines and optionally compacting.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "compact": { "type": "boolean" },
    "quarantine": { "type": "boolean" }
  }
}
```

## Data format

`data/memory.jsonl` is append-only. Each line is a full `MemoryItem` JSON record. Updates append a new record for the same id. `data/index.json` is a lightweight index keyed by scope and tag.

MemoryItem shape:

```json
{
  "id": "uuid",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "scope": "project",
  "tags": ["tag"],
  "content": "raw content",
  "summary": null,
  "metadata": null,
  "importance": 0.5,
  "deleted": false
}
```

## Examples

Add memory:

```json
{
  "name": "memory.add",
  "arguments": {
    "scope": "codex-mem",
    "tags": ["mcp", "memory"],
    "content": "We store memory in JSONL and index by scope/tag.",
    "importance": 0.7
  }
}
```

Search:

```json
{
  "name": "memory.search",
  "arguments": {
    "scope": "codex-mem",
    "query": "JSONL index",
    "tags": ["memory"]
  }
}
```
