import fs from "fs";
import path from "path";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import { cosineSimilarity, embedText } from "./embeddings";
import { ensureDir, newId, safeJsonParse } from "./utils";

export type DbContext = {
  SQL: SqlJsStatic;
  db: Database;
  dbPath: string;
  ftsEnabled: boolean;
};

export type MemoryRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  project_id: string;
  created_at_epoch: number;
  updated_at_epoch: number;
  tags: string;
  path_affinity: string;
  pinned: number;
  expires_at_epoch: number | null;
};

export type MemoryResult = MemoryRow & {
  score: number;
};

export type SessionRow = {
  id: string;
  codex_session_id: string | null;
  project_id: string;
  status: string;
  started_at_epoch: number;
  ended_at_epoch: number | null;
};

export type UserPromptRow = {
  id: string;
  session_id: string;
  project_id: string;
  prompt_text: string;
  prompt_number: number;
  created_at_epoch: number;
};

export type ObservationRow = {
  id: string;
  session_id: string;
  project_id: string;
  type: string;
  title: string;
  body: string;
  tags: string;
  files_read: string;
  files_modified: string;
  prompt_number: number;
  created_at_epoch: number;
};

export type SessionSummaryRow = {
  id: string;
  session_id: string;
  project_id: string;
  title: string;
  body: string;
  prompt_number: number;
  created_at_epoch: number;
};

export async function openDb(dataDir: string): Promise<DbContext> {
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, "mem.db");
  const wasmDir = path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(wasmDir, file)
  });

  let db: Database;
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  const ftsEnabled = ensureSchema(db);
  return { SQL, db, dbPath, ftsEnabled };
}

export function saveDb(ctx: DbContext): void {
  const data = ctx.db.export();
  fs.writeFileSync(ctx.dbPath, Buffer.from(data));
}

function ensureSchema(db: Database): boolean {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      project_id TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      updated_at_epoch INTEGER NOT NULL,
      tags TEXT NOT NULL,
      path_affinity TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      expires_at_epoch INTEGER
    );

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id TEXT PRIMARY KEY,
      embedding TEXT NOT NULL,
      updated_at_epoch INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      codex_session_id TEXT,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at_epoch INTEGER NOT NULL,
      ended_at_epoch INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_prompts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      prompt_number INTEGER NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT NOT NULL,
      files_read TEXT NOT NULL,
      files_modified TEXT NOT NULL,
      prompt_number INTEGER NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_summaries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      prompt_number INTEGER NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );
  `);

  let ftsEnabled = true;
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
      USING fts5(title, body, tags, content='memories', content_rowid='rowid');

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body, tags)
        VALUES('delete', old.rowid, old.title, old.body, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body, tags)
        VALUES('delete', old.rowid, old.title, old.body, old.tags);
        INSERT INTO memories_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, new.tags);
      END;

      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts
      USING fts5(title, body, tags, content='observations', content_rowid='rowid');

      CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, body, tags)
        VALUES('delete', old.rowid, old.title, old.body, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, body, tags)
        VALUES('delete', old.rowid, old.title, old.body, old.tags);
        INSERT INTO observations_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, new.tags);
      END;

      CREATE VIRTUAL TABLE IF NOT EXISTS session_summaries_fts
      USING fts5(title, body, content='session_summaries', content_rowid='rowid');

      CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, title, body)
        VALUES('delete', old.rowid, old.title, old.body);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_au AFTER UPDATE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, title, body)
        VALUES('delete', old.rowid, old.title, old.body);
        INSERT INTO session_summaries_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
      END;

      CREATE VIRTUAL TABLE IF NOT EXISTS user_prompts_fts
      USING fts5(prompt_text, content='user_prompts', content_rowid='rowid');

      CREATE TRIGGER IF NOT EXISTS user_prompts_ai AFTER INSERT ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.rowid, new.prompt_text);
      END;

      CREATE TRIGGER IF NOT EXISTS user_prompts_ad AFTER DELETE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.rowid, old.prompt_text);
      END;

      CREATE TRIGGER IF NOT EXISTS user_prompts_au AFTER UPDATE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.rowid, old.prompt_text);
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.rowid, new.prompt_text);
      END;
    `);
  } catch {
    ftsEnabled = false;
  }

  return ftsEnabled;
}

function buildEmbeddingText(title: string, body: string): string {
  return `${title}\n${body}`;
}

function upsertMemoryEmbedding(ctx: DbContext, memoryId: string, title: string, body: string): void {
  const embedding = embedText(buildEmbeddingText(title, body));
  const stmt = ctx.db.prepare(`
    INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, updated_at_epoch)
    VALUES (?, ?, ?);
  `);
  stmt.run([memoryId, JSON.stringify(embedding), Date.now()]);
  stmt.free();
}

