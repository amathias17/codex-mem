export interface MemoryItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  scope: string;
  tags: string[];
  content: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  importance: number;
  deleted: boolean;
}

export interface MemoryPatch {
  scope?: string;
  tags?: string[];
  content?: string;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  importance?: number;
  deleted?: boolean;
}

export interface MemoryIndex {
  version: 1;
  updatedAt: string;
  byScope: Record<string, string[]>;
  byTag: Record<string, string[]>;
  byScopeTag: Record<string, Record<string, string[]>>;
}

export interface SummarizationConfig {
  maxContentLength: number;
  olderThanDays: number;
}

export interface PruneConfig {
  maxPerScope: number;
  deleteOlderThanDays: number;
  compressOlderThanDays: number;
  dedupe: boolean;
}

export interface ScoringConfig {
  scope: number;
  tag: number;
  recency: number;
  importance: number;
  text: number;
  halfLifeDays: number;
}

export interface RetrievalConfig {
  defaultLimit: number;
}

export interface MaintenanceConfig {
  maxLineRatio: number;
  minLines: number;
  maxBytes: number;
}

export interface CodexMemConfig {
  memoryFile: string;
  indexFile: string;
  summarization: SummarizationConfig;
  prune: PruneConfig;
  scoring: ScoringConfig;
  retrieval: RetrievalConfig;
  maintenance?: Partial<MaintenanceConfig>;
}

export const MEMORY_INDEX_VERSION = 1 as const;

export function normalizeScope(scope: string): string {
  return scope.trim();
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function normalizeTags(tags: string[]): string[] {
  const normalized = tags.map(normalizeTag).filter((tag) => tag.length > 0);
  return Array.from(new Set(normalized));
}

export function clampImportance(value: number | undefined | null, fallback = 0.5): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateMemoryItem(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["Memory item is not an object"] };
  }

  const requiredStringFields = ["id", "createdAt", "updatedAt", "scope", "content"] as const;
  for (const field of requiredStringFields) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0) {
      errors.push(`Invalid or missing ${field}`);
    }
  }

  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")) {
    errors.push("Invalid or missing tags");
  }

  if (!(typeof value.deleted === "boolean")) {
    errors.push("Invalid or missing deleted flag");
  }

  if (!(typeof value.importance === "number")) {
    errors.push("Invalid or missing importance");
  }

  if (!(value.summary === null || typeof value.summary === "string")) {
    errors.push("Invalid summary");
  }

  if (!(value.metadata === null || isRecord(value.metadata))) {
    errors.push("Invalid metadata");
  }

  return { ok: errors.length === 0, errors };
}
