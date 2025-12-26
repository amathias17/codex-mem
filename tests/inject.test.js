const test = require("node:test");
const assert = require("node:assert/strict");

const { buildInjection } = require("../dist/inject.js");
const { approxTokens } = require("../dist/utils.js");

function buildMemory(id, body) {
  return {
    id,
    kind: "note",
    title: `Title ${id}`,
    body,
    project_id: "test-project",
    created_at_epoch: Date.now(),
    updated_at_epoch: Date.now(),
    tags: "[]",
    path_affinity: "[]",
    pinned: 0,
    expires_at_epoch: null,
    score: 0.5
  };
}

test("buildInjection trims output to maxInjectTokens", () => {
  const body = "a".repeat(2000);
  const memories = Array.from({ length: 10 }, (_, index) =>
    buildMemory(`mem-${index}`, body)
  );
  const config = { maxInjectTokens: 2000 };

  const output = buildInjection(config, memories);
  const tokenEstimate = approxTokens(output);
  const sampleCount = (output.match(/^# /gm) || []).length;

  assert.ok(tokenEstimate <= config.maxInjectTokens);
  assert.equal(sampleCount, 3);
});

test("buildInjection includes pinned and glossary sections with stable ordering", () => {
  const now = Date.now();
  const first = buildMemory("a1", "first body");
  const second = buildMemory("a2", "second body");
  const glossary = buildMemory("g1", "glossary body");
  first.created_at_epoch = now - 1000;
  second.created_at_epoch = now;
  glossary.created_at_epoch = now - 500;
  second.pinned = 1;
  glossary.kind = "glossary";

  const output = buildInjection({ maxInjectTokens: 4000 }, [first, second, glossary]);

  const pinnedIndex = output.indexOf("## codex-mem pinned");
  const glossaryIndex = output.indexOf("## codex-mem glossary");
  assert.ok(pinnedIndex !== -1);
  assert.ok(glossaryIndex !== -1);
  assert.ok(pinnedIndex < glossaryIndex);
  assert.ok(output.indexOf("ID: a2") !== -1);
  assert.ok(output.indexOf("ID: g1") !== -1);
});