export function insertMemory(ctx: DbContext, input: {
  kind: string;
  title: string;
  body: string;
  projectId: string;
  tags: string[];
  pathAffinity: string[];
}): string {
  const id = newId();
  const now = Date.now();
  const stmt = ctx.db.prepare(`
    INSERT INTO memories (
      id, kind, title, body, project_id, created_at_epoch, updated_at_epoch, tags, path_affinity, pinned
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0);
  `);
  stmt.run([
    id,
    input.kind,
    input.title,
    input.body,
    input.projectId,
    now,
    now,
    JSON.stringify(input.tags || []),
    JSON.stringify(input.pathAffinity || [])
  ]);
  stmt.free();
  upsertMemoryEmbedding(ctx, id, input.title, input.body);
  return id;
}

export function setPinned(ctx: DbContext, id: string, pinned: boolean): void {
  const stmt = ctx.db.prepare("UPDATE memories SET pinned = ?, updated_at_epoch = ? WHERE id = ?;");
  stmt.run([pinned ? 1 : 0, Date.now(), id]);
  stmt.free();
}

export function searchMemories(ctx: DbContext, input: {
  query: string;
  projectId: string;
  limit: number;
  path?: string;
  recencyDays: number;
}): MemoryResult[] {
  const now = Date.now();
  const expiresClause = "(expires_at_epoch IS NULL OR expires_at_epoch > ?)";
  let rows: Array<MemoryRow & { rank?: number }> = [];
  let mode: "fts" | "embedding" | "like" | "recent" = "recent";

  if (input.query && ctx.ftsEnabled) {
    const stmt = ctx.db.prepare(`
      SELECT m.*, bm25(memories_fts) as rank
      FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ? AND m.project_id = ? AND ${expiresClause}
      ORDER BY rank ASC
      LIMIT ?;
    `);
    stmt.bind([input.query, input.projectId, now, input.limit]);
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as MemoryRow & { rank?: number });
    }
    stmt.free();
    if (rows.length) {
      mode = "fts";
    }
  }

  if (input.query && mode !== "fts") {
    const recencyCutoff = now - input.recencyDays * 24 * 60 * 60 * 1000;
    const scanLimit = Math.max(input.limit * 10, 50);
    const stmt = ctx.db.prepare(`
      SELECT *
      FROM memories
      WHERE project_id = ? AND ${expiresClause} AND created_at_epoch >= ?
      ORDER BY created_at_epoch DESC
      LIMIT ?;
    `);
    stmt.bind([input.projectId, now, recencyCutoff, scanLimit]);
    const candidates: MemoryRow[] = [];
    while (stmt.step()) {
      candidates.push(stmt.getAsObject() as MemoryRow);
    }
    stmt.free();

    if (candidates.length) {
      const queryEmbedding = embedText(input.query);
      const selectEmbedding = ctx.db.prepare("SELECT embedding FROM memory_embeddings WHERE memory_id = ?;");
      const insertEmbedding = ctx.db.prepare(`
        INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, updated_at_epoch)
        VALUES (?, ?, ?);
      `);

      try {
        for (const row of candidates) {
          let embedding: number[] | null = null;
          selectEmbedding.bind([row.id]);
          if (selectEmbedding.step()) {
            const stored = selectEmbedding.getAsObject() as { embedding?: string };
            if (typeof stored.embedding === "string") {
              try {
                const parsed = JSON.parse(stored.embedding) as number[];
                if (Array.isArray(parsed)) {
                  embedding = parsed;
                }
              } catch {
                embedding = null;
              }
            }
          }
          selectEmbedding.reset();

          if (!embedding) {
            embedding = embedText(buildEmbeddingText(row.title, row.body));
            insertEmbedding.run([row.id, JSON.stringify(embedding), Date.now()]);
          }

          const similarity = cosineSimilarity(queryEmbedding, embedding);
          rows.push({ ...row, rank: similarity });
        }

        rows.sort((a, b) => (b.rank || 0) - (a.rank || 0));
        rows = rows.slice(0, input.limit);
        mode = "embedding";
      } finally {
        selectEmbedding.free();
        insertEmbedding.free();
      }
    }
  }

  if (input.query && mode !== "fts" && mode !== "embedding") {
    const like = `%${input.query}%`;
    const stmt = ctx.db.prepare(`
      SELECT *
      FROM memories
      WHERE project_id = ? AND ${expiresClause} AND (title LIKE ? OR body LIKE ?)
      ORDER BY created_at_epoch DESC
      LIMIT ?;
    `);
    stmt.bind([input.projectId, now, like, like, input.limit]);
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as MemoryRow);
    }
    stmt.free();
    mode = "like";
  } else if (!input.query) {
    const stmt = ctx.db.prepare(`
      SELECT *
      FROM memories
      WHERE project_id = ? AND ${expiresClause}
      ORDER BY created_at_epoch DESC
      LIMIT ?;
    `);
    stmt.bind([input.projectId, now, input.limit]);
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as MemoryRow);
    }
    stmt.free();
    mode = "recent";
  }

  let minRank = 0;
  let range = 1;
  if (mode === "fts") {
    const ranks = rows
      .map((row) => row.rank)
      .filter((rank): rank is number => typeof rank === "number");
    minRank = ranks.length ? Math.min(...ranks) : 0;
    const maxRank = ranks.length ? Math.max(...ranks) : 1;
    range = maxRank - minRank || 1;
  }

  return rows.map((row) => {
    let baseScore = 0.5;
    if (mode === "fts") {
      baseScore = typeof row.rank === "number" ? 1 - (row.rank - minRank) / range : 0.5;
    } else if (mode === "embedding") {
      baseScore = typeof row.rank === "number" ? row.rank : 0;
    }
    const tags = safeJsonParse<string[]>(row.tags, []);
    const pathAffinity = safeJsonParse<string[]>(row.path_affinity, []);
    const isPinned = row.pinned === 1;
    const pathBoost = input.path && pathAffinity.some((p) => input.path?.includes(p)) ? 0.2 : 0;
    const ageDays = (now - row.created_at_epoch) / (1000 * 60 * 60 * 24);
    const recencyBoost = Math.exp(-ageDays / input.recencyDays) * 0.3;
    const tagBoost = tags.length ? 0.05 : 0;
    const pinnedBoost = isPinned ? 0.4 : 0;

    const score = baseScore + pathBoost + recencyBoost + tagBoost + pinnedBoost;
    return { ...row, score };
  }).sort((a, b) => b.score - a.score);
}

