#!/usr/bin/env node
import { stripTags } from "../redaction";
import { logHookPayload, postJson, readStdin, writeOutput } from "./shared";

type ExecEvent = Record<string, unknown>;

type ExecItem = Record<string, unknown>;

type Observation = {
  title: string;
  body: string;
  tags: string[];
};

function parseLines(raw: string): { events: ExecEvent[]; errors: number } {
  const events: ExecEvent[] = [];
  let errors = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as ExecEvent;
      events.push(parsed);
    } catch {
      errors += 1;
    }
  }
  return { events, errors };
}

function pickString(input: ExecEvent | ExecItem, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function pickNumber(input: ExecEvent | ExecItem, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function formatValue(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseTurnNumber(turnId: string | undefined): number {
  if (!turnId) {
    return 0;
  }
  const numeric = Number(turnId);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const match = turnId.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function resolveThreadId(event: ExecEvent): string | undefined {
  const direct = pickString(event, ["thread-id", "thread_id", "threadId"]);
  if (direct) {
    return direct;
  }
  const thread = event.thread;
  if (thread && typeof thread === "object" && !Array.isArray(thread)) {
    const value = pickString(thread as ExecEvent, ["id", "thread-id", "thread_id", "threadId"]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolveTurnId(event: ExecEvent): string | undefined {
  const direct = pickString(event, ["turn-id", "turn_id", "turnId"]);
  if (direct) {
    return direct;
  }
  const turn = event.turn;
  if (turn && typeof turn === "object" && !Array.isArray(turn)) {
    const value = pickString(turn as ExecEvent, ["id", "turn-id", "turn_id", "turnId"]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolveCommandObservation(item: ExecItem): Observation | undefined {
  const command = pickString(item, ["command"]);
  const exitCode = pickNumber(item, ["exit_code", "exitCode"]);
  const output = formatValue(item.aggregated_output ?? item.output ?? item.result);

  const sections: string[] = [];
  if (command) {
    sections.push(`Command:\n${command}`);
  }
  if (exitCode !== undefined) {
    sections.push(`Exit code: ${exitCode}`);
  }
  if (output) {
    sections.push(`Output:\n${output}`);
  }

  const body = stripTags(sections.join("\n\n"));
  if (!body.trim()) {
    return undefined;
  }

  return {
    title: command ? `Command: ${command}` : "Command execution",
    body,
    tags: ["tool", "command"]
  };
}

function resolveMcpObservation(item: ExecItem): Observation | undefined {
  const server = pickString(item, ["server"]);
  const tool = pickString(item, ["tool", "tool_name", "name"]);
  const args = formatValue(item.arguments);
  const result = formatValue(item.result);
  const error = formatValue(item.error);

  const sections: string[] = [];
  if (server) {
    sections.push(`Server: ${server}`);
  }
  if (tool) {
    sections.push(`Tool: ${tool}`);
  }
  if (args) {
    sections.push(`Arguments:\n${args}`);
  }
  if (result) {
    sections.push(`Result:\n${result}`);
  }
  if (error) {
    sections.push(`Error:\n${error}`);
  }

  const body = stripTags(sections.join("\n\n"));
  if (!body.trim()) {
    return undefined;
  }

  const name = tool ? `${server ? server + "/" : ""}${tool}` : "MCP tool call";
  return {
    title: tool ? `MCP: ${name}` : "MCP tool call",
    body,
    tags: ["tool", "mcp", tool].filter((tag): tag is string => Boolean(tag))
  };
}

async function ensureSession(threadId: string, projectId?: string, cache?: Map<string, string>): Promise<string> {
  const existing = cache?.get(threadId);
  if (existing) {
    return existing;
  }
  const response = await postJson("/api/sessions/init", {
    project_id: projectId,
    codex_session_id: threadId
  }) as { session_id?: string };
  const sessionId = response.session_id;
  if (!sessionId) {
    throw new Error("codex-exec-json failed to initialize session");
  }
  cache?.set(threadId, sessionId);
  return sessionId;
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const { events, errors } = parseLines(raw);
  logHookPayload("codex-exec-json", { event_count: events.length, parse_errors: errors }, raw);

  if (!events.length) {
    writeOutput({ skipped: true, reason: "no exec json events" });
    return;
  }

  const projectId = process.env.CODEX_PROJECT_ID || process.env.CODEX_MEM_PROJECT_ID;
  const sessionCache = new Map<string, string>();
  let lastThreadId: string | undefined;
  let lastTurnId: string | undefined;
  let sent = 0;
  let skipped = 0;

  for (const event of events) {
    const threadId = resolveThreadId(event);
    if (threadId) {
      lastThreadId = threadId;
    }
    const turnId = resolveTurnId(event);
    if (turnId) {
      lastTurnId = turnId;
    }

    const eventType = pickString(event, ["type", "event", "event_type"]);
    if (eventType !== "item.completed") {
      continue;
    }

    const item = event.item;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const itemType = pickString(item as ExecItem, ["type", "item_type"]);
    let observation: Observation | undefined;
    if (itemType === "command_execution") {
      observation = resolveCommandObservation(item as ExecItem);
    } else if (itemType === "mcp_tool_call") {
      observation = resolveMcpObservation(item as ExecItem);
    }

    if (!observation) {
      skipped += 1;
      continue;
    }

    const activeThread = threadId || lastThreadId;
    if (!activeThread) {
      skipped += 1;
      continue;
    }

    const sessionId = await ensureSession(activeThread, projectId, sessionCache);
    await postJson("/api/sessions/observations", {
      session_id: sessionId,
      project_id: projectId,
      type: "tool",
      title: observation.title,
      body: observation.body,
      tags: observation.tags,
      files_read: [],
      files_modified: [],
      prompt_number: parseTurnNumber(turnId || lastTurnId)
    });
    sent += 1;
  }

  writeOutput({ processed: sent, skipped, parse_errors: errors });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
