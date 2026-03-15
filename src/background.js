import { defaultConfig, buildQuery, sampleRandomTagPool, migrateConfig } from "./config.js";
import { resolveDefaultImageUrl } from "./default-image-store.js";

/**
 * 确保 Pixiv 请求头规则
 * 配置 declarativeNetRequest 规则，为 Pixiv 请求添加正确的 referer 和 CORS 头
 */
function ensurePixivHeaderRules() {
  const RULE = [
    {
      "id": 1,
      "priority": 1,
      "action": {
        "type": "modifyHeaders",
        "requestHeaders": [
          {
            "header": "referer",
            "operation": "set",
            "value": "https://www.pixiv.net/"
          }
        ]
      },
      "condition": {
        initiatorDomains: [chrome.runtime.id],
        "urlFilter": "pixiv.net",
        "resourceTypes": [
          "xmlhttprequest",
        ]
      }
    },
    {
      "id": 2,
      "priority": 2,
      "action": {
        "type": "modifyHeaders",
        "requestHeaders": [
          {
            "header": "referer",
            "operation": "set",
            "value": "https://www.pixiv.net/"
          }
        ],
        "responseHeaders": [
          {
            "header": "Access-Control-Allow-Origin",
            "operation": "set",
            "value": "*"
          }
        ]
      },
      "condition": {
        "requestDomains": ["i.pximg.net", "s.pximg.net"],
        "resourceTypes": [
          "xmlhttprequest",
          "image",
        ]
      }
    }
  ];
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULE.map(o => o.id),
    addRules: RULE,
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("Failed to update Pixiv header rules:", chrome.runtime.lastError);
      return;
    }
    debugLog("ensurePixivHeaderRules:applied", RULE.map((rule) => ({
      id: rule.id,
      requestDomains: rule.condition.requestDomains || null,
      resourceTypes: rule.condition.resourceTypes,
    })));
  });
}

// 扩展安装时初始化 Pixiv 请求头规则
chrome.runtime.onInstalled.addListener(() => {
  ensurePixivHeaderRules();
});

// 扩展启动时初始化 Pixiv 请求头规则
chrome.runtime.onStartup.addListener(() => {
  ensurePixivHeaderRules();
});

// 页面加载时确保 Pixiv 请求头规则已应用
ensurePixivHeaderRules();

/**
 * 调试日志输出
 */
function debugLog(...args) {
  console.log("[bg]", ...args);
}

/**
 * 带超时的 fetch 请求
 * @param {string} url - 请求 URL
 * @param {object} init - fetch 初始化参数
 * @param {number} timeoutMs - 超时时间（毫秒）
 */
async function fetchWithTimeout(url, init = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 生成指定范围内的随机整数
 */
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min);
}

/**
 * 打乱数组顺序（Fisher-Yates 洗牌算法）
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = getRandomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * 固定大小的队列数据结构，用于缓存候选作品
 */
class Queue {
  constructor(maxsize) {
    this.maxsize = maxsize;
    this.array = [];
  }
  empty() {
    return this.array.length === 0;
  }
  full() {
    return this.array.length === this.maxsize;
  }
  size() {
    return this.array.length;
  }
  capacity() {
    return this.maxsize;
  }
  pop() {
    if (!this.empty()) {
      return this.array.shift();
    }
  }
  push(item) {
    if (!this.full()) {
      this.array.push(item);
      return true;
    }
    return false;
  }
}

/**
 * 从 Pixiv API 获取 JSON 数据
 * @param {string} url - 请求 URL
 * @returns {Promise<object>} - 返回解析后的 JSON 或错误对象
 */
async function fetchPixivJson(url) {
  try {
    debugLog("fetchPixivJson:start", url);
    let res = await fetchWithTimeout(url, {}, 12000);
    if (!res.ok) {
      console.error(`Fetch Pixiv json failed: ${res.status} ${res.statusText}`);
      return { __error: true, message: `HTTP ${res.status} ${res.statusText}` };
    }
    let res_json = await res.json();
    if (res_json.error) {
      console.error(`Pixiv API error: ${res_json.message}`);
      return { __error: true, message: res_json.message || "Pixiv API error" };
    }
    debugLog("fetchPixivJson:ok", url);
    return res_json;
  } catch (e) {
    console.error(`Fetch Pixiv json error:`, e);
    return { __error: true, message: e && e.message ? e.message : "Network error" };
  }
}

/**
 * 获取图片资源，支持多种降级策略
 * @param {string} url - 图片 URL
 * @param {string} label - 图片标签（用于日志）
 * @returns {Promise<Blob|null>} - 返回图片 Blob 对象
 */
async function fetchImage(url, label = "image") {
  if (!url) {
    debugLog("fetchImage:skip-empty", label);
    return null;
  }
  // 在扩展环境中优先使用 XHR 方式
  if (typeof XMLHttpRequest !== "undefined") {
    const xhrBlob = await fetchImageViaXhr(url, label);
    if (xhrBlob) {
      return xhrBlob;
    }
  }
  // 尝试不同的获取策略
  const attempts = [
    {
      name: "pixiv-referrer",
      init: {
        referrer: "https://www.pixiv.net/",
        referrerPolicy: "strict-origin-when-cross-origin",
        credentials: "omit",
        cache: "no-store",
      }
    },
    {
      name: "plain-fetch",
      init: {
        credentials: "omit",
        cache: "no-store",
      }
    }
  ];

  for (const attempt of attempts) {
    try {
      debugLog("fetchImage:start", { label, attempt: attempt.name, url });
      const res = await fetchWithTimeout(url, attempt.init, 10000);
      if (!res.ok) {
        console.warn(`Fetch ${label} failed with status`, attempt.name, res.status, url);
        continue;
      }
      debugLog("fetchImage:ok", { label, attempt: attempt.name, url });
      return await res.blob();
    } catch (e) {
      console.error(`Fetch ${label} error [${attempt.name}] ${url}:`, e);
    }
  }
  debugLog("fetchImage:all-failed", { label, url });
  return null;
}

