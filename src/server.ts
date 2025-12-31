import { promises as fs } from "fs";
import path from "path";
import {
  CodexMemConfig,
  MemoryPatch,
  normalizeTags,
  normalizeScope,
} from "./schema";
import {
  addMemoryItem,
  getMemoryItem,
  listMemoryItems,
  updateMemoryItem,
} from "./memory-store";
import { rebuildIndex, updateIndexFromItems } from "./indexer";
import { searchMemory } from "./retriever";
import { pruneMemory } from "./prune";

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

const CONFIG_PATH = path.resolve(process.cwd(), "codex-mem.config.json");

async function loadConfig(): Promise<CodexMemConfig> {
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  return JSON.parse(raw) as CodexMemConfig;
}

function jsonResponse(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonError(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function send(payload: unknown) {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
  process.stdout.write(header + body);
}

function readMessages(onMessage: (msg: JsonRpcRequest) => void) {
  let buffer = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    const chunkBuffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    buffer = Buffer.concat([buffer, chunkBuffer]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number.parseInt(match[1], 10);
      const totalLength = headerEnd + 4 + length;
      if (buffer.length < totalLength) return;
      const body = buffer.slice(headerEnd + 4, totalLength).toString("utf8");
      buffer = buffer.slice(totalLength);
      try {
        const message = JSON.parse(body) as JsonRpcRequest;
        onMessage(message);
      } catch (error) {
        send(jsonError(null, -32700, "Parse error", (error as Error).message));
      }
    }
  });
}

const TOOLS = [
  {
    name: "memory.add",
    description: "Add a memory item to the store",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        content: { type: "string" },
        metadata: { type: "object" },
        importance: { type: "number" },
      },
      required: ["scope", "content"],
    },
  },
  {
    name: "memory.search",
    description: "Search memory items by scope, tags, and query text",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        query: { type: "string" },
        limit: { type: "number" },
        includeDeleted: { type: "boolean" },
      },
    },
  },
  {
    name: "memory.get",
    description: "Fetch a memory item by id",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory.update",
    description: "Patch a memory item",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        patch: { type: "object" },
      },
      required: ["id", "patch"],
    },
  },
  {
    name: "memory.delete",
    description: "Soft delete a memory item",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory.prune",
    description: "Run dedupe + aging policies for memory",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "memory.rebuildIndex",
    description: "Rebuild the memory index from the JSONL store",
    inputSchema: { type: "object", properties: {} },
  },
];

