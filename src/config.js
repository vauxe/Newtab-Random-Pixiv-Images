export const Order = Object.freeze({
  date_d: 'date_d',
  date: 'date',
  popular_d: 'popular_d',
  popular_male_d: 'popular_male_d',
  popular_female_d: 'popular_female_d'
});

export const Mode = Object.freeze({
  all: 'all',
  r18: 'r18',
  safe: 'safe'
});

export const SMode = Object.freeze({
  s_tag: 's_tag',
  s_tag_full: 's_tag_full',
  s_tc: 's_tc'
})

export const ImageType = Object.freeze({
  all: 'all',
  illust_and_ugoira: 'illust_and_ugoira',
  illust: 'illust',
  manga: 'manga',
  ugoira: 'ugoira'
});

export const TimeOption = Object.freeze({
  unlimited: 'unlimited',
  specific: 'specific'
});

export const defaultConfig = {
  randomImageEnabled: true,
  defaultImageUrl: "",
  defaultImageFit: "cover",
  defaultImageSourceType: "url",
  defaultImageUploadName: "",
  order: Order.date_d, // sort order
  mode: Mode.safe, // search mode
  timeOption: TimeOption.unlimited,
  scd: null, // start date
  ecd: null, // end date
  blt: null, // minimum likes number
  bgt: null, // maximum likes number
  s_mode: SMode.s_tag,
  type: ImageType.illust,
  // sl perhaps means pixiv safe level, 2 is safe, 6 is not safe
  min_sl: null,
  max_sl: null,
  aiType: null, // pixiv ai type, 1 not ai, 2 is ai
  queryTree: null, // new tree-based query model (source of truth when present)
  orGroups: [
    { name: "Popular", tags: ["7500users入り", "10000users入り", "30000users入り", "50000users入り"] }
  ],
  minusKeywords: "虚偽users入りタグ 描き方 講座 作画資料 創作 素材 漫画",
  andKeywords: "",
  orKeywords: null, // legacy field, kept for migration detection
  globalMinusKeywords: "", // global minus tags (space separated)
  presetMinusKeywords: [], // deprecated: merged into globalMinusKeywords
  likedUserIds: [],
  dislikedUserIds: [],
  randomTagPoolEnabled: false,
  randomTagPool: [],
  randomTagPoolCounts: {},
  randomTagPoolNextPriorityTag: "",
  randomTagPoolPriorityTags: [],
  randomTagPoolPickCount: 2,
  randomSeedStrategy: "page_pool",
  seenHistoryLimit: 300,
  seenHistoryTtlMs: 21600000,
}

// 统一约束“随机 Tag 池每次抽取数量”。
// 这里既服务于设置页输入框，也服务于运行时采样逻辑：
// 1. 非数字时回退到 fallback，避免旧配置或异常输入污染状态。
// 2. 目前把范围限制在 1..10，防止一次请求拼出过长 query。
// 3. 所有入口都调用同一个函数，避免 UI、存储和运行时规则不一致。
export function normalizeRandomTagPoolPickCount(value, fallback = 2) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(10, parsed));
}

// ── Tree Data Model ──
// Tag:   { type: "tag", value: string, negated: boolean }
// Group: { type: "group", connector: "AND"|"OR", children: node[] }

/**
 * Convert old flat format (andKeywords, orGroups, minusKeywords) to tree
 */
export function legacyToTree(andKeywords, orGroups, minusKeywords) {
  const children = [];

  // AND keywords → individual tags
  const andList = (andKeywords || "").trim().split(/\s+/).filter(Boolean);
  for (const tag of andList) {
    children.push({ type: "tag", value: tag, negated: false });
  }

  // OR groups → group nodes
  if (Array.isArray(orGroups)) {
    for (const group of orGroups) {
      const tags = Array.isArray(group.tags) ? group.tags.filter(Boolean) : [];
      if (tags.length > 0) {
        children.push({
          type: "group",
          connector: "OR",
          children: tags.map(t => ({ type: "tag", value: t, negated: false }))
        });
      }
    }
  }

  // Minus keywords → negated tags
  const minusList = (minusKeywords || "").trim().split(/\s+/).filter(Boolean);
  for (const tag of minusList) {
    children.push({ type: "tag", value: tag, negated: true });
  }

  return { type: "group", connector: "AND", children };
}

/**
 * Derive legacy fields from tree for backward compatibility
 */
export function treeToLegacy(tree) {
  const andKeywords = [];
  const orGroups = [];
  const minusKeywords = [];

  if (!tree || tree.type !== "group") {
    return { andKeywords: "", orGroups: [], minusKeywords: "" };
  }

  for (const child of tree.children) {
    if (child.type === "tag") {
      if (child.negated) {
        minusKeywords.push(child.value);
      } else {
        andKeywords.push(child.value);
      }
    } else if (child.type === "group") {
      // For legacy compat, flatten OR groups into orGroups format
      // AND groups and nested structures get flattened into the query string
      if (child.connector === "OR" && child.children.every(c => c.type === "tag" && !c.negated)) {
        orGroups.push({
          name: child.children.map(c => c.value).slice(0, 2).join("/") || "OR",
          tags: child.children.map(c => c.value)
        });
      } else {
        // Complex group — push as AND keyword with the built expression
        andKeywords.push(buildQueryFromTree(child));
      }
    }
  }

  return {
    andKeywords: andKeywords.join(" "),
    orGroups,
    minusKeywords: minusKeywords.join(" "),
  };
}

