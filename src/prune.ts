import { createHash } from "crypto";
import { MemoryItem, MemoryPatch, PruneConfig, SummarizationConfig } from "./schema";
import { summarizeItem } from "./summarizer";

export interface PruneAction {
  id: string;
  patch: MemoryPatch;
  reason: string;
}

export interface PruneStats {
  deduped: number;
  deleted: number;
  summarized: number;
  retained: number;
}

function ageInDays(dateIso: string, now: Date): number {
  const parsed = Date.parse(dateIso);
  if (Number.isNaN(parsed)) return 0;
  return (now.getTime() - parsed) / (1000 * 60 * 60 * 24);
}

function contentFingerprint(content: string): string {
  const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export function pruneMemory(
  items: MemoryItem[],
  pruneConfig: PruneConfig,
  summarizationConfig: SummarizationConfig,
  now = new Date(),
): { actions: PruneAction[]; stats: PruneStats } {
  const actions: PruneAction[] = [];
  const stats: PruneStats = { deduped: 0, deleted: 0, summarized: 0, retained: 0 };

  const byScope = new Map<string, MemoryItem[]>();
  for (const item of items) {
    if (!byScope.has(item.scope)) byScope.set(item.scope, []);
    byScope.get(item.scope)!.push(item);
  }

  for (const [scope, scopeItems] of byScope.entries()) {
    const fingerprintMap = new Map<string, MemoryItem>();

    if (pruneConfig.dedupe) {
      for (const item of scopeItems) {
        if (item.deleted) continue;
        const fingerprint = contentFingerprint(item.content);
        const existing = fingerprintMap.get(fingerprint);
        if (!existing) {
          fingerprintMap.set(fingerprint, item);
          continue;
        }

        const mergedTags = Array.from(new Set([...existing.tags, ...item.tags]));
        if (mergedTags.length !== existing.tags.length) {
          actions.push({
            id: existing.id,
            patch: { tags: mergedTags },
            reason: "merge tags from duplicate",
          });
        }

        actions.push({
          id: item.id,
          patch: { deleted: true },
          reason: "duplicate content in scope",
        });
        stats.deduped += 1;
      }
    }

    const ranked = scopeItems
      .filter((item) => !item.deleted)
      .map((item) => {
        const ageDays = ageInDays(item.updatedAt, now);
        const recency = 1 / (1 + ageDays);
        const score = item.importance + recency;
        return { item, score, ageDays };
      })
      .sort((a, b) => b.score - a.score);

    const keep = new Set(ranked.slice(0, pruneConfig.maxPerScope).map((entry) => entry.item.id));

    for (const entry of ranked) {
      const item = entry.item;
      if (keep.has(item.id)) {
        stats.retained += 1;
        continue;
      }

      if (entry.ageDays >= pruneConfig.deleteOlderThanDays) {
        actions.push({
          id: item.id,
          patch: { deleted: true },
          reason: "aged out",
        });
        stats.deleted += 1;
        continue;
      }

      if (entry.ageDays >= pruneConfig.compressOlderThanDays) {
        const summary = summarizeItem(item, summarizationConfig, now);
        if (summary && summary !== item.summary) {
          actions.push({
            id: item.id,
            patch: { summary },
            reason: "compress older memory",
          });
          stats.summarized += 1;
        }
      }
    }
  }

  return { actions, stats };
}
