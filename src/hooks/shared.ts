import fs from "fs";

export type HookInput = Record<string, unknown>;

export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

export async function readJsonInput(): Promise<HookInput> {
  const raw = await readStdin();
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    return {};
  }
}

export function getValue(input: HookInput, key: string, envKey?: string): string | undefined {
  const direct = input[key];
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }
  const envValue = envKey ? process.env[envKey] : undefined;
  if (envValue && envValue.trim()) {
    return envValue;
  }
  return undefined;
}

export function getNumber(input: HookInput, key: string, envKey?: string): number | undefined {
  const direct = input[key];
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct;
  }
  const envValue = envKey ? process.env[envKey] : undefined;
  if (envValue && /^-?\d+$/.test(envValue)) {
    return Number(envValue);
  }
  return undefined;
}

export async function postJson(path: string, payload: unknown): Promise<unknown> {
  const baseUrl = process.env.CODEX_MEM_URL || "http://localhost:37777";
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`codex-mem hook failed: ${res.status} ${text}`);
  }
  return res.json();
}

export function writeOutput(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function ensureInput(input: HookInput, keys: string[]): void {
  const missing = keys.filter((key) => input[key] === undefined);
  if (missing.length) {
    throw new Error(`missing required fields: ${missing.join(", ")}`);
  }
}

export function hasFile(pathname: string): boolean {
  return fs.existsSync(pathname);
}
