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
