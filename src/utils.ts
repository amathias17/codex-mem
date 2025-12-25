import crypto from "crypto";
import fs from "fs";

export function newId(): string {
  return crypto.randomUUID();
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
