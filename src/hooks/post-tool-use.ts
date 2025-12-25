#!/usr/bin/env node
import { stripTags } from "../redaction";
import { getNumber, getValue, postJson, readJsonInput, writeOutput } from "./shared";

async function main(): Promise<void> {
  const input = await readJsonInput();
  const sessionId = getValue(input, "session_id", "CODEX_MEM_SESSION_ID");
  const projectId = getValue(input, "project_id", "CODEX_PROJECT_ID");
  const promptNumber = getNumber(input, "prompt_number");
  const type = getValue(input, "type") || "discovery";
  const title = getValue(input, "title") || "Observation";
  const body = getValue(input, "body") || "";

  if (!sessionId || promptNumber === undefined) {
    throw new Error("session_id and prompt_number are required");
  }

  const tags = Array.isArray(input.tags) ? input.tags : [];
  const filesRead = Array.isArray(input.files_read) ? input.files_read : [];
  const filesModified = Array.isArray(input.files_modified) ? input.files_modified : [];

  const strippedBody = stripTags(body);
  if (!strippedBody) {
    writeOutput({ skipped: true, reason: "body empty after privacy stripping" });
    return;
  }

  const response = await postJson("/api/sessions/observations", {
    session_id: sessionId,
    project_id: projectId,
    type,
    title,
    body: strippedBody,
    tags,
    files_read: filesRead,
    files_modified: filesModified,
    prompt_number: promptNumber
  });

  writeOutput(response);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
