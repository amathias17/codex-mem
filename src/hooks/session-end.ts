#!/usr/bin/env node
import { getValue, postJson, readJsonInput, writeOutput } from "./shared";

async function main(): Promise<void> {
  const input = await readJsonInput();
  const sessionId = getValue(input, "session_id", "CODEX_MEM_SESSION_ID");
  const status = getValue(input, "status") || "completed";

  if (!sessionId) {
    throw new Error("session_id is required");
  }

  const response = await postJson("/api/sessions/complete", {
    session_id: sessionId,
    status
  });

  writeOutput(response);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
