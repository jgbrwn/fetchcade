import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CACHEABLE_GAME_BYTES,
  isCacheableGameSize,
  normalizeGameSize,
} from "../src/cache.mjs";

test("normalizes cache sizes and enforces the per-game cache limit", () => {
  assert.equal(normalizeGameSize("524288000"), 524288000);
  assert.equal(normalizeGameSize(0), null);
  assert.equal(normalizeGameSize("unknown"), null);
  assert.equal(isCacheableGameSize(MAX_CACHEABLE_GAME_BYTES), true);
  assert.equal(isCacheableGameSize(MAX_CACHEABLE_GAME_BYTES + 1), false);
  assert.equal(isCacheableGameSize(null), false);
});
