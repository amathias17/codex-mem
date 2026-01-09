import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  MemoryItem,
  MemoryPatch,
  clampImportance,
  normalizeScope,
  normalizeTags,
  validateMemoryItem,
} from "./schema";
import { withFileLock } from "./file-lock";

export interface MemoryInput {
  scope: string;
  tags?: string[];
  content: string;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  importance?: number;
}

export interface ReadResult {
  items: MemoryItem[];
  errors: string[];
}

async function ensureFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "", "utf8");
  }
}

function parseLine(line: string, lineNumber: number, errors: string[]): MemoryItem | null {
  if (line.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    const validation = validateMemoryItem(parsed);
    if (!validation.ok) {
      errors.push(`Line ${lineNumber}: ${validation.errors.join("; ")}`);
      return null;
    }
    return parsed as MemoryItem;
  } catch (error) {
    errors.push(`Line ${lineNumber}: ${(error as Error).message}`);
    return null;
  }
}

function getTimestamp(item: MemoryItem): number {
  const updated = Date.parse(item.updatedAt);
  if (!Number.isNaN(updated)) return updated;
  const created = Date.parse(item.createdAt);
  if (!Number.isNaN(created)) return created;
  return 0;
}

export async function readAllItems(memoryFile: string): Promise<ReadResult> {
  await ensureFile(memoryFile);
  const content = await fs.readFile(memoryFile, "utf8");
  const lines = content.split(/\r?\n/);
  const errors: string[] = [];
  const items: MemoryItem[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const item = parseLine(lines[i], i + 1, errors);
    if (item) items.push(item);
  }

  return { items, errors };
}

export async function readLatestItems(memoryFile: string): Promise<ReadResult> {
  const result = await readAllItems(memoryFile);
  const latestById = new Map<string, MemoryItem>();

  for (const item of result.items) {
    const current = latestById.get(item.id);
    if (!current || getTimestamp(item) >= getTimestamp(current)) {
      latestById.set(item.id, item);
    }
  }

  return { items: Array.from(latestById.values()), errors: result.errors };
}

async function appendItem(memoryFile: string, item: MemoryItem): Promise<void> {
  await withFileLock(memoryFile, async () => {
    await ensureFile(memoryFile);
    const line = `${JSON.stringify(item)}\n`;
    await fs.appendFile(memoryFile, line, "utf8");
  });
}

export async function addMemoryItem(memoryFile: string, input: MemoryInput): Promise<MemoryItem> {
  const now = new Date().toISOString();
  const item: MemoryItem = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    scope: normalizeScope(input.scope),
    tags: normalizeTags(input.tags ?? []),
    content: input.content,
    summary: input.summary ?? null,
    metadata: input.metadata ?? null,
    importance: clampImportance(input.importance, 0.5),
    deleted: false,
  };

  await appendItem(memoryFile, item);
  return item;
}

export async function updateMemoryItem(
  memoryFile: string,
  id: string,
  patch: MemoryPatch,
): Promise<MemoryItem | null> {
  const latest = await readLatestItems(memoryFile);
  const existing = latest.items.find((item) => item.id === id);
  if (!existing) return null;

  const updated: MemoryItem = {
    ...existing,
    ...patch,
    scope: patch.scope ? normalizeScope(patch.scope) : existing.scope,
    tags: patch.tags ? normalizeTags(patch.tags) : existing.tags,
    summary: patch.summary !== undefined ? patch.summary : existing.summary,
    metadata: patch.metadata !== undefined ? patch.metadata : existing.metadata,
    importance: patch.importance !== undefined ? clampImportance(patch.importance, existing.importance) : existing.importance,
    deleted: patch.deleted !== undefined ? patch.deleted : existing.deleted,
    updatedAt: new Date().toISOString(),
  };

  await appendItem(memoryFile, updated);
  return updated;
}

export async function getMemoryItem(memoryFile: string, id: string): Promise<MemoryItem | null> {
  const latest = await readLatestItems(memoryFile);
  return latest.items.find((item) => item.id === id) ?? null;
}

export async function listMemoryItems(memoryFile: string): Promise<ReadResult> {
  return readLatestItems(memoryFile);
}

export async function compactMemoryFile(memoryFile: string): Promise<void> {
  await withFileLock(memoryFile, async () => {
    const latest = await readLatestItems(memoryFile);
    const tempFile = `${memoryFile}.tmp`;
    const backupFile = `${memoryFile}.bak.${Date.now()}`;

    await fs.writeFile(tempFile, latest.items.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
    await fs.rename(memoryFile, backupFile);
    await fs.rename(tempFile, memoryFile);
  });
}
