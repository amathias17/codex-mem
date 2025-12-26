#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { loadConfig } from "../config";
import { stripTags } from "../redaction";
import { ensureDir } from "../utils";
import { logHookPayload, postJson, writeOutput } from "./shared";

type NotifyPayload = {
  type?: string;
  "thread-id"?: string;
  "turn-id"?: string;
  cwd?: string;
  "input-messages"?: unknown[];
  "last-assistant-message"?: unknown;
};

function parseNotifyPayload(): { payload: NotifyPayload; raw?: string } {
  const arg = process.argv[2];
  if (arg && arg.trim()) {
    try {
      return { payload: JSON.parse(arg) as NotifyPayload, raw: arg };
    } catch {
      return { payload: {}, raw: arg };
    }
  }
  const raw = fs.readFileSync(0, "utf8");
  if (!raw.trim()) {
    return { payload: {}, raw };
  }
  try {
    return { payload: JSON.parse(raw) as NotifyPayload, raw };
  } catch {
    return { payload: {}, raw };
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function resolveCwd(payload: NotifyPayload): string {
  if (payload.cwd && path.isAbsolute(payload.cwd) && fs.existsSync(payload.cwd)) {
    return payload.cwd;
  }
  return process.cwd();
}

function readSessionMap(dataDir: string): Record<string, string> {
  const mapPath = path.join(dataDir, "notify-sessions.json");
  if (!fs.existsSync(mapPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(mapPath, "utf8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSessionMap(dataDir: string, map: Record<string, string>): void {
  const mapPath = path.join(dataDir, "notify-sessions.json");
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2), "utf8");
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

async function main(): Promise<void> {
  const { payload, raw } = parseNotifyPayload();
  logHookPayload("codex-notify", payload, raw);

  if (payload.type !== "agent-turn-complete") {
    writeOutput({ skipped: true, reason: "unsupported notify type" });
    return;
  }

  const cwd = resolveCwd(payload);
  const config = loadConfig(cwd);
  ensureDir(config.dataDir);

  const threadId = payload["thread-id"];
  if (!threadId) {
    throw new Error("notify payload missing thread-id");
  }

  const sessionMap = readSessionMap(config.dataDir);
  let sessionId = sessionMap[threadId];
  if (!sessionId) {
    const response = await postJson("/api/sessions/init", {
      project_id: config.projectId,
      codex_session_id: threadId
    }) as { session_id?: string };
    const nextSessionId = response.session_id;
    if (!nextSessionId) {
      throw new Error("notify hook failed to initialize session");
    }
    sessionId = nextSessionId;
    sessionMap[threadId] = sessionId;
    writeSessionMap(config.dataDir, sessionMap);
  }

  const inputMessages = formatValue(payload["input-messages"] || []);
  const assistantMessage = formatValue(payload["last-assistant-message"] || "");
  const body = stripTags(`Input Messages:\n${inputMessages}\n\nAssistant:\n${assistantMessage}`);

  if (!body.trim()) {
    writeOutput({ skipped: true, reason: "notify body empty after stripping" });
    return;
  }

  const response = await postJson("/api/sessions/observations", {
    session_id: sessionId,
    project_id: config.projectId,
    type: "notify",
    title: "Codex turn complete",
    body,
    tags: ["codex", "notify", "turn"],
    files_read: [],
    files_modified: [],
    prompt_number: parseTurnNumber(payload["turn-id"])
  });

  writeOutput(response);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
