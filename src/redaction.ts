import { Config } from "./config";

export function redactText(text: string, config: Config): string {
  let output = text;
  for (const pattern of config.redactionPatterns) {
    try {
      const regex = new RegExp(pattern, "gi");
      output = output.replace(regex, "[REDACTED]");
    } catch {
      continue;
    }
  }
  return output;
}

export function stripTags(text: string): string {
  return text.replace(/<private>[\s\S]*?<\/private>/gi, "").replace(/<codex-mem-context>[\s\S]*?<\/codex-mem-context>/gi, "");
}
