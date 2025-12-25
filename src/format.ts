import { MemoryResult } from "./db";

export function formatIndex(memories: MemoryResult[]): string {
  return memories
    .map((memory, index) => {
      const date = new Date(memory.created_at_epoch).toISOString();
      const kind = memory.kind ? `[${memory.kind}] ` : "";
      return `${index + 1}. ${kind}${memory.title}\n   Date: ${date}\n   ID: ${memory.id}`;
    })
    .join("\n");
}

export function formatFull(memories: MemoryResult[]): string {
  return memories
    .map((memory) => {
      const date = new Date(memory.created_at_epoch).toISOString();
      return `# ${memory.title}\nKind: ${memory.kind}\nDate: ${date}\nID: ${memory.id}\nScore: ${memory.score.toFixed(2)}\n\n${memory.body}`;
    })
    .join("\n\n");
}