/**
 * Recursively build Pixiv search query string from tree
 */
export function buildQueryFromTree(tree) {
  if (!tree) return "";

  if (tree.type === "tag") {
    if (tree.negated) {
      return "-" + tree.value;
    }
    return tree.value;
  }

  if (tree.type === "group") {
    const parts = tree.children
      .map(child => buildQueryFromTree(child))
      .filter(Boolean);

    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];

    const joiner = tree.connector === "OR" ? " OR " : " ";
    const inner = parts.join(joiner);

    return "(" + inner + ")";
  }

  return "";
}

/**
 * Build the final query string from config, using tree if available
 */
export function buildQuery(config) {
  if (config.queryTree) {
    // Tree is the root group — don't wrap in extra parens
    const tree = config.queryTree;
    if (tree.type === "group") {
      const parts = tree.children
        .map(child => buildQueryFromTree(child))
        .filter(Boolean);
      const joiner = tree.connector === "OR" ? " OR " : " ";
      let base = parts.join(joiner);
      // Also append minus keywords if provided (extra negatives)
      const minusList = (config.minusKeywords || "").trim().split(/\s+/).filter(Boolean);
      if (minusList.length > 0) {
        let minusPart = minusList.map(t => "-" + t).join(" ");
        base = base ? `${base} ${minusPart}` : minusPart;
      }
      return base;
    }
    return buildQueryFromTree(tree);
  }
  // Fallback to legacy
  return getKeywords(config.andKeywords || "", config.orGroups || [], config.minusKeywords || "");
}

export function normalizeRandomTagPool(pool) {
  if (!Array.isArray(pool)) {
    return [];
  }
  return pool
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (entry && typeof entry.value === "string") {
        return entry.value.trim();
      }
      return "";
    })
    .filter(Boolean);
}

export function sampleRandomTagPool(config) {
  // 未启用随机池时直接返回空结果，调用方会退回到基础查询。
  if (!config || config.randomTagPoolEnabled !== true) {
    return {
      tags: [],
      remainingNextPriorityTag: "",
    };
  }
  const pool = normalizeRandomTagPool(config.randomTagPool);
  // 池子为空时同样不附加随机 Tag。
  if (pool.length === 0) {
    return {
      tags: [],
      remainingNextPriorityTag: "",
    };
  }
  // 抽取数量从配置读取，并在这里再次归一化。
  // 这样即使外部绕过设置页直接写 storage，也不会把非法值带进运行时。
  const pickCount = normalizeRandomTagPoolPickCount(config.randomTagPoolPickCount);
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // nextPriorityTag 表示“下次优先命中”的 Tag。
  // 如果它仍然存在于当前池子里，就先占掉一个名额，再从剩余 Tag 随机补足。
  const nextPriorityTag = typeof config.randomTagPoolNextPriorityTag === "string" && pool.includes(config.randomTagPoolNextPriorityTag.trim())
    ? config.randomTagPoolNextPriorityTag.trim()
    : "";
  const pickedTags = [];

  if (nextPriorityTag) {
    pickedTags.push(nextPriorityTag);
  }

  const remainingShuffled = shuffled.filter((tag) => !pickedTags.includes(tag));
  // 最终数量不会超过“配置数量”和“池子大小”中的较小值。
  while (pickedTags.length < Math.min(pickCount, pool.length) && remainingShuffled.length > 0) {
    pickedTags.push(remainingShuffled.shift());
  }

  return {
    tags: pickedTags,
    remainingNextPriorityTag: "",
  };
}

export function buildQueryWithRandomTagPool(config) {
  const baseQuery = buildQuery(config).trim();
  const sampledTags = sampleRandomTagPool(config).tags;
  if (sampledTags.length === 0) {
    return baseQuery;
  }
  return [baseQuery, ...sampledTags].filter(Boolean).join(" ").trim();
}

