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
  if (!config || config.randomTagPoolEnabled !== true) {
    return {
      tags: [],
      consumedNextPriorityTag: "",
      consumedPriorityTag: "",
      remainingNextPriorityTag: "",
      remainingPriorityTags: [],
    };
  }
  const pool = normalizeRandomTagPool(config.randomTagPool);
  if (pool.length === 0) {
    return {
      tags: [],
      consumedNextPriorityTag: "",
      consumedPriorityTag: "",
      remainingNextPriorityTag: "",
      remainingPriorityTags: [],
    };
  }
  const pickCount = 2;
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const priorityTags = Array.isArray(config.randomTagPoolPriorityTags)
    ? config.randomTagPoolPriorityTags.map((tag) => String(tag || "").trim()).filter((tag) => pool.includes(tag))
    : [];
  const nextPriorityTag = typeof config.randomTagPoolNextPriorityTag === "string" && pool.includes(config.randomTagPoolNextPriorityTag.trim())
    ? config.randomTagPoolNextPriorityTag.trim()
    : "";
  let consumedNextPriorityTag = "";
  let consumedPriorityTag = "";
  const pickedTags = [];

  if (nextPriorityTag) {
    consumedNextPriorityTag = nextPriorityTag;
    pickedTags.push(nextPriorityTag);
  } else if (priorityTags.length > 0) {
    const priorityIndex = Math.floor(Math.random() * priorityTags.length);
    consumedPriorityTag = priorityTags[priorityIndex];
    pickedTags.push(consumedPriorityTag);
  }

  const remainingShuffled = shuffled.filter((tag) => !pickedTags.includes(tag));
  while (pickedTags.length < Math.min(pickCount, pool.length) && remainingShuffled.length > 0) {
    pickedTags.push(remainingShuffled.shift());
  }

  return {
    tags: pickedTags,
    consumedNextPriorityTag,
    consumedPriorityTag,
    remainingNextPriorityTag: "",
    remainingPriorityTags: consumedPriorityTag
      ? priorityTags.filter((tag) => tag !== consumedPriorityTag)
      : priorityTags,
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
  } else {
    const normalizedPriorityTags = [];
    const knownTags = new Set(config.randomTagPool.map((tag) => String(tag || "").trim()).filter(Boolean));
    for (const tag of config.randomTagPoolPriorityTags) {
      const normalizedTag = String(tag || "").trim();
      if (normalizedTag && knownTags.has(normalizedTag) && !normalizedPriorityTags.includes(normalizedTag)) {
        normalizedPriorityTags.push(normalizedTag);
      }
    }
    config.randomTagPoolPriorityTags = normalizedPriorityTags;
  }
  config.randomTagPoolPickCount = 2;
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