/**
 * 使用 XHR 方式获取图片（适用于扩展环境）
 * @param {string} url - 图片 URL
 * @param {string} label - 图片标签
 * @param {number} timeoutMs - 超时时间
 * @returns {Promise<Blob|null>}
 */
function fetchImageViaXhr(url, label = "image", timeoutMs = 10000) {
  if (typeof XMLHttpRequest === "undefined") {
    debugLog("fetchImage:xhr-unavailable", { label, url });
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "blob";
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
        debugLog("fetchImage:xhr-ok", { label, url, status: xhr.status });
        resolve(xhr.response);
        return;
      }
      console.warn(`Fetch ${label} xhr failed with status`, xhr.status, url);
      resolve(null);
    };
    xhr.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      console.error(`Fetch ${label} xhr error ${url}`);
      resolve(null);
    };
    xhr.ontimeout = () => {
      if (settled) {
        return;
      }
      settled = true;
      console.error(`Fetch ${label} xhr timeout ${url}`);
      resolve(null);
    };
    xhr.onabort = () => {
      if (settled) {
        return;
      }
      settled = true;
      console.error(`Fetch ${label} xhr abort ${url}`);
      resolve(null);
    };
    debugLog("fetchImage:xhr-start", { label, url });
    xhr.send();
  });
}

/**
 * 按顺序尝试获取多个图片 URL 中的第一个可用图片
 * @param {string[]} urls - 图片 URL 数组
 * @param {string} label - 图片标签
 * @returns {Promise<{blob: Blob|null, url: string|null}>}
 */
async function fetchFirstAvailableImage(urls, label = "image") {
  const candidates = Array.from(new Set(
    (Array.isArray(urls) ? urls : [])
      .map((url) => String(url || "").trim())
      .filter(Boolean)
  ));
  for (const url of candidates) {
    const blob = await fetchImage(url, label);
    if (blob) {
      return { blob, url };
    }
  }
  return { blob: null, url: null };
}

// Pixiv API 基础 URL
let baseUrl = "https://www.pixiv.net";
let illustInfoUrl = "/ajax/illust/";
let searchUrl = "/ajax/search/illustrations/";

/**
 * 搜索源类，负责从 Pixiv 获取随机作品
 * 功能包括：
 * - 根据配置生成查询条件
 * - 管理候选作品队列
 * - 缓存已加载的页面
 * - 过滤不喜欢的用户和作品
 */
class SearchSource {
  constructor(config) {
    this.searchParam = config;
    this.params = ["order", "mode", "p", "s_mode", "type", "scd", "ecd", "blt", "bgt"];
    this.totalPage = 0;
    this.itemsPerPage = 60;
    this.pageCache = new Map();
    this.pageCacheLimit = 8;
    this.candidateQueue = [];
    this.candidateQueueTargetSize = 24;
    this.enqueuedIds = new Set();
    this.seenMap = new Map();
    this.activeQueryWord = buildQuery(config);
    this.lastErrorMessage = null;
    this.lastResolvedRandomTags = [];
    this.lastResolvedRandomTagsAt = 0;
  }

  /**
   * 更新搜索配置
   * @param {object} config - 新的配置对象
   */
  updateConfig(config) {
    this.searchParam = config;
    this.totalPage = 0;
    this.pageCache.clear();
    this.candidateQueue = [];
    this.enqueuedIds.clear();
    this.seenMap.clear();
    this.activeQueryWord = buildQuery(config);
    this.lastErrorMessage = null;
    this.lastResolvedRandomTags = [];
    this.lastResolvedRandomTagsAt = 0;
    chrome.storage.local.set({
      randomTagPoolLastResolvedTags: [],
      randomTagPoolLastResolvedAt: 0,
    });
    debugLog("searchSource:updateConfig", {
      mode: config.mode,
      randomImageEnabled: config.randomImageEnabled,
      query: this.activeQueryWord,
      dislikedUsers: Array.isArray(config.dislikedUserIds) ? config.dislikedUserIds.length : 0,
      blockedIllusts: Array.isArray(config.blockedIllustIds) ? config.blockedIllustIds.length : 0,
    });
  }

