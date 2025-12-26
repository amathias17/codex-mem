import { Config } from "./config";
import { MemoryResult } from "./db";
import { approxTokens } from "./utils";
import { formatFull, formatIndex } from "./format";

function stableByCreated(items: MemoryResult[]): MemoryResult[] {
  return items.slice().sort((a, b) => {
    const byDate = b.created_at_epoch - a.created_at_epoch;
    if (byDate !== 0) {
      return byDate;
    }
    return a.id.localeCompare(b.id);
  });
}

export function buildInjection(config: Config, memories: MemoryResult[]): string {
  const items = memories.slice();
  let indexLimit = 20;
  let sampleLimit = 5;
  let pinnedLimit = 5;
  let glossaryLimit = 5;
  const instructions = "Use `codex-mem retrieve --format full --limit 3` for details on specific IDs.";

  const buildSections = (): string => {
    const pinned = stableByCreated(items.filter((item) => item.pinned === 1)).slice(0, pinnedLimit);
    const glossary = stableByCreated(
      items.filter((item) => item.kind === "glossary" && item.pinned !== 1)
    ).slice(0, glossaryLimit);
    const index = formatIndex(items.slice(0, indexLimit));
    const samples = formatFull(items.slice(0, sampleLimit));

    const sections = [
      "## codex-mem index",
      index
    ];

    if (pinned.length) {
      sections.push("\n## codex-mem pinned", formatFull(pinned));
    }

    if (glossary.length) {
      sections.push("\n## codex-mem glossary", formatFull(glossary));
    }

    sections.push("\n## codex-mem samples", samples);
    sections.push("\n## codex-mem instructions", instructions);
    return sections.join("\n");
  };

  let output = buildSections();
  while (approxTokens(output) > config.maxInjectTokens && items.length > 1) {
    let adjusted = false;
    if (sampleLimit > 3) {
      sampleLimit = 3;
      adjusted = true;
    } else if (indexLimit > 10) {
      indexLimit = 10;
      adjusted = true;
    } else if (pinnedLimit > 3) {
      pinnedLimit = 3;
      adjusted = true;
    } else if (glossaryLimit > 3) {
      glossaryLimit = 3;
      adjusted = true;
    } else if (sampleLimit > 1) {
      sampleLimit = 1;
      adjusted = true;
    } else if (indexLimit > 5) {
      indexLimit = 5;
      adjusted = true;
    } else if (pinnedLimit > 1) {
      pinnedLimit = 1;
      adjusted = true;
    } else if (glossaryLimit > 1) {
      glossaryLimit = 1;
      adjusted = true;
    }

    if (!adjusted) {
      items.pop();
    }
    output = buildSections();
  }

  return output;
}
