import assert from "node:assert/strict";

import {
  migrateConfig,
  normalizeRandomTagPoolPickCount,
  sampleRandomTagPool,
} from "../src/config.js";

assert.equal(normalizeRandomTagPoolPickCount(undefined), 2);
assert.equal(normalizeRandomTagPoolPickCount("3"), 3);
assert.equal(normalizeRandomTagPoolPickCount(0), 1);
assert.equal(normalizeRandomTagPoolPickCount(99), 10);

const migrated = {
  randomTagPoolEnabled: true,
  randomTagPool: ["a", "b", "c"],
  randomTagPoolPickCount: 4,
};
migrateConfig(migrated);
assert.equal(migrated.randomTagPoolPickCount, 4);

const disabled = sampleRandomTagPool({
  randomTagPoolEnabled: false,
  randomTagPool: ["a", "b"],
  randomTagPoolPickCount: 5,
});
assert.deepEqual(disabled.tags, []);

const sampled = sampleRandomTagPool({
  randomTagPoolEnabled: true,
  randomTagPool: ["a", "b", "c"],
  randomTagPoolPickCount: 1,
  randomTagPoolNextPriorityTag: "",
});
assert.equal(sampled.tags.length, 1);

const withPriority = sampleRandomTagPool({
  randomTagPoolEnabled: true,
  randomTagPool: ["a", "b", "c"],
  randomTagPoolPickCount: 3,
  randomTagPoolNextPriorityTag: "c",
});
assert.equal(withPriority.tags.length, 3);
assert.equal(withPriority.tags[0], "c");

console.log("Random tag pool config checks passed.");