async function handleToolCall(params: ToolCallParams, config: CodexMemConfig) {
  const memoryFile = config.memoryFile;
  const indexFile = config.indexFile;

  switch (params.name) {
    case "memory.add": {
      const scope = typeof params.arguments?.scope === "string" ? params.arguments.scope : "";
      const content = typeof params.arguments?.content === "string" ? params.arguments.content : "";
      if (!scope || !content) {
        throw new Error("scope and content are required");
      }
      const tags = Array.isArray(params.arguments?.tags) ? (params.arguments?.tags as string[]) : [];
      const metadata = typeof params.arguments?.metadata === "object" ? (params.arguments?.metadata as Record<string, unknown>) : null;
      const importance = typeof params.arguments?.importance === "number" ? params.arguments.importance : undefined;
      const item = await addMemoryItem(memoryFile, {
        scope: normalizeScope(scope),
        tags: normalizeTags(tags),
        content,
        metadata,
        importance,
      });
      await updateIndexFromItems(indexFile, [item]);
      return { item };
    }
    case "memory.search": {
      const scope = typeof params.arguments?.scope === "string" ? params.arguments.scope : undefined;
      const tags = Array.isArray(params.arguments?.tags) ? (params.arguments?.tags as string[]) : undefined;
      const query = typeof params.arguments?.query === "string" ? params.arguments.query : undefined;
      const limit = typeof params.arguments?.limit === "number" ? params.arguments.limit : config.retrieval.defaultLimit;
      const includeDeleted = typeof params.arguments?.includeDeleted === "boolean" ? params.arguments.includeDeleted : false;
      const list = await listMemoryItems(memoryFile);
      const results = searchMemory(list.items, { scope, tags, text: query, limit, includeDeleted }, config.scoring);
      return { results };
    }
    case "memory.get": {
      const id = typeof params.arguments?.id === "string" ? params.arguments.id : "";
      if (!id) throw new Error("id is required");
      const item = await getMemoryItem(memoryFile, id);
      return { item };
    }
    case "memory.update": {
      const id = typeof params.arguments?.id === "string" ? params.arguments.id : "";
      const patch = params.arguments?.patch as MemoryPatch | undefined;
      if (!id || !patch) throw new Error("id and patch are required");
      const updated = await updateMemoryItem(memoryFile, id, patch);
      if (!updated) throw new Error("memory item not found");
      await updateIndexFromItems(indexFile, [updated]);
      return { item: updated };
    }
    case "memory.delete": {
      const id = typeof params.arguments?.id === "string" ? params.arguments.id : "";
      if (!id) throw new Error("id is required");
      const updated = await updateMemoryItem(memoryFile, id, { deleted: true });
      if (!updated) throw new Error("memory item not found");
      await updateIndexFromItems(indexFile, [updated]);
      return { item: updated };
    }
    case "memory.prune": {
      const dryRun = typeof params.arguments?.dryRun === "boolean" ? params.arguments.dryRun : false;
      const scope = typeof params.arguments?.scope === "string" ? params.arguments.scope : undefined;
      const list = await listMemoryItems(memoryFile);
      const items = scope ? list.items.filter((item) => item.scope === scope) : list.items;
      const result = pruneMemory(items, config.prune, config.summarization);

      if (!dryRun) {
        const updates = [];
        for (const action of result.actions) {
          const updated = await updateMemoryItem(memoryFile, action.id, action.patch);
          if (updated) updates.push(updated);
        }
        if (updates.length > 0) {
          await updateIndexFromItems(indexFile, updates);
        }
      }

      return { ...result, dryRun };
    }
    case "memory.rebuildIndex": {
      const index = await rebuildIndex(memoryFile, indexFile);
      return { index };
    }
    default:
      throw new Error(`Unknown tool: ${params.name}`);
  }
}

async function runSanityCheck(config: CodexMemConfig) {
  const tempDir = await fs.mkdtemp(path.join(path.dirname(config.memoryFile), "sanity-"));
  const tempConfig: CodexMemConfig = {
    ...config,
    memoryFile: path.join(tempDir, "memory.jsonl"),
    indexFile: path.join(tempDir, "index.json"),
  };

  const item = await addMemoryItem(tempConfig.memoryFile, {
    scope: "sanity",
    tags: ["check"],
    content: "Sanity check content",
    importance: 0.7,
  });

  const fetched = await getMemoryItem(tempConfig.memoryFile, item.id);
  if (!fetched) throw new Error("Sanity check failed: item not found");

  await rebuildIndex(tempConfig.memoryFile, tempConfig.indexFile);
  const list = await listMemoryItems(tempConfig.memoryFile);
  const results = searchMemory(list.items, { scope: "sanity", tags: ["check"], text: "content" }, tempConfig.scoring);
  if (results.length === 0) throw new Error("Sanity check failed: search returned no results");

  await fs.rm(tempDir, { recursive: true, force: true });
  return { ok: true };
}

async function main() {
  const config = await loadConfig();
  if (process.argv.includes("--sanity")) {
    const result = await runSanityCheck(config);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result));
    return;
  }

  readMessages(async (message) => {
    if (message.method === "initialize") {
      send(
        jsonResponse(message.id, {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "codex-mem", version: "0.1.0" },
          capabilities: { tools: {} },
        }),
      );
      return;
    }

    if (message.method === "tools/list") {
      send(jsonResponse(message.id, { tools: TOOLS }));
      return;
    }

    if (message.method === "tools/call") {
      const params = message.params as ToolCallParams | undefined;
      if (!params?.name) {
        send(jsonError(message.id, -32602, "Missing tool name"));
        return;
      }
      try {
        const result = await handleToolCall(params, config);
        send(jsonResponse(message.id, result));
      } catch (error) {
        send(jsonError(message.id, -32602, (error as Error).message));
      }
      return;
    }

    send(jsonError(message.id ?? null, -32601, `Unknown method: ${message.method}`));
  });
}

main().catch((error) => {
  send(jsonError(null, -32000, "Server error", (error as Error).message));
});
