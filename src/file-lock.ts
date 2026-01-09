import { promises as fs } from "fs";
import path from "path";

export interface FileLockOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
  staleMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_STALE_MS = 30000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isLockStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function withFileLock<T>(
  filePath: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const start = Date.now();

  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        const metadata = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() });
        await handle.writeFile(metadata, "utf8");
      } catch {
        // Best-effort metadata only.
      }
      try {
        return await operation();
      } finally {
        await handle.close().catch(() => undefined);
        await fs.unlink(lockPath).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for lock: ${lockPath}`);
      }
      if (await isLockStale(lockPath, staleMs)) {
        await fs.unlink(lockPath).catch((unlinkError) => {
          if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
            throw unlinkError;
          }
        });
        continue;
      }
      await delay(retryDelayMs);
    }
  }
}
