#!/usr/bin/env node
import { stripTags } from "../redaction";
import { getNumber, getValue, postJson, readJsonInput, writeOutput } from "./shared";

async function main(): Promise<void> {
  const input = await readJsonInput();
  const sessionId = getValue(input, "session_id", "CODEX_MEM_SESSION_ID");
  const projectId = getValue(input, "project_id", "CODEX_PROJECT_ID");
  const promptNumber = getNumber(input, "prompt_number");
  const title = getValue(input, "title") || "Session summary";
  const body = getValue(input, "body") || "";

  if (!sessionId || promptNumber === undefined) {
    throw new Error("session_id and prompt_number are required");
  }

  const strippedBody = stripTags(body);
  if (!strippedBody) {
    writeOutput({ skipped: true, reason: "summary empty after privacy stripping" });
    return;
  }

  const response = await postJson("/api/sessions/summary", {
    session_id: sessionId,
    project_id: projectId,
    title,
    body: strippedBody,
    prompt_number: promptNumber
  });

  writeOutput(response);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