  /**
   * URL 编码特殊字符处理
   * Pixiv API 需要对某些特殊字符进行额外编码
   */
  replaceSpecialCharacter = (function () {
    var reg = /[!'()~]/g;
    var mapping = {
      "!": "%21",
      "'": "%27",
      "(": "%28",
      ")": "%29",
      "~": "%7E",
    };
    var map = function (e) {
      return mapping[e];
    };
    var fn = function (e) {
      return encodeURIComponent(e).replace(reg, map);
    };
    return fn;
  })();

  /**
   * 生成搜索 URL
   * @param {number} p - 页码
   * @param {string} queryWord - 查询词
   * @returns {string}
   */
  generateSearchUrl(p = 1, queryWord = this.activeQueryWord) {
    let sp = this.searchParam;
    let runtimeParam = { ...sp, p };
    let word = (queryWord || buildQuery(sp)).trim();
    let firstPart = encodeURIComponent(word);
    let secondPartArray = [];
    secondPartArray.push("?word=" + this.replaceSpecialCharacter(word));
    for (let o of this.params) {
      if (runtimeParam.hasOwnProperty(o) && runtimeParam[o]) {
        secondPartArray.push(`${o}=${runtimeParam[o]}`);
      }
    }
    let secondPart = secondPartArray.join("&");
    return firstPart + secondPart;
  }

  /**
   * 搜索作品页面
   * @param {number} p - 页码
   * @param {string} queryWord - 查询词
   * @returns {Promise<object|null>}
   */
  async searchIllustPage(p, queryWord = this.activeQueryWord) {
    let paramUrl = this.generateSearchUrl(p, queryWord);
    debugLog("searchIllustPage", { page: p, queryWord, url: baseUrl + searchUrl + paramUrl });
    let jsonResult = await fetchPixivJson(baseUrl + searchUrl + paramUrl);
    if (jsonResult && jsonResult.__error) {
      this.lastErrorMessage = jsonResult.message;
      return null;
    }
    return jsonResult;
  }

  /**
   * 获取已查看历史的最大数量限制
   * @returns {number}
   */
  getSeenHistoryLimit() {
    return Number.isInteger(this.searchParam.seenHistoryLimit) && this.searchParam.seenHistoryLimit > 0
      ? this.searchParam.seenHistoryLimit
      : 300;
  }

  /**
   * 获取已查看历史的过期时间（毫秒）
   * @returns {number}
   */
  getSeenHistoryTtlMs() {
    return Number.isInteger(this.searchParam.seenHistoryTtlMs) && this.searchParam.seenHistoryTtlMs > 0
      ? this.searchParam.seenHistoryTtlMs
      : 21600000;
  }

  /**
   * 清理过期的已查看历史记录
   */
  pruneSeenHistory() {
    const now = Date.now();
    const ttl = this.getSeenHistoryTtlMs();
    for (const [illustId, timestamp] of this.seenMap.entries()) {
      if (now - timestamp > ttl) {
        this.seenMap.delete(illustId);
      }
    }
    const limit = this.getSeenHistoryLimit();
    if (this.seenMap.size <= limit) {
      return;
    }
    const overflow = this.seenMap.size - limit;
    let trimmed = 0;
    for (const illustId of this.seenMap.keys()) {
      this.seenMap.delete(illustId);
      trimmed += 1;
      if (trimmed >= overflow) {
        break;
      }
    }
  }

  /**
   * 检查作品是否在近期已查看过
   * @param {string} illustId - 作品 ID
   * @returns {boolean}
   */
  hasSeenRecently(illustId) {
    this.pruneSeenHistory();
    const seenAt = this.seenMap.get(illustId);
    if (!seenAt) {
      return false;
    }
    if (Date.now() - seenAt > this.getSeenHistoryTtlMs()) {
      this.seenMap.delete(illustId);
      return false;
    }
    return true;
  }

  /**
   * 标记作品为已查看
   * @param {string} illustId - 作品 ID
   */
  markSeen(illustId) {
    this.pruneSeenHistory();
    this.seenMap.set(illustId, Date.now());
  }

  /**
   * 缓存页面结果
   * @param {string} cacheKey - 缓存键
   * @param {object} pageObj - 页面对象
   */
  cachePage(cacheKey, pageObj) {
    if (!pageObj) {
      return;
    }
    if (this.pageCache.has(cacheKey)) {
      this.pageCache.delete(cacheKey);
    }
    this.pageCache.set(cacheKey, pageObj);
    while (this.pageCache.size > this.pageCacheLimit) {
      const oldestCacheKey = this.pageCache.keys().next().value;
      this.pageCache.delete(oldestCacheKey);
    }
  }

  /**
   * 获取页面数据（优先从缓存读取）
   * @param {number} pageNumber - 页码
   * @param {string} queryWord - 查询词
   * @returns {Promise<object>}
   */
  async getPage(pageNumber, queryWord = this.activeQueryWord) {
    const cacheKey = `${queryWord}::${pageNumber}`;
    if (this.pageCache.has(cacheKey)) {
      const cached = this.pageCache.get(cacheKey);
      this.pageCache.delete(cacheKey);
      this.pageCache.set(cacheKey, cached);
      return cached;
    }
    const pageObj = await this.searchIllustPage(pageNumber, queryWord);
    if (pageObj && pageObj.body) {
      this.cachePage(cacheKey, pageObj);
      const total = pageObj.body.illust.total;
      const nextTotalPage = Math.ceil(total / this.itemsPerPage);
      if (nextTotalPage > this.totalPage) {
        this.totalPage = nextTotalPage;
      }
    }
    return pageObj;
  }

  /**
   * 标准化用户 ID 格式
   * @param {string} userId - 用户 ID
   * @returns {string}
   */
  normalizeUserId(userId) {
    return String(userId || "").trim();
  }

  /**
   * 检查用户是否在屏蔽列表中
   * @param {string} userId - 用户 ID
   * @returns {boolean}
   */
  isDislikedUser(userId) {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return false;
    }
    const dislikedUserIds = Array.isArray(this.searchParam.dislikedUserIds)
      ? this.searchParam.dislikedUserIds.map((id) => this.normalizeUserId(id)).filter(Boolean)
      : [];
    return dislikedUserIds.includes(normalizedUserId);
  }

  isBlockedIllust(illustId) {
    const normalizedIllustId = String(illustId || "").trim();
    if (!normalizedIllustId) {
      return false;
    }
    const blockedIllustIds = Array.isArray(this.searchParam.blockedIllustIds)
      ? this.searchParam.blockedIllustIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    return blockedIllustIds.includes(normalizedIllustId);
  }

  /**
   * 过滤作品数组，移除不符合条件的作品
   * 条件包括：点赞数范围、AI 类型、屏蔽用户等
   * @param {array} illustArray - 作品数组
   * @returns {array}
   */
  filterIllustArray(illustArray) {
    if (!Array.isArray(illustArray)) {
      return [];
    }
    return illustArray.filter((el) => {
      let condition1 = !this.searchParam.min_sl || el.sl >= this.searchParam.min_sl;
      let condition2 = !this.searchParam.max_sl || el.sl <= this.searchParam.max_sl;
      let condition3 = !this.searchParam.aiType || el.aiType == this.searchParam.aiType;
      let condition4 = !this.isDislikedUser(el.userId);
      let condition5 = !this.isBlockedIllust(el.id);
      return condition1 && condition2 && condition3 && condition4 && condition5;
    });
  }

