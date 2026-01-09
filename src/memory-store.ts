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
  stats: ReadStats;
}

export interface ReadStats {
  totalLines: number;
  emptyLines: number;
  validLines: number;
  invalidLines: number;
  bytes: number;
}

export interface RepairOptions {
  compact?: boolean;
  quarantine?: boolean;
}

export interface RepairResult {
  repaired: boolean;
  compacted: boolean;
  errors: string[];
  stats: ReadStats;
  quarantinedFile?: string;
  quarantinedLines: number;
}

export interface HealthOptions {
  maxLineRatio?: number;
  minLines?: number;
  maxBytes?: number;
}

export interface HealthResult {
  stats: ReadStats;
  errors: string[];
  latestItems: number;
  needsRepair: boolean;
  shouldCompact: boolean;
  reasons: string[];
}

async function ensureFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "", "utf8");
  }
}

function parseLine(
  line: string,
  lineNumber: number,
  errors: string[],
): { item: MemoryItem | null; error?: string } {
  if (line.trim().length === 0) return { item: null };
  try {
    const parsed = JSON.parse(line) as unknown;
    const validation = validateMemoryItem(parsed);
    if (!validation.ok) {
      const message = `Line ${lineNumber}: ${validation.errors.join("; ")}`;
      errors.push(message);
      return { item: null, error: message };
    }
    return { item: parsed as MemoryItem };
  } catch (error) {
    const message = `Line ${lineNumber}: ${(error as Error).message}`;
    errors.push(message);
    return { item: null, error: message };
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
  const stats: ReadStats = {
    totalLines: lines.length,
    emptyLines: 0,
    validLines: 0,
    invalidLines: 0,
    bytes: Buffer.byteLength(content, "utf8"),
  };

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().length === 0) {
      stats.emptyLines += 1;
      continue;
    }
    const parsed = parseLine(lines[i], i + 1, errors);
    if (parsed.item) {
      stats.validLines += 1;
      items.push(parsed.item);
    } else if (parsed.error) {
      stats.invalidLines += 1;
    }
  }

  return { items, errors, stats };
}

function selectLatestItems(items: MemoryItem[]): MemoryItem[] {
  const latestById = new Map<string, MemoryItem>();

  for (const item of items) {
    const current = latestById.get(item.id);
    if (!current || getTimestamp(item) >= getTimestamp(current)) {
      latestById.set(item.id, item);
    }
  }

  return Array.from(latestById.values());
}

export async function readLatestItems(memoryFile: string): Promise<ReadResult> {
  const result = await readAllItems(memoryFile);
  return { items: selectLatestItems(result.items), errors: result.errors, stats: result.stats };
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

export async function repairMemoryFile(memoryFile: string, options: RepairOptions = {}): Promise<RepairResult> {
  const compact = options.compact ?? false;
  const quarantine = options.quarantine ?? true;

  return withFileLock(memoryFile, async () => {
    await ensureFile(memoryFile);
    const content = await fs.readFile(memoryFile, "utf8");
    const lines = content.split(/\r?\n/);
    const errors: string[] = [];
    const items: MemoryItem[] = [];
    const corruptEntries: { lineNumber: number; error: string; raw: string }[] = [];
    const stats: ReadStats = {
      totalLines: lines.length,
      emptyLines: 0,
      validLines: 0,
      invalidLines: 0,
      bytes: Buffer.byteLength(content, "utf8"),
    };

    for (let i = 0; i < lines.length; i += 1) {
      const rawLine = lines[i];
      if (rawLine.trim().length === 0) {
        stats.emptyLines += 1;
        continue;
      }
      const parsed = parseLine(rawLine, i + 1, errors);
      if (parsed.item) {
        stats.validLines += 1;
        items.push(parsed.item);
      } else if (parsed.error) {
        stats.invalidLines += 1;
        corruptEntries.push({ lineNumber: i + 1, error: parsed.error, raw: rawLine });
      }
    }

    const repaired = stats.invalidLines > 0;
    const compacted = compact && items.length > 0;
    const shouldWrite = repaired || compacted;
    let quarantinedFile: string | undefined;

    if (quarantine && corruptEntries.length > 0) {
      quarantinedFile = `${memoryFile}.corrupt.${Date.now()}.jsonl`;
      const payload = corruptEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
      await fs.writeFile(quarantinedFile, payload, "utf8");
    }

    if (shouldWrite) {
      const outputItems = compacted ? selectLatestItems(items) : items;
      const tempFile = `${memoryFile}.tmp`;
      const backupFile = `${memoryFile}.bak.${Date.now()}`;

      await fs.writeFile(tempFile, outputItems.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
      await fs.rename(memoryFile, backupFile);
      await fs.rename(tempFile, memoryFile);
    }

    return {
      repaired,
      compacted,
      errors,
      stats,
      quarantinedFile,
      quarantinedLines: corruptEntries.length,
    };
  });
}

export async function getMemoryHealth(memoryFile: string, options: HealthOptions = {}): Promise<HealthResult> {
  const maxLineRatio = options.maxLineRatio ?? 2;
  const minLines = options.minLines ?? 200;
  const maxBytes = options.maxBytes ?? 5_000_000;

  const all = await readAllItems(memoryFile);
  const latestItems = selectLatestItems(all.items);
  const reasons: string[] = [];

  if (all.stats.validLines >= minLines && latestItems.length > 0) {
    const ratio = all.stats.validLines / latestItems.length;
    if (ratio >= maxLineRatio) {
      reasons.push(`line-ratio:${ratio.toFixed(2)}>=${maxLineRatio}`);
    }
  }

  if (all.stats.bytes >= maxBytes) {
    reasons.push(`bytes:${all.stats.bytes}>=${maxBytes}`);
  }

  const needsRepair = all.stats.invalidLines > 0;
  if (needsRepair) {
    reasons.push(`invalid-lines:${all.stats.invalidLines}`);
  }

  return {
    stats: all.stats,
    errors: all.errors,
    latestItems: latestItems.length,
    needsRepair,
    shouldCompact: reasons.length > 0,
    reasons,
  };
}
