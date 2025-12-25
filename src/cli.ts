#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { loadConfig, writeDefaultConfig } from "./config";
import { openDb, saveDb, searchMemories, setPinned, compactMemories, purgeExpired } from "./db";
import { runCapturePipeline, logRetrieval, logInjection } from "./pipeline";
import { buildInjection } from "./inject";
import { approxTokens, ensureDir } from "./utils";
import { formatFull, formatIndex } from "./format";

async function withDb<T>(cwd: string, fn: (ctx: Awaited<ReturnType<typeof openDb>>, config: ReturnType<typeof loadConfig>) => Promise<T>): Promise<T> {
  const config = loadConfig(cwd);
  const dbCtx = await openDb(config.dataDir);
  try {
    return await fn(dbCtx, config);
  } finally {
    saveDb(dbCtx);
  }
}

async function initCommand(cwd: string): Promise<void> {
  const configPath = writeDefaultConfig(cwd);
  const config = loadConfig(cwd);
  ensureDir(config.dataDir);
  const dbCtx = await openDb(config.dataDir);
  saveDb(dbCtx);
  const logDir = path.join(config.dataDir, "events");
  ensureDir(logDir);
  const logPath = path.join(logDir, "events.log");
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, "", "utf8");
  }
  console.log(`Initialized codex-mem at ${configPath}`);
}

async function main(): Promise<void> {
  const program = new Command();
  program.name("codex-mem").description("Codex memory CLI");

  program
    .command("init")
    .description("Initialize codex-mem in this repo")
    .action(async () => {
      await initCommand(process.cwd());
    });

  program
    .command("capture")
    .description("Capture a memory item")
    .requiredOption("--kind <kind>")
    .requiredOption("--title <title>")
    .requiredOption("--body <body>")
    .option("--tag <tag>", "Tag", (value, prev) => {
      const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
      list.push(value);
      return list;
    })
    .option("--path <path>")
    .action(async (opts) => {
      await withDb(process.cwd(), async (db, config) => {
        const tags = (opts.tag as string[]) || [];
        const pathAffinity = opts.path ? [String(opts.path)] : [];
        const id = runCapturePipeline({
          config,
          db,
          kind: String(opts.kind),
          title: String(opts.title),
          body: String(opts.body),
          tags,
          pathAffinity
        });
        console.log(id);
      });
    });

  program
    .command("retrieve <query>")
    .description("Retrieve memories matching a query")
    .option("--path <path>")
    .option("--limit <limit>", "Limit", "10")
    .option("--format <format>", "Format: index|full", "index")
    .option("--json", "Output JSON")
    .action(async (query, opts) => {
      await withDb(process.cwd(), async (db, config) => {
        const results = searchMemories(db, {
          query: String(query),
          projectId: config.projectId,
          limit: Number(opts.limit),
          path: opts.path ? String(opts.path) : undefined,
          recencyDays: config.recencyDays
        });
        logRetrieval(config, String(query), results.length);
        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }
        const format = String(opts.format || "index");
        if (format === "full") {
          console.log(formatFull(results));
          return;
        }
        console.log(formatIndex(results));
      });
    });

  program
    .command("inject")
    .description("Generate injection snippet for Codex")
    .requiredOption("--query <query>")
    .option("--path <path>")
    .option("--limit <limit>", "Limit", "20")
    .action(async (opts) => {
      await withDb(process.cwd(), async (db, config) => {
        const results = searchMemories(db, {
          query: String(opts.query),
          projectId: config.projectId,
          limit: Number(opts.limit),
          path: opts.path ? String(opts.path) : undefined,
          recencyDays: config.recencyDays
        });
        const output = buildInjection(config, results);
        logInjection(config, approxTokens(output), results.length);
        console.log(output);
      });
    });

  program
    .command("pin <id>")
    .description("Pin a memory")
    .action(async (id) => {
      await withDb(process.cwd(), async (db) => {
        setPinned(db, String(id), true);
      });
    });

  program
    .command("unpin <id>")
    .description("Unpin a memory")
    .action(async (id) => {
      await withDb(process.cwd(), async (db) => {
        setPinned(db, String(id), false);
      });
    });

  program
    .command("compact")
    .description("Compact older observations into a summary")
    .option("--older-than <days>", "Days", "30")
    .option("--limit <count>", "Limit", "20")
    .action(async (opts) => {
      await withDb(process.cwd(), async (db, config) => {
        const result = compactMemories(db, {
          projectId: config.projectId,
          olderThanDays: Number(opts.olderThan),
          limit: Number(opts.limit)
        });
        if (result.summaryId) {
          console.log(`summary=${result.summaryId} compacted=${result.compactedIds.length}`);
        } else {
          console.log("no observations eligible for compaction");
        }
      });
    });

  program
    .command("purge")
    .description("Purge expired memories")
    .action(async () => {
      await withDb(process.cwd(), async (db) => {
        const count = purgeExpired(db);
        console.log(`purged=${count}`);
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
