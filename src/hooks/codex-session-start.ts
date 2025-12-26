#!/usr/bin/env node
import { getValue, logHookPayload, postJson, readJsonInputWithRaw, writeOutput, HookInput } from "./shared";

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

async function main(): Promise<void> {
  const { input, raw } = await readJsonInputWithRaw();
  const payload = unwrapPayload(input);
  logHookPayload("codex-session-start", payload, raw);
  const projectId = pickString(payload, ["project_id", "projectId", "project", "repo"])
    || getValue(payload, "project_id", "CODEX_PROJECT_ID");
  const codexSessionId = pickString(payload, ["codex_session_id", "session_id", "sessionId", "thread_id", "threadId", "thread-id", "id"])
    || getValue(payload, "codex_session_id", "CODEX_SESSION_ID");

  const response = await postJson("/api/sessions/init", {
    project_id: projectId,
    codex_session_id: codexSessionId
  });

  writeOutput(response);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
