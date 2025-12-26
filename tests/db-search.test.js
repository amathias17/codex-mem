const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  openDb,
  insertMemory,
  setPinned,
  searchMemories
} = require("../dist/db.js");

test("searchMemories ranks pinned items higher when content is identical", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mem-test-"));
  const ctx = await openDb(tempDir);
  try {
    const projectId = "test-project";
    const base = {
      kind: "note",
      title: "Shared title",
      body: "shared body content",
      projectId,
      tags: ["alpha"],
      pathAffinity: []
    };

    const firstId = insertMemory(ctx, base);
    const secondId = insertMemory(ctx, base);
    setPinned(ctx, secondId, true);

    const now = Date.now();
    ctx.db.run("UPDATE memories SET created_at_epoch = ?, updated_at_epoch = ? WHERE id = ?;", [
      now,
      now,
      firstId
    ]);
    ctx.db.run("UPDATE memories SET created_at_epoch = ?, updated_at_epoch = ? WHERE id = ?;", [
      now,
      now,
      secondId
    ]);

    const results = searchMemories(ctx, {
      query: "shared",
      projectId,
      limit: 10,
      recencyDays: 30
    });

    assert.equal(results.length >= 2, true);
    assert.equal(results[0].id, secondId);
  } finally {
    ctx.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("searchMemories falls back to embeddings with recency filtering", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mem-test-"));
  const ctx = await openDb(tempDir);
  ctx.ftsEnabled = false;
  try {
    const projectId = "test-project";
    const recentId = insertMemory(ctx, {
      kind: "note",
      title: "Alpha recent",
      body: "alpha content",
      projectId,
      tags: [],
      pathAffinity: []
    });
    const oldId = insertMemory(ctx, {
      kind: "note",
      title: "Alpha old",
      body: "alpha content",
      projectId,
      tags: [],
      pathAffinity: []
    });

    const now = Date.now();
    const oldEpoch = now - 100 * 24 * 60 * 60 * 1000;
    ctx.db.run("UPDATE memories SET created_at_epoch = ?, updated_at_epoch = ? WHERE id = ?;", [
      now,
      now,
      recentId
    ]);
    ctx.db.run("UPDATE memories SET created_at_epoch = ?, updated_at_epoch = ? WHERE id = ?;", [
      oldEpoch,
      oldEpoch,
      oldId
    ]);

    const results = searchMemories(ctx, {
      query: "alpha",
      projectId,
      limit: 10,
      recencyDays: 30
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].id, recentId);
  } finally {
    ctx.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
