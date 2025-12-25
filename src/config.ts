import fs from "fs";
import path from "path";

export type Config = {
  projectId: string;
  dataDir: string;
  maxInjectTokens: number;
  recencyDays: number;
  autoInject: boolean;
  redactionPatterns: string[];
};

const DEFAULT_CONFIG: Omit<Config, "dataDir"> = {
  projectId: path.basename(process.cwd()),
  maxInjectTokens: 1500,
  recencyDays: 90,
  autoInject: false,
  redactionPatterns: [
    "api[_-]?key\\s*[:=]\\s*[^\\s]+",
    "secret\\s*[:=]\\s*[^\\s]+",
    "token\\s*[:=]\\s*[^\\s]+",
    "[A-Za-z0-9_-]{24,}"
  ]
};

const CONFIG_FILE = "config.toml";

function parseTomlValue(raw: string): string | number | boolean | string[] {
  const trimmed = raw.trim();
  if (trimmed === "true" || trimmed === "false") {
    return trimmed === "true";
  }
  if (/^-?\\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(",")
      .map((part) => part.trim())
      .map((part) => part.replace(/^\"|\"$/g, ""));
  }
  return trimmed.replace(/^\"|\"$/g, "");
}

export function loadConfig(cwd: string): Config {
  const dataDir = path.join(cwd, ".codex-mem");
  const configPath = path.join(dataDir, CONFIG_FILE);
  const base: Config = { ...DEFAULT_CONFIG, dataDir };

  if (!fs.existsSync(configPath)) {
    return base;
  }

  const content = fs.readFileSync(configPath, "utf8");
  const lines = content.split(/\r?\n/);
  const parsed: Record<string, string | number | boolean | string[]> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    parsed[key] = parseTomlValue(value);
  }

  return {
    projectId: (parsed.project_id as string) || base.projectId,
    dataDir,
    maxInjectTokens: (parsed.max_inject_tokens as number) || base.maxInjectTokens,
    recencyDays: (parsed.recency_days as number) || base.recencyDays,
    autoInject: (parsed.auto_inject as boolean) ?? base.autoInject,
    redactionPatterns: (parsed.redaction_patterns as string[]) || base.redactionPatterns
  };
}

export function writeDefaultConfig(cwd: string): string {
  const dataDir = path.join(cwd, ".codex-mem");
  const configPath = path.join(dataDir, CONFIG_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const content = [
    `project_id = "${DEFAULT_CONFIG.projectId}"`,
    `max_inject_tokens = ${DEFAULT_CONFIG.maxInjectTokens}`,
    `recency_days = ${DEFAULT_CONFIG.recencyDays}`,
    `auto_inject = ${DEFAULT_CONFIG.autoInject}`,
    `redaction_patterns = [${DEFAULT_CONFIG.redactionPatterns
      .map((p) => `"${p}"`)
      .join(", ")}]`
  ].join("\n");

  fs.writeFileSync(configPath, content, "utf8");
  return configPath;
}