export function compactMemories(ctx: DbContext, input: {
  projectId: string;
  olderThanDays: number;
  limit: number;
}): { summaryId: string; compactedIds: string[] } {
  const cutoff = Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000;
  const stmt = ctx.db.prepare(`
    SELECT * FROM memories
    WHERE project_id = ? AND created_at_epoch < ? AND kind = 'observation'
    ORDER BY created_at_epoch ASC
    LIMIT ?;
  `);
  stmt.bind([input.projectId, cutoff, input.limit]);
  const rows: MemoryRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as MemoryRow);
  }
  stmt.free();

  if (!rows.length) {
    return { summaryId: "", compactedIds: [] };
  }

  const summaryBody = rows.map((row) => `- ${row.title}: ${row.body}`).join("\n");
  const summaryId = insertMemory(ctx, {
    kind: "summary",
    title: `Summary of ${rows.length} observations`,
    body: summaryBody,
    projectId: input.projectId,
    tags: ["summary"],
    pathAffinity: []
  });

  const expireStmt = ctx.db.prepare("UPDATE memories SET expires_at_epoch = ? WHERE id = ?;");
  const now = Date.now();
  for (const row of rows) {
    expireStmt.run([now, row.id]);
  }
  expireStmt.free();

  return { summaryId, compactedIds: rows.map((row) => row.id) };
}

export function purgeExpired(ctx: DbContext): number {
  const stmt = ctx.db.prepare("DELETE FROM memories WHERE expires_at_epoch IS NOT NULL AND expires_at_epoch <= ?;");
  stmt.run([Date.now()]);
  const changes = ctx.db.getRowsModified();
  stmt.free();
  return changes;
}

export function insertSession(ctx: DbContext, input: {
  codexSessionId?: string;
  projectId: string;
  status?: string;
  startedAtEpoch?: number;
}): string {
  const id = newId();
  const stmt = ctx.db.prepare(`
    INSERT INTO sessions (
      id, codex_session_id, project_id, status, started_at_epoch
    ) VALUES (?, ?, ?, ?, ?);
  `);
  stmt.run([
    id,
    input.codexSessionId || null,
    input.projectId,
    input.status || "active",
    input.startedAtEpoch || Date.now()
  ]);
  stmt.free();
  return id;
}

export function updateSessionStatus(ctx: DbContext, input: {
  sessionId: string;
  status: string;
  endedAtEpoch?: number;
}): void {
  const stmt = ctx.db.prepare(`
    UPDATE sessions
    SET status = ?, ended_at_epoch = ?
    WHERE id = ?;
  `);
  stmt.run([
    input.status,
    input.endedAtEpoch || Date.now(),
    input.sessionId
  ]);
  stmt.free();
}

