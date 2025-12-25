#!/usr/bin/env node
import { getValue, postJson, readJsonInput, writeOutput } from "./shared";

async function main(): Promise<void> {
  const input = await readJsonInput();
  const projectId = getValue(input, "project_id", "CODEX_PROJECT_ID");
  const codexSessionId = getValue(input, "codex_session_id", "CODEX_SESSION_ID");

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
