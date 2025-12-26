import fs from "fs";
import path from "path";
import { load } from "js-toml";

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
const KNOWN_KEYS = new Set([
  "project_id",
  "max_inject_tokens",
  "recency_days",
  "auto_inject",
  "redaction_patterns"
]);

function parseConfigOverrides(raw: unknown, configPath: string): Partial<Config> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Config file ${configPath} must contain a TOML table at the root.`);
  }
  const data = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(data).filter((key) => !KNOWN_KEYS.has(key));
  if (unknownKeys.length) {
    throw new Error(`Unknown config keys in ${configPath}: ${unknownKeys.join(", ")}`);
  }

  const overrides: Partial<Config> = {};
  if ("project_id" in data) {
    const value = data.project_id;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`config project_id must be a non-empty string.`);
    }
    overrides.projectId = value;
  }

  if ("max_inject_tokens" in data) {
    const value = data.max_inject_tokens;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`config max_inject_tokens must be a positive number.`);
    }
    overrides.maxInjectTokens = value;
  }

  if ("recency_days" in data) {
    const value = data.recency_days;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`config recency_days must be a positive number.`);
    }
    overrides.recencyDays = value;
  }

  if ("auto_inject" in data) {
    const value = data.auto_inject;
    if (typeof value !== "boolean") {
      throw new Error(`config auto_inject must be true or false.`);
    }
    overrides.autoInject = value;
  }

  if ("redaction_patterns" in data) {
    const value = data.redaction_patterns;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`config redaction_patterns must be an array of strings.`);
    }
    overrides.redactionPatterns = value;
  }

  return overrides;
}

export function loadConfig(cwd: string): Config {
  const dataDir = path.join(cwd, ".codex-mem");
  const configPath = path.join(dataDir, CONFIG_FILE);
  const base: Config = { ...DEFAULT_CONFIG, dataDir };

  if (!fs.existsSync(configPath)) {
    return base;
  }

  const content = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = load(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${configPath}: ${message}`);
  }
  const overrides = parseConfigOverrides(parsed, configPath);

  return {
    projectId: overrides.projectId || base.projectId,
    dataDir,
    maxInjectTokens: overrides.maxInjectTokens || base.maxInjectTokens,
    recencyDays: overrides.recencyDays || base.recencyDays,
    autoInject: overrides.autoInject ?? base.autoInject,
    redactionPatterns: overrides.redactionPatterns || base.redactionPatterns
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
      .map((p) => `'${p.replace(/'/g, "''")}'`)
      .join(", ")}]`
  ].join("\n");

  fs.writeFileSync(configPath, content, "utf8");
  return configPath;
}