export function insertUserPrompt(ctx: DbContext, input: {
  sessionId: string;
  projectId: string;
  promptText: string;
  promptNumber: number;
  createdAtEpoch?: number;
}): string {
  const id = newId();
  const stmt = ctx.db.prepare(`
    INSERT INTO user_prompts (
      id, session_id, project_id, prompt_text, prompt_number, created_at_epoch
    ) VALUES (?, ?, ?, ?, ?, ?);
  `);
  stmt.run([
    id,
    input.sessionId,
    input.projectId,
    input.promptText,
    input.promptNumber,
    input.createdAtEpoch || Date.now()
  ]);
  stmt.free();
  return id;
}

export function insertObservation(ctx: DbContext, input: {
  sessionId: string;
  projectId: string;
  type: string;
  title: string;
  body: string;
  tags: string[];
  filesRead: string[];
  filesModified: string[];
  promptNumber: number;
  createdAtEpoch?: number;
}): string {
  const id = newId();
  const stmt = ctx.db.prepare(`
    INSERT INTO observations (
      id, session_id, project_id, type, title, body, tags, files_read, files_modified, prompt_number, created_at_epoch
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);
  stmt.run([
    id,
    input.sessionId,
    input.projectId,
    input.type,
    input.title,
    input.body,
    JSON.stringify(input.tags || []),
    JSON.stringify(input.filesRead || []),
    JSON.stringify(input.filesModified || []),
    input.promptNumber,
    input.createdAtEpoch || Date.now()
  ]);
  stmt.free();
  return id;
}

export function insertSessionSummary(ctx: DbContext, input: {
  sessionId: string;
  projectId: string;
  title: string;
  body: string;
  promptNumber: number;
  createdAtEpoch?: number;
}): string {
  const id = newId();
  const stmt = ctx.db.prepare(`
    INSERT INTO session_summaries (
      id, session_id, project_id, title, body, prompt_number, created_at_epoch
    ) VALUES (?, ?, ?, ?, ?, ?, ?);
  `);
  stmt.run([
    id,
    input.sessionId,
    input.projectId,
    input.title,
    input.body,
    input.promptNumber,
    input.createdAtEpoch || Date.now()
  ]);
  stmt.free();
  return id;
}

export function listObservations(ctx: DbContext, input: {
  projectId?: string;
  limit: number;
  offset: number;
}): ObservationRow[] {
  const rows: ObservationRow[] = [];
  let stmt;
  if (input.projectId) {
    stmt = ctx.db.prepare(`
      SELECT *
      FROM observations
      WHERE project_id = ?
      ORDER BY created_at_epoch DESC
      LIMIT ? OFFSET ?;
    `);
    stmt.bind([input.projectId, input.limit, input.offset]);
  } else {
    stmt = ctx.db.prepare(`
      SELECT *
      FROM observations
      ORDER BY created_at_epoch DESC
      LIMIT ? OFFSET ?;
    `);
    stmt.bind([input.limit, input.offset]);
  }
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as ObservationRow);
  }
  stmt.free();
  return rows;
}

export function getObservation(ctx: DbContext, id: string): ObservationRow | null {
  const stmt = ctx.db.prepare("SELECT * FROM observations WHERE id = ?;");
  stmt.bind([id]);
  let row: ObservationRow | null = null;
  if (stmt.step()) {
    row = stmt.getAsObject() as ObservationRow;
  }
  stmt.free();
  return row;
}

export function listSessionSummaries(ctx: DbContext, input: {
  projectId?: string;
  limit: number;
  offset: number;
}): SessionSummaryRow[] {
  const rows: SessionSummaryRow[] = [];
  let stmt;
  if (input.projectId) {
    stmt = ctx.db.prepare(`
      SELECT *
      FROM session_summaries
      WHERE project_id = ?
      ORDER BY created_at_epoch DESC
      LIMIT ? OFFSET ?;
    `);
    stmt.bind([input.projectId, input.limit, input.offset]);
  } else {
    stmt = ctx.db.prepare(`
      SELECT *
      FROM session_summaries
      ORDER BY created_at_epoch DESC
      LIMIT ? OFFSET ?;
    `);
    stmt.bind([input.limit, input.offset]);
  }
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as SessionSummaryRow);
  }
  stmt.free();
  return rows;
}

export function listProjects(ctx: DbContext): string[] {
  const rows: string[] = [];
  const stmt = ctx.db.prepare(`
    SELECT DISTINCT project_id FROM observations
    UNION
    SELECT DISTINCT project_id FROM session_summaries
    UNION
    SELECT DISTINCT project_id FROM user_prompts
    ORDER BY project_id ASC;
  `);
  while (stmt.step()) {
    const row = stmt.getAsObject() as { project_id?: string };
    if (row.project_id) {
      rows.push(row.project_id);
    }
  }
  stmt.free();
  return rows;
}
