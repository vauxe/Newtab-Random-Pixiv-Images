import assert from "node:assert/strict";

import {
  migrateConfig,
  normalizeRandomTagPoolPickCount,
  sampleRandomTagPool,
} from "../src/config.js";

// 归一化规则测试：
// - 缺省值回退到 2
// - 合法值原样保留
// - 越界值被钳制到允许范围内
assert.equal(normalizeRandomTagPoolPickCount(undefined), 2);
assert.equal(normalizeRandomTagPoolPickCount("3"), 3);
assert.equal(normalizeRandomTagPoolPickCount(0), 1);
assert.equal(normalizeRandomTagPoolPickCount(99), 10);

// 迁移旧配置时，不应再把 pickCount 硬编码重置成 2。
const migrated = {
  randomTagPoolEnabled: true,
  randomTagPool: ["a", "b", "c"],
  randomTagPoolPickCount: 4,
};
migrateConfig(migrated);
assert.equal(migrated.randomTagPoolPickCount, 4);

// 未启用随机池时，采样结果必须为空。
const disabled = sampleRandomTagPool({
  randomTagPoolEnabled: false,
  randomTagPool: ["a", "b"],
  randomTagPoolPickCount: 5,
});
assert.deepEqual(disabled.tags, []);

// 配置抽 1 个时，运行时不能偷偷恢复成 2。
const sampled = sampleRandomTagPool({
  randomTagPoolEnabled: true,
  randomTagPool: ["a", "b", "c"],
  randomTagPoolPickCount: 1,
  randomTagPoolNextPriorityTag: "",
});
assert.equal(sampled.tags.length, 1);

// 有优先 Tag 时，它应该先占用一个名额，其余名额再随机补齐。
const withPriority = sampleRandomTagPool({
  randomTagPoolEnabled: true,
  randomTagPool: ["a", "b", "c"],
  randomTagPoolPickCount: 3,
  randomTagPoolNextPriorityTag: "c",
});
assert.equal(withPriority.tags.length, 3);
assert.equal(withPriority.tags[0], "c");

console.log("Random tag pool config checks passed.");
