const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadConfig } = require("../dist/config.js");

function withTempDir(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mem-config-"));
  try {
    return fn(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeConfig(tempDir, contents) {
  const configDir = path.join(tempDir, ".codex-mem");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.toml"), contents, "utf8");
}

test("loadConfig parses toml and applies overrides", () => {
  withTempDir((tempDir) => {
    writeConfig(
      tempDir,
      [
        'project_id = "demo"',
        "max_inject_tokens = 1200",
        "recency_days = 45",
        "auto_inject = true",
        'redaction_patterns = ["foo", "bar"]'
      ].join("\n")
    );

    const config = loadConfig(tempDir);
    assert.equal(config.projectId, "demo");
    assert.equal(config.maxInjectTokens, 1200);
    assert.equal(config.recencyDays, 45);
    assert.equal(config.autoInject, true);
    assert.deepEqual(config.redactionPatterns, ["foo", "bar"]);
  });
});

test("loadConfig rejects unknown keys", () => {
  withTempDir((tempDir) => {
    writeConfig(tempDir, "unknown_key = 1");
    assert.throws(() => loadConfig(tempDir), /Unknown config keys/);
  });
});

test("loadConfig rejects invalid types", () => {
  withTempDir((tempDir) => {
    writeConfig(tempDir, 'max_inject_tokens = "lots"');
    assert.throws(() => loadConfig(tempDir), /max_inject_tokens/);
  });
});
