import { Config } from "./config";

export type CompressionInput = {
  type?: string;
  title?: string;
  body: string;
  tags?: string[];
  filesRead?: string[];
  filesModified?: string[];
};

export type CompressionOutput = {
  type: string;
  title: string;
  body: string;
  tags: string[];
  filesRead: string[];
  filesModified: string[];
  stats: {
    inputChars: number;
    outputChars: number;
    compressor: string;
  };
};

const TAG_RULES: Array<{ regex: RegExp; tag: string }> = [
  { regex: /\bfix|bug|error|failure\b/i, tag: "bug" },
  { regex: /\brefactor|cleanup|restructure\b/i, tag: "refactor" },
  { regex: /\btest|assert|spec\b/i, tag: "test" },
  { regex: /\bperf|performance|optimi[sz]e\b/i, tag: "perf" },
  { regex: /\bdoc|readme|docs\b/i, tag: "docs" },
  { regex: /\bconfig|settings\b/i, tag: "config" }
];

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function compressBody(body: string, maxChars: number): string {
  const normalized = normalizeWhitespace(body);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function inferType(input: CompressionInput, tags: string[]): string {
  if (input.type && input.type.trim()) {
    return input.type.trim();
  }
  if (tags.includes("bug")) {
    return "bugfix";
  }
  if (tags.includes("refactor")) {
    return "refactor";
  }
  if (tags.includes("test")) {
    return "test";
  }
  if (tags.includes("config")) {
    return "change";
  }
  return "discovery";
}

function inferTitle(input: CompressionInput, body: string): string {
  if (input.title && input.title.trim()) {
    return input.title.trim();
  }
  if (body) {
    return body.split(".")[0].slice(0, 80) || "Observation";
  }
  return "Observation";
}

function mergeTags(inputTags: string[] | undefined, body: string, title: string): string[] {
  const tags = new Set<string>();
  for (const tag of inputTags || []) {
    if (tag && typeof tag === "string") {
      tags.add(tag);
    }
  }
  for (const rule of TAG_RULES) {
    if (rule.regex.test(body) || rule.regex.test(title)) {
      tags.add(rule.tag);
    }
  }
  return Array.from(tags).slice(0, 8);
}

export function compressObservation(input: CompressionInput, config: Config): CompressionOutput {
  const maxChars = Number(process.env.CODEX_MEM_MAX_OBSERVATION_CHARS || 800);
  const body = compressBody(input.body || "", maxChars);
  const title = inferTitle(input, body);
  const tags = mergeTags(input.tags, body, title);
  const type = inferType(input, tags);
  const filesRead = input.filesRead || [];
  const filesModified = input.filesModified || [];

  return {
    type,
    title,
    body,
    tags,
    filesRead,
    filesModified,
    stats: {
      inputChars: (input.body || "").length,
      outputChars: body.length,
      compressor: "heuristic"
    }
  };
}
