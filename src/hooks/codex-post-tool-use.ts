#!/usr/bin/env node
import { stripTags } from "../redaction";
import { getNumber, getValue, logHookPayload, postJson, readJsonInputWithRaw, writeOutput, HookInput } from "./shared";

function unwrapPayload(input: HookInput): HookInput {
  const payload = input.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as HookInput;
  }
  const data = input.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as HookInput;
  }
  return input;
}

function pickString(input: HookInput, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function pickNumber(input: HookInput, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function pickArray(input: HookInput, keys: string[]): string[] {
  for (const key of keys) {
    const value = input[key];
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === "string") as string[];
    }
  }
  return [];
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

function resolveToolName(payload: HookInput): string | undefined {
  const direct = pickString(payload, ["tool_name", "toolName", "name"]);
  if (direct) {
    return direct;
  }
  const tool = payload.tool;
  if (typeof tool === "string") {
    return tool;
  }
  if (tool && typeof tool === "object" && "name" in tool) {
    const name = (tool as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) {
      return name;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const { input, raw } = await readJsonInputWithRaw();
  const payload = unwrapPayload(input);
  logHookPayload("codex-post-tool-use", payload, raw);

  const sessionId = pickString(payload, ["session_id", "sessionId", "session", "thread_id", "threadId", "thread-id"])
    || getValue(payload, "session_id", "CODEX_MEM_SESSION_ID");
  const projectId = pickString(payload, ["project_id", "projectId", "project", "repo"])
    || getValue(payload, "project_id", "CODEX_PROJECT_ID");
  const promptNumber = pickNumber(payload, ["prompt_number", "promptNumber", "turn_number", "turnNumber", "turn_id", "turnId", "turn-id"])
    ?? getNumber(payload, "prompt_number");

  if (!sessionId) {
    throw new Error("session_id is required");
  }

  const toolName = resolveToolName(payload);
  const tool = payload.tool;
  const toolInput = formatValue(payload.tool_input ?? payload.input ?? payload.args ?? payload.arguments)
    ?? formatValue(tool && typeof tool === "object" ? (tool as { input?: unknown }).input : undefined);
  const toolOutput = formatValue(payload.tool_output ?? payload.output ?? payload.result ?? payload.response)
    ?? formatValue(tool && typeof tool === "object" ? (tool as { output?: unknown }).output : undefined);
  const toolError = formatValue(payload.error ?? payload.tool_error)
    ?? formatValue(tool && typeof tool === "object" ? (tool as { error?: unknown }).error : undefined);

  const sections: string[] = [];
  if (toolInput) {
    sections.push(`Input:\n${toolInput}`);
  }
  if (toolOutput) {
    sections.push(`Output:\n${toolOutput}`);
  }
  if (toolError) {
    sections.push(`Error:\n${toolError}`);
  }

  const rawBody = sections.join("\n\n");
  const strippedBody = stripTags(rawBody);
  if (!strippedBody) {
    writeOutput({ skipped: true, reason: "tool payload empty after privacy stripping" });
    return;
  }

  const filesRead = pickArray(payload, ["files_read", "filesRead", "read_files"])
    || pickArray((payload.files as HookInput) || {}, ["read", "files_read"]);
  const filesModified = pickArray(payload, ["files_modified", "filesModified", "modified_files"])
    || pickArray((payload.files as HookInput) || {}, ["modified", "files_modified"]);
  const tags = ["tool", toolName].filter((tag): tag is string => Boolean(tag));

  const response = await postJson("/api/sessions/observations", {
    session_id: sessionId,
    project_id: projectId,
    type: "tool",
    title: toolName ? `Tool: ${toolName}` : "Tool output",
    body: strippedBody,
    tags,
    files_read: filesRead,
    files_modified: filesModified,
    prompt_number: promptNumber ?? 0
  });

  writeOutput(response);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
