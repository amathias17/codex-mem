import { MemoryItem, SummarizationConfig } from "./schema";

function ageInDays(dateIso: string, now: Date): number {
  const then = Date.parse(dateIso);
  if (Number.isNaN(then)) return 0;
  const diff = now.getTime() - then;
  return diff / (1000 * 60 * 60 * 24);
}

function summarizeContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  const snippet = content.slice(0, maxLength);
  const lastSentence = Math.max(snippet.lastIndexOf("."), snippet.lastIndexOf("!"), snippet.lastIndexOf("?"));
  if (lastSentence > maxLength * 0.6) {
    return snippet.slice(0, lastSentence + 1);
  }
  return `${snippet.trim()}...`;
}

export function needsSummary(item: MemoryItem, config: SummarizationConfig, now = new Date()): boolean {
  const ageDays = ageInDays(item.updatedAt, now);
  return ageDays >= config.olderThanDays && item.content.length >= config.maxContentLength;
}

export function summarizeItem(item: MemoryItem, config: SummarizationConfig, now = new Date()): string | null {
  if (!needsSummary(item, config, now)) return item.summary;
  const tagPrefix = item.tags.length > 0 ? `Tags: ${item.tags.join(", ")}. ` : "";
  return `${tagPrefix}${summarizeContent(item.content, config.maxContentLength)}`;
}