  /**
   * 将候选作品加入队列
   * @param {array} candidates - 候选作品数组
   */
  enqueueCandidates(candidates) {
    const shuffled = shuffleArray(candidates.slice());
    for (const candidate of shuffled) {
      if (!candidate || !candidate.id) {
        continue;
      }
      if (this.enqueuedIds.has(candidate.id) || this.hasSeenRecently(candidate.id)) {
        continue;
      }
      this.candidateQueue.push(candidate);
      this.enqueuedIds.add(candidate.id);
    }
  }

  /**
   * 从队列中取出一个候选作品
   * @returns {object|null}
   */
  dequeueCandidate() {
    while (this.candidateQueue.length > 0) {
      const candidate = this.candidateQueue.shift();
      if (!candidate || !candidate.id) {
        continue;
      }
      this.enqueuedIds.delete(candidate.id);
      if (this.hasSeenRecently(candidate.id)) {
        continue;
      }
      return candidate;
    }
    return null;
  }

  /**
   * 确保获取总页数
   * @param {string} queryWord - 查询词
   * @returns {Promise<number>}
   */
  async ensureTotalPages(queryWord = this.activeQueryWord) {
    if (this.totalPage > 0) {
      return this.totalPage;
    }
    let firstPage = await this.getPage(1, queryWord);
    if (!firstPage || !firstPage.body) {
      return 0;
    }
    let total = firstPage.body.illust.total;
    this.totalPage = Math.ceil(total / this.itemsPerPage);
    return this.totalPage;
  }

  /**
   * 随机选择指定数量的页码
   * @param {number} maxPagesToSample - 最大采样页数
   * @returns {array}
   */
  pickSamplePages(maxPagesToSample) {
    if (this.totalPage <= 0) {
      return [];
    }
    const pickedPages = new Set();
    while (pickedPages.size < Math.min(maxPagesToSample, this.totalPage)) {
      pickedPages.add(getRandomInt(1, this.totalPage + 1));
    }
    return Array.from(pickedPages);
  }

  /**
   * 构建查询尝试列表（支持随机标签池）
   * @returns {array}
   */
  buildQueryAttempts() {
    const baseQuery = buildQuery(this.searchParam).trim();
    const sampling = sampleRandomTagPool(this.searchParam);
    const sampledTags = sampling.tags;
    const attempts = [];

    this.searchParam.randomTagPoolNextPriorityTag = sampling.remainingNextPriorityTag;
    chrome.storage.local.set({
      randomTagPoolNextPriorityTag: sampling.remainingNextPriorityTag,
    });

    for (let count = sampledTags.length; count >= 0; count--) {
      const queryWord = [baseQuery, ...sampledTags.slice(0, count)]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (queryWord && !attempts.some((attempt) => attempt.queryWord === queryWord)) {
        attempts.push({
          queryWord,
          randomTags: sampledTags.slice(0, count),
        });
      }
    }

    if (attempts.length === 0 && baseQuery) {
      attempts.push({
        queryWord: baseQuery,
        randomTags: [],
      });
    }

    debugLog("buildQueryAttempts", attempts.map((attempt) => ({
      queryWord: attempt.queryWord,
      randomTags: attempt.randomTags,
    })));
    return attempts;
  }

  /**
   * 发布已解析的随机标签到存储
   * @param {array} randomTags - 随机标签数组
   */
  async publishResolvedRandomTags(randomTags) {
    const normalizedTags = Array.isArray(randomTags)
      ? randomTags.map((tag) => String(tag || "").trim()).filter(Boolean)
      : [];
    this.lastResolvedRandomTags = normalizedTags;
    this.lastResolvedRandomTagsAt = Date.now();
    await chrome.storage.local.set({
      randomTagPoolLastResolvedTags: normalizedTags,
      randomTagPoolLastResolvedAt: this.lastResolvedRandomTagsAt,
    });
    debugLog("publishResolvedRandomTags", normalizedTags);
  }

  /**
   * 填充候选队列，确保有足够的候选作品
   */
  async fillCandidateQueue() {
    if (this.candidateQueue.length >= this.candidateQueueTargetSize) {
      return;
    }
    const queryAttempts = this.buildQueryAttempts();

    for (const attempt of queryAttempts) {
      const queryWord = attempt.queryWord;
      if (queryWord !== this.activeQueryWord) {
        this.activeQueryWord = queryWord;
        this.totalPage = 0;
      }

      const totalPage = await this.ensureTotalPages(queryWord);
      if (totalPage === 0) {
        continue;
      }

      const maxPagesToSample = Math.min(4, totalPage);
      const pageNumbers = this.pickSamplePages(maxPagesToSample);
      debugLog("fillCandidateQueue:sample-pages", { queryWord, totalPage, pageNumbers });
      for (const pageNumber of pageNumbers) {
        const pageObj = await this.getPage(pageNumber, queryWord);
        if (!pageObj || !pageObj.body || !pageObj.body.illust) {
          continue;
        }
        const filtered = this.filterIllustArray(pageObj.body.illust.data);
        debugLog("fillCandidateQueue:page-result", {
          queryWord,
          pageNumber,
          rawCount: Array.isArray(pageObj.body.illust.data) ? pageObj.body.illust.data.length : 0,
          filteredCount: filtered.length,
        });
        this.enqueueCandidates(filtered);
        if (this.candidateQueue.length >= this.candidateQueueTargetSize) {
          break;
        }
      }

      if (this.candidateQueue.length > 0) {
        await this.publishResolvedRandomTags(attempt.randomTags);
        debugLog("fillCandidateQueue:queue-ready", {
          queryWord,
          queueSize: this.candidateQueue.length,
          randomTags: attempt.randomTags,
        });
        return;
      }
    }
    debugLog("fillCandidateQueue:empty");
  }

