import { Config } from "./config";
import { MemoryResult } from "./db";
import { approxTokens } from "./utils";
import { formatFull, formatIndex } from "./format";

export function buildInjection(config: Config, memories: MemoryResult[]): string {
  const items = memories.slice();
  const index = formatIndex(items.slice(0, 20));
  const samples = formatFull(items.slice(0, 5));
  const instructions = "Use `codex-mem retrieve --format full --limit 3` for details on specific IDs.";

  const sections = [
    "## codex-mem index",
    index,
    "\n## codex-mem samples",
    samples,
    "\n## codex-mem instructions",
    instructions
  ];

  let output = sections.join("\n");
  while (approxTokens(output) > config.maxInjectTokens && items.length > 1) {
    items.pop();
    output = [
      "## codex-mem index",
      formatIndex(items.slice(0, 20)),
      "\n## codex-mem samples",
      formatFull(items.slice(0, 3)),
      "\n## codex-mem instructions",
      instructions
    ].join("\n");
  }

  return output;
}
