import fs from "fs";
import path from "path";
import { Config } from "./config";
import { DbContext, insertMemory } from "./db";
import { redactText, stripTags } from "./redaction";
import { ensureDir, newId } from "./utils";

type EventLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

type EventRecord = {
  id: string;
  type: string;
  level: EventLevel;
  ts: number;
  payload: Record<string, unknown>;
};

function appendEvent(dataDir: string, event: EventRecord): void {
  const logDir = path.join(dataDir, "events");
  ensureDir(logDir);
  const logPath = path.join(logDir, "events.log");
  fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`, "utf8");
}

function createEvent(type: string, level: EventLevel, payload: Record<string, unknown>): EventRecord {
  return {
    id: newId(),
    type,
    level,
    ts: Date.now(),
    payload
  };
}

export function runCapturePipeline(input: {
  config: Config;
  db: DbContext;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  pathAffinity: string[];
}): string {
  const context = {
    rawBody: input.body,
    redactedBody: "",
    memoryId: "",
    config: input.config,
    db: input.db,
    kind: input.kind,
    title: input.title,
    tags: input.tags,
    pathAffinity: input.pathAffinity
  };

  const cfg = context.config as Config;
  const raw = String(context.rawBody || "");
  const stripped = stripTags(raw);
  context.redactedBody = redactText(stripped, cfg);

  const db = context.db as DbContext;
  const memoryId = insertMemory(db, {
    kind: String(context.kind),
    title: String(context.title),
    body: String(context.redactedBody),
    projectId: cfg.projectId,
    tags: (context.tags as string[]) || [],
    pathAffinity: (context.pathAffinity as string[]) || []
  });
  context.memoryId = memoryId;

  const event = createEvent("memory.capture", "INFO", {
    memoryId: context.memoryId,
    kind: context.kind,
    title: context.title
  });
  appendEvent(cfg.dataDir, event);
  return String(context.memoryId || "");
}

export function logRetrieval(config: Config, query: string, count: number): void {
  const event = createEvent("memory.retrieve", "INFO", {
    query,
    count
  });
  appendEvent(config.dataDir, event);
}

export function logInjection(config: Config, tokenEstimate: number, count: number): void {
  const event = createEvent("memory.inject", "INFO", {
    tokenEstimate,
    count
  });
  appendEvent(config.dataDir, event);
}