  /**
   * 获取随机作品（核心方法）
   * 流程：
   * 1. 填充候选队列
   * 2. 从队列中取出一个候选
   * 3. 获取作品详细信息
   * 4. 下载图片和头像
   * 5. 返回完整作品信息
   * @returns {Promise<object|null>}
   */
  async getRandomIllust() {
    const MAX_RETRIES = 12;
    this.lastErrorMessage = null;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        debugLog("getRandomIllust:attempt", { retry: i + 1, queueSize: this.candidateQueue.length });
        await this.fillCandidateQueue();
        let picked = this.dequeueCandidate();
        if (!picked) {
          debugLog("getRandomIllust:no-candidate", { retry: i + 1 });
          continue;
        }
        debugLog("getRandomIllust:picked", {
          retry: i + 1,
          illustId: picked.id,
          userId: picked.userId,
          pickedUrl: picked.url,
        });

        let res = {};
        res.illustId = picked.id;
        res.profileImageUrl = picked.profileImageUrl;

        // 获取作品详细信息
        let illustInfo = await fetchPixivJson(baseUrl + illustInfoUrl + res.illustId);
        if (!illustInfo || illustInfo.__error || !illustInfo.body) {
          if (illustInfo && illustInfo.__error) {
            this.lastErrorMessage = illustInfo.message;
          }
          debugLog("getRandomIllust:illustInfo-failed", { illustId: res.illustId, message: this.lastErrorMessage });
          continue;
        }

        res.userName = illustInfo.body.userName;
        res.userId = illustInfo.body.userId;
        // 检查是否为屏蔽用户
        if (this.isDislikedUser(res.userId)) {
          this.markSeen(picked.id);
          debugLog("getRandomIllust:skip-disliked-user", { illustId: picked.id, userId: res.userId });
          continue;
        }
        res.illustId = illustInfo.body.illustId;
        res.userIdUrl = baseUrl + "/users/" + illustInfo.body.userId;
        res.illustIdUrl = baseUrl + "/artworks/" + illustInfo.body.illustId;
        res.title = illustInfo.body.title;
        res.originalImageUrl = illustInfo.body.urls.original || "";
        res.imageObjectUrl = illustInfo.body.urls.regular || illustInfo.body.urls.small || picked.url;
        // 提取标签信息（优先使用中文翻译）
        res.tags = (illustInfo.body.tags && illustInfo.body.tags.tags || []).map(t => {
          let tr = t.translation || {};
          return {
            tag: t.tag,
            translation: tr.zh || tr.zh_tw || tr.en || null,
          };
        });

        // 准备多个图片候选 URL
        const imageCandidates = [
          illustInfo.body.urls.regular,
          illustInfo.body.urls.small,
          picked.url,
        ].map((url) => String(url || "").trim()).filter(Boolean);
        const resolvedImageUrl = imageCandidates.find(Boolean);
        debugLog("getRandomIllust:image-candidates", {
          illustId: res.illustId,
          regular: illustInfo.body.urls.regular,
          small: illustInfo.body.urls.small,
          pickedUrl: picked.url,
          resolvedImageUrl,
        });
        // 下载图片和头像
        const { blob: illustBlob, url: loadedImageUrl } = await fetchFirstAvailableImage(imageCandidates, "illust");
        const profileBlob = await fetchImage(res.profileImageUrl, "profile");

        if (!resolvedImageUrl) continue;
        if (illustBlob) {
          try {
            res.imageObjectUrl = await blobToDataUrl(illustBlob);
          } catch (e) {
            console.error("Failed to convert illust blob to data URL:", e);
            res.imageObjectUrl = loadedImageUrl || resolvedImageUrl;
          }
        } else {
          res.imageObjectUrl = resolvedImageUrl;
        }

        if (profileBlob) {
          try {
            res.profileImageUrl = await blobToDataUrl(profileBlob);
          } catch (e) {
            // 忽略头像加载错误
          }
        } else {
          debugLog("getRandomIllust:profile-fallback-empty", {
            illustId: res.illustId,
            profileImageUrl: res.profileImageUrl,
          });
          res.profileImageUrl = "";
        }
        this.markSeen(picked.id);
        debugLog("getRandomIllust:success", {
          illustId: res.illustId,
          userId: res.userId,
          title: res.title,
          imageObjectUrl: res.imageObjectUrl,
          imageLoadedAsBlob: !!illustBlob,
          profileLoaded: !!profileBlob,
        });
        return res;
      } catch (e) {
        console.error("Error in getRandomIllust loop:", e);
        continue;
      }
    }
    debugLog("getRandomIllust:exhausted", { lastErrorMessage: this.lastErrorMessage });
    return null;
  }
}

/**
 * 将 Blob 对象转换为 Data URL
 * @param {Blob} blob - Blob 对象
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    let reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 全局搜索源实例
let searchSource;

/**
 * 标准化运行时配置
 * @param {object} config - 配置对象
 * @returns {object}
 */
function normalizeRuntimeConfig(config) {
  migrateConfig(config);
  applyActivePreset(config);
  config.minusKeywords = computeEffectiveMinus(config);
  return config;
}

/**
 * 从存储中获取配置
 * @returns {Promise<object>}
 */
async function getStoredConfig() {
  let config = await chrome.storage.local.get(defaultConfig);
  config = normalizeRuntimeConfig(config);
  config.resolvedDefaultImageUrl = await resolveDefaultImageUrl(config, {
    onLegacyMigrated: (patch) => chrome.storage.local.set(patch),
  });
  if (config.defaultImageSourceType === "upload") {
    config.defaultImageUrl = "";
  }
  return config;
}

