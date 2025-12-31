import { MemoryItem, ScoringConfig } from "./schema";

export interface SearchQuery {
  scope?: string;
  tags?: string[];
  text?: string;
  limit?: number;
  includeDeleted?: boolean;
  now?: Date;
}

export interface ScoredResult {
  item: MemoryItem;
  score: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function recencyScore(item: MemoryItem, halfLifeDays: number, now: Date): number {
  if (halfLifeDays <= 0) return 1;
  const updated = Date.parse(item.updatedAt);
  if (Number.isNaN(updated)) return 0;
  const ageDays = (now.getTime() - updated) / (1000 * 60 * 60 * 24);
  return Math.exp(-ageDays / halfLifeDays);
}

function textScore(item: MemoryItem, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const haystack = `${item.content} ${item.summary ?? ""}`.toLowerCase();
  let matches = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) matches += 1;
  }
  return matches / tokens.length;
}

function tagScore(item: MemoryItem, tags: string[]): number {
  if (tags.length === 0) return 0;
  const tagSet = new Set(item.tags.map((tag) => tag.toLowerCase()));
  let matches = 0;
  for (const tag of tags) {
    if (tagSet.has(tag.toLowerCase())) matches += 1;
  }
  return matches / tags.length;
}

export function scoreItem(item: MemoryItem, query: SearchQuery, config: ScoringConfig): number {
  const now = query.now ?? new Date();
  const scopeScore = query.scope ? (item.scope === query.scope ? 1 : 0) : 0;
  const tags = query.tags ?? [];
  const tokens = query.text ? tokenize(query.text) : [];

  const score =
    config.scope * scopeScore +
    config.tag * tagScore(item, tags) +
    config.recency * recencyScore(item, config.halfLifeDays, now) +
    config.importance * item.importance +
    config.text * textScore(item, tokens);

  return score;
}

export function searchMemory(items: MemoryItem[], query: SearchQuery, config: ScoringConfig): ScoredResult[] {
  const now = query.now ?? new Date();
  const filtered = items.filter((item) => (query.includeDeleted ? true : !item.deleted));
  const results = filtered.map((item) => ({
    item,
    score: scoreItem(item, { ...query, now }, config),
  }));

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = Date.parse(a.item.updatedAt);
    const bTime = Date.parse(b.item.updatedAt);
    return bTime - aTime;
  });

  const limit = query.limit && query.limit > 0 ? query.limit : results.length;
  return results.slice(0, limit);
}