// Migrate old formats to tree
export function migrateConfig(config) {
  if (typeof config.randomImageEnabled !== "boolean") {
    config.randomImageEnabled = true;
  }
  if (typeof config.defaultImageUrl !== "string") {
    config.defaultImageUrl = "";
  } else {
    config.defaultImageUrl = config.defaultImageUrl.trim();
  }
  if (!config.defaultImageFit) {
    config.defaultImageFit = "cover";
  }
  if (!config.defaultImageSourceType) {
    config.defaultImageSourceType = "url";
  }
  if (typeof config.defaultImageUploadName !== "string") {
    config.defaultImageUploadName = "";
  }
  if (config.mode !== Mode.safe && config.mode !== Mode.r18) {
    config.mode = Mode.safe;
  }
  if (!Array.isArray(config.likedUserIds)) {
    config.likedUserIds = [];
  }
  if (!Array.isArray(config.dislikedUserIds)) {
    config.dislikedUserIds = [];
  }
  if (typeof config.randomTagPoolEnabled !== "boolean") {
    config.randomTagPoolEnabled = false;
  }
  if (!Array.isArray(config.randomTagPool)) {
    config.randomTagPool = [];
  }
  if (!config.randomTagPoolCounts || typeof config.randomTagPoolCounts !== "object" || Array.isArray(config.randomTagPoolCounts)) {
    config.randomTagPoolCounts = {};
  } else {
    const normalizedCounts = {};
    for (const [tag, count] of Object.entries(config.randomTagPoolCounts)) {
      const normalizedTag = String(tag || "").trim();
      const normalizedCount = parseInt(count, 10);
      if (normalizedTag && Number.isInteger(normalizedCount) && normalizedCount > 0) {
        normalizedCounts[normalizedTag] = normalizedCount;
      }
    }
    config.randomTagPoolCounts = normalizedCounts;
  }
  if (typeof config.randomTagPoolNextPriorityTag !== "string") {
    config.randomTagPoolNextPriorityTag = "";
  } else {
    const normalizedNextPriorityTag = config.randomTagPoolNextPriorityTag.trim();
    const knownTags = new Set(config.randomTagPool.map((tag) => String(tag || "").trim()).filter(Boolean));
    config.randomTagPoolNextPriorityTag = knownTags.has(normalizedNextPriorityTag)
      ? normalizedNextPriorityTag
      : "";
  }
  if (!Array.isArray(config.randomTagPoolPriorityTags)) {
    config.randomTagPoolPriorityTags = [];
  }
  // 迁移阶段也必须走同一套归一化逻辑。
  // 否则旧版本写入的固定值或非法值会让设置页看起来能改，
  // 但重新加载后又被悄悄改回去。
  config.randomTagPoolPickCount = normalizeRandomTagPoolPickCount(config.randomTagPoolPickCount);
  if (!config.randomSeedStrategy) {
    config.randomSeedStrategy = "page_pool";
  }
  if (!Number.isInteger(config.seenHistoryLimit) || config.seenHistoryLimit <= 0) {
    config.seenHistoryLimit = 300;
  }
  if (!Number.isInteger(config.seenHistoryTtlMs) || config.seenHistoryTtlMs <= 0) {
    config.seenHistoryTtlMs = 21600000;
  }

  // Step 1: migrate orKeywords string → orGroups array (oldest format)
  if (config.orKeywords && (!config.orGroups || !Array.isArray(config.orGroups))) {
    const tags = config.orKeywords.trim().split(/\s+/).filter(Boolean);
    config.orGroups = tags.length > 0
      ? [{ name: "OR", tags }]
      : [];
    config.orKeywords = null;
  }
  // Ensure orGroups is always a valid array
  if (!config.orGroups || !Array.isArray(config.orGroups)) {
    config.orGroups = [];
  }

  // Step 2: migrate flat fields → tree (if no tree exists yet)
  if (!config.queryTree) {
    config.queryTree = legacyToTree(
      config.andKeywords || "",
      config.orGroups,
      config.minusKeywords || ""
    );
  }

  if (!config.globalMinusKeywords) {
    config.globalMinusKeywords = "";
  }
  if (!config.presetMinusKeywords || !Array.isArray(config.presetMinusKeywords)) {
    config.presetMinusKeywords = [];
  }

  // Merge deprecated presetMinusKeywords into globalMinusKeywords once
  if (Array.isArray(config.presetMinusKeywords) && config.presetMinusKeywords.length > 0) {
    const presetParts = config.presetMinusKeywords
      .map(s => (s || "").trim())
      .filter(Boolean);
    if (presetParts.length > 0) {
      const existing = (config.globalMinusKeywords || "").trim();
      const merged = [existing, ...presetParts].filter(Boolean).join(" ").replace(/\s+/g, " ");
      config.globalMinusKeywords = merged;
    }
    config.presetMinusKeywords = [];
  }

  return config;
}

// Legacy function — kept for backward compatibility
export function getKeywords(andKeywords, orGroups, minusKeywords) {
  let andKeywordsList = andKeywords.trim().split(/\s+/).filter(Boolean);
  let minusKeywordsList = minusKeywords.trim().split(/\s+/).filter(Boolean);

  let aWord = andKeywordsList.length ? andKeywordsList.join(' ') : '';
  let nWord = minusKeywordsList.length ? "-" + minusKeywordsList.join(" -") : '';

  // Build multiple OR group expressions: (A OR B) (C OR D)
  let orParts = [];
  if (Array.isArray(orGroups)) {
    for (let group of orGroups) {
      let tags = Array.isArray(group.tags) ? group.tags : [];
      tags = tags.filter(Boolean);
      if (tags.length > 0) {
        orParts.push('(' + tags.join(" OR ") + ')');
      }
    }
  }

  let allWords = [];
  if (aWord) {
    allWords.push(aWord);
  }
  if (nWord) {
    allWords.push(nWord);
  }
  for (let orPart of orParts) {
    allWords.push(orPart);
  }
  let word = allWords.join(' ');
  return word;
}