function createManualRandomTagSearchSource(config, manualRandomTag) {
  const normalizedTag = String(manualRandomTag || "").trim();
  if (!normalizedTag) {
    return null;
  }
  const tempSource = new SearchSource(config);
  tempSource.buildQueryAttempts = function () {
    const baseQuery = buildQuery(this.searchParam).trim();
    const queryWord = [baseQuery, normalizedTag].filter(Boolean).join(" ").trim();
    if (!queryWord) {
      return [];
    }
    return [{
      queryWord,
      randomTags: [normalizedTag],
    }];
  };
  return tempSource;
}

/**
 * 构建默认图片响应
 * @param {object} config - 配置对象
 * @param {object} options - 选项
 * @returns {object|null}
 */
function buildDefaultImageResponse(config, options = {}) {
  const defaultImageUrl = (config.resolvedDefaultImageUrl || "").trim();
  if (!defaultImageUrl) {
    return null;
  }
  return {
    mode: "default",
    title: options.title || "Default background",
    userName: options.userName || "Configured default image",
    userId: null,
    illustId: null,
    userIdUrl: "",
    illustIdUrl: "",
    originalImageUrl: "",
    profileImageUrl: "",
    imageObjectUrl: defaultImageUrl,
    tags: [],
    fallback: !!options.fallback,
    message: options.message || null,
  };
}

/**
 * 应用激活的预设配置
 * @param {object} config - 配置对象
 * @returns {object}
 */
function applyActivePreset(config) {
  if (config.queryPresets && Array.isArray(config.queryPresets) && config.queryPresets.length > 0) {
    let idx = Math.min(config.activePresetIndex || 0, config.queryPresets.length - 1);
    if (config.queryPresets[idx] && config.queryPresets[idx].tree) {
      config.queryTree = config.queryPresets[idx].tree;
    }
  }
  return config;
}

/**
 * 计算有效的排除关键词
 * @param {object} config - 配置对象
 * @returns {string}
 */
function computeEffectiveMinus(config) {
  let globalMinus = (config.globalMinusKeywords || "").trim();
  return globalMinus.replace(/\s+/g, " ");
}

/**
 * 初始化后台脚本
 */
async function start() {
  let config = await getStoredConfig();
  // 持久化迁移后的配置（如果 orKeywords 被转换）
  chrome.storage.local.set({ orGroups: config.orGroups, orKeywords: null });
  console.log("Current search query:", buildQuery(config));
  searchSource = new SearchSource(config);
  console.log("background script loaded");
}

// 初始化后台脚本，失败时记录错误
let initPromise = start().catch((e) => {
  console.error("Background init failed:", e);
  return null;
});

/**
 * 监听来自前端的消息
 * 支持的操作：
 * - fetchImage: 获取随机图片
 * - updateConfig: 更新配置
 * - bookmarkIllust: 收藏作品
 * - excludeTag: 排除标签
 * - setCreatorPreference: 设置创作者偏好
 * - addRandomTag: 添加随机标签
 * - queueNextPriorityRandomTag: 队列下次优先的随机标签
 */
chrome.runtime.onMessage.addListener(function (
  message,
  sender,
  sendResponse
) {
  (
    async () => {
      try {
        await initPromise;
      } catch (e) {
        console.error("Init promise error:", e);
        sendResponse({
          error: "INIT_FAILED",
          message: "Background init failed. Please reload the extension."
        });
        return;
      }
      if (!searchSource) {
        sendResponse({
          error: "INIT_FAILED",
          message: "Background not ready. Please reload the extension."
        });
        return;
      }
      // 处理获取图片请求
      if (message.action === "fetchImage") {
        try {
          const currentConfig = searchSource.searchParam || await getStoredConfig();
          const manualRandomTag = String(message.manualRandomTag || "").trim();
          if (currentConfig.randomImageEnabled === false) {
            const defaultRes = buildDefaultImageResponse(currentConfig, {
              message: "Random images are disabled."
            });
            if (defaultRes) {
              sendResponse(defaultRes);
            } else {
              sendResponse({
                error: "DEFAULT_IMAGE_MISSING",
                message: "Random images are disabled and no default image is configured."
              });
            }
            return;
          }

          let res = null;
          let usedManualRandomTag = false;
          if (manualRandomTag) {
            const tempSource = createManualRandomTagSearchSource(currentConfig, manualRandomTag);
            if (tempSource) {
              res = await tempSource.getRandomIllust();
              usedManualRandomTag = !!res;
            }
          }
          if (!res) {
            res = await searchSource.getRandomIllust();
          }
          if (res) {
            res.mode = "random";
            res.fallback = false;
            res.usedManualRandomTag = manualRandomTag ? usedManualRandomTag : null;
            res.resolvedRandomTags = manualRandomTag && usedManualRandomTag
              ? [manualRandomTag]
              : (Array.isArray(searchSource.lastResolvedRandomTags)
                ? searchSource.lastResolvedRandomTags.slice()
                : []);
            sendResponse(res);
            let { profileImageUrl, imageObjectUrl, ...filteredRes } = res;
            console.log(filteredRes);
          } else {
            const fallbackRes = buildDefaultImageResponse(currentConfig, {
              fallback: true,
              message: searchSource.lastErrorMessage || "Failed to load a Pixiv image. Showing the default image instead."
            });
            if (fallbackRes) {
              sendResponse(fallbackRes);
            } else {
              sendResponse({
                error: "NO_RESULT",
                message: searchSource.lastErrorMessage || "No image found. Please check your tags or Pixiv availability."
              });
            }
          }
        } catch (e) {
          console.error("fetchImage handler error:", e);
          const currentConfig = searchSource.searchParam || await getStoredConfig();
          const fallbackRes = buildDefaultImageResponse(currentConfig, {
            fallback: true,
            message: "Failed to fetch image. Showing the default image instead."
          });
          if (fallbackRes) {
            sendResponse(fallbackRes);
          } else {
            sendResponse({
              error: "FETCH_FAILED",
              message: "Failed to fetch image. Please try again."
            });
          }
        }
      // 处理更新配置请求
      } else if (message.action === "updateConfig") {
        let config = await getStoredConfig();
        console.log("Updated search query:", buildQuery(config));
        searchSource.updateConfig(config);
        sendResponse({ success: true });
      // 处理收藏作品请求
      } else if (message.action === "bookmarkIllust") {
        try {
          const illustIdStr = String(message.illustId || "");
          if (!illustIdStr) {
            sendResponse({ success: false, error: "Invalid illust id" });
            return;
          }

          // 从 HTML 页面中提取 CSRF token
          const fetchTokenFromHtml = async (url) => {
            try {
              const res = await fetch(url, { credentials: "include" });
              console.log("[bookmark] HTML fetch", url, "status", res.status);
              if (!res.ok) return null;
              const html = await res.text();
              console.log("[bookmark] HTML length", html.length, "token match", /\"token\"\s*:\s*\"([a-f0-9]{32})\"/.test(html));
              const m = html.match(/"token"\s*:\s*"([a-f0-9]{32})"/);
              return m ? m[1] : null;
            } catch (e) {
              console.warn("[bookmark] HTML fetch error", url, e);
              return null;
            }
          };

          // 从 JSON 接口中提取 CSRF token
          const fetchTokenFromJson = async (url) => {
            try {
              const res = await fetch(url, { credentials: "include" });
              console.log("[bookmark] JSON fetch", url, "status", res.status);
              if (!res.ok) return null;
              const json = await res.json();
              console.log("[bookmark] JSON error", !!(json && json.error));
              if (json && json.error) return null;
              return (json && (json.token || (json.body && json.body.token))) || null;
            } catch (e) {
              console.warn("[bookmark] JSON fetch error", url, e);
              return null;
            }
          };

          // 1) 优先尝试 JSON 端点（无需页面导航）
          let token =
            (await fetchTokenFromJson("https://www.pixiv.net/ajax/user/extra")) ||
            (await fetchTokenFromJson("https://www.pixiv.net/ajax/user/extra?lang=zh"));

          // 2) 尝试 HTML 端点（无需页面导航）
          if (!token) {
            token =
              (await fetchTokenFromHtml(`https://www.pixiv.net/artworks/${illustIdStr}`)) ||
              (await fetchTokenFromHtml("https://www.pixiv.net/"));
          }

          // 3) 降级方案：如果用户已打开 Pixiv 标签页，从 DOM 中提取 token
          if (!token) {
            let tabs = await chrome.tabs.query({ url: "*://*.pixiv.net/*" });
            if (tabs.length > 0) {
              let tabId = tabs[0].id;
              console.log("[bookmark] DOM fallback tab", tabId);
              let results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                world: "MAIN",
                func: () => {
                  let token = null;
                  let meta = document.querySelector('#meta-global-data')
                    || document.querySelector('meta[name="global-data"]');
                  if (meta) {
                    try { token = JSON.parse(meta.getAttribute('content')).token; } catch (e) { }
                  }
                  if (!token && typeof pixiv !== 'undefined' && pixiv.context) {
                    token = pixiv.context.token;
                  }
                  if (!token && typeof globalInitData !== 'undefined') {
                    token = globalInitData.token;
                  }
                  if (!token) {
                    let nd = document.querySelector('#__NEXT_DATA__');
                    if (nd) {
                      try {
                        let data = JSON.parse(nd.textContent);
                        token = data?.props?.pageProps?.token;
                      } catch (e) { }
                    }
                  }
                  if (!token) {
                    for (let s of document.querySelectorAll('script')) {
                      let m = s.textContent.match(/"token"\s*:\s*"([a-f0-9]{32})"/);
                      if (m) { token = m[1]; break; }
                    }
                  }
                  return token;
                }
              });
              token = results && results[0] && results[0].result ? results[0].result : null;
              console.log("[bookmark] DOM fallback token found", !!token);
            }
          }

          if (!token) {
            sendResponse({
              success: false,
              code: "TOKEN_NOT_FOUND",
              error: "CSRF token not found. Please ensure you are logged in to Pixiv."
            });
            return;
          }

          // 调用 Pixiv 收藏 API
          let r;
          try {
            r = await fetch("https://www.pixiv.net/ajax/illusts/bookmarks/add", {
              method: "POST",
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
                "X-CSRF-Token": token,
              },
              body: JSON.stringify({
                illust_id: illustIdStr,
                restrict: 0,
                comment: "",
                tags: [],
              }),
              credentials: "include",
            });
          } catch (e) {
            sendResponse({ success: false, code: "BOOKMARK_FAILED", error: e.message || "Bookmark failed" });
            return;
          }

          if (!r.ok) {
            let msg = `HTTP ${r.status}`;
            if (r.status === 401 || r.status === 403) {
              msg = "Not logged in. Please log in to Pixiv.";
            }
            sendResponse({ success: false, code: "BOOKMARK_FAILED", error: msg });
            return;
          }

          let json = await r.json();
          if (json && json.error) {
            sendResponse({ success: false, code: "BOOKMARK_FAILED", error: json.message || "Bookmark failed" });
            return;
          }

          sendResponse({ success: true });
        } catch (e) {
          console.error("Bookmark error:", e);
          sendResponse({ success: false, error: e.message });
        }
      // 处理排除标签请求
      } else if (message.action === "excludeTag") {
        try {
          let config = await getStoredConfig();
          let tag = String(message.tag || "").trim();
          if (!tag) {
            sendResponse({ success: false, error: "Invalid tag" });
            return;
          }
          let list = (config.globalMinusKeywords || "").trim().split(/\s+/).filter(Boolean);
          if (!list.includes(tag)) list.push(tag);
          config.globalMinusKeywords = list.join(" ");

          applyActivePreset(config);
          config.minusKeywords = computeEffectiveMinus(config);
          await chrome.storage.local.set({
            globalMinusKeywords: config.globalMinusKeywords,
            presetMinusKeywords: [],
          });

          searchSource.updateConfig(config);
          sendResponse({ success: true });
        } catch (e) {
          console.error("Exclude tag error:", e);
          sendResponse({ success: false, error: e.message });
        }
      // 处理设置创作者偏好请求
      } else if (message.action === "setCreatorPreference") {
        try {
          const userId = String(message.userId || "").trim();
          const preference = String(message.preference || "").trim();
          if (!userId) {
            sendResponse({ success: false, error: "Invalid user id" });
            return;
          }
          if (!["like", "dislike", "neutral"].includes(preference)) {
            sendResponse({ success: false, error: "Invalid preference" });
            return;
          }
          let config = await getStoredConfig();
          const likedUserIds = Array.isArray(config.likedUserIds)
            ? config.likedUserIds.map((id) => String(id || "").trim()).filter(Boolean)
            : [];
          const dislikedUserIds = Array.isArray(config.dislikedUserIds)
            ? config.dislikedUserIds.map((id) => String(id || "").trim()).filter(Boolean)
            : [];
          const nextLikedUserIds = likedUserIds.filter((id) => id !== userId);
          const nextDislikedUserIds = dislikedUserIds.filter((id) => id !== userId);

          if (preference === "like") {
            nextLikedUserIds.push(userId);
          } else if (preference === "dislike") {
            nextDislikedUserIds.push(userId);
          }

          config.likedUserIds = nextLikedUserIds;
          config.dislikedUserIds = nextDislikedUserIds;

          await chrome.storage.local.set({
            likedUserIds: config.likedUserIds,
            dislikedUserIds: config.dislikedUserIds,
          });

          searchSource.updateConfig(config);
          sendResponse({
            success: true,
            preference,
            likedUserIds: config.likedUserIds,
            dislikedUserIds: config.dislikedUserIds,
          });
        } catch (e) {
          console.error("Set creator preference error:", e);
          sendResponse({ success: false, error: e.message });
        }
      // 处理屏蔽作品请求
      } else if (message.action === "blockIllust") {
        try {
          const illustId = String(message.illustId || "").trim();
          if (!illustId) {
            sendResponse({ success: false, error: "Invalid illust id" });
            return;
          }

          let config = await getStoredConfig();
          const blockedIllustIds = Array.isArray(config.blockedIllustIds)
            ? config.blockedIllustIds.map((id) => String(id || "").trim()).filter(Boolean)
            : [];
          if (!blockedIllustIds.includes(illustId)) {
            blockedIllustIds.push(illustId);
          }
          config.blockedIllustIds = blockedIllustIds;

          await chrome.storage.local.set({
            blockedIllustIds: config.blockedIllustIds,
          });

          searchSource.updateConfig(config);
          sendResponse({
            success: true,
            illustId,
            blockedIllustIds: config.blockedIllustIds,
          });
        } catch (e) {
          console.error("Block illust error:", e);
          sendResponse({ success: false, error: e.message });
        }
      // 处理添加随机标签请求
      } else if (message.action === "addRandomTag") {
        try {
          let config = await getStoredConfig();
          let tag = String(message.tag || "").trim();
          if (!tag) {
            sendResponse({ success: false, error: "Invalid tag" });
            return;
          }
          const pool = Array.isArray(config.randomTagPool)
            ? config.randomTagPool.map((item) => String(item || "").trim()).filter(Boolean)
            : [];
          if (!pool.includes(tag)) {
            pool.push(tag);
            await chrome.storage.local.set({
              randomTagPool: pool,
              randomTagPoolEnabled: true,
            });
          } else {
            await chrome.storage.local.set({
              randomTagPoolEnabled: true,
            });
          }
          config.randomTagPool = pool;
          config.randomTagPoolEnabled = true;

          searchSource.updateConfig(config);
          sendResponse({ success: true, added: true });
        } catch (e) {
          console.error("Add random tag error:", e);
          sendResponse({ success: false, error: e.message });
        }
      // 处理队列下次优先随机标签请求
      } else if (message.action === "queueNextPriorityRandomTag") {
        try {
          let config = await getStoredConfig();
          let tag = String(message.tag || "").trim();
          if (!tag) {
            sendResponse({ success: false, error: "Invalid tag" });
            return;
          }
          const pool = Array.isArray(config.randomTagPool)
            ? config.randomTagPool.map((item) => String(item || "").trim()).filter(Boolean)
            : [];
          if (!pool.includes(tag)) {
            pool.push(tag);
          }
          config.randomTagPool = pool;
          config.randomTagPoolNextPriorityTag = tag;
          config.randomTagPoolEnabled = true;

          await chrome.storage.local.set({
            randomTagPool: config.randomTagPool,
            randomTagPoolNextPriorityTag: config.randomTagPoolNextPriorityTag,
            randomTagPoolEnabled: config.randomTagPoolEnabled,
          });

          searchSource.updateConfig(config);
          sendResponse({ success: true, queued: true, tag });
        } catch (e) {
          console.error("Queue next priority random tag error:", e);
          sendResponse({ success: false, error: e.message });
        }
      } else {
        sendResponse({ success: false, error: "Unknown action" });
      }
    }
  )();
  return true;
});
