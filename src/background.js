import { defaultConfig, buildQuery, sampleRandomTagPool, migrateConfig } from "./config.js";
import { resolveDefaultImageUrl } from "./default-image-store.js";

chrome.runtime.onInstalled.addListener((details) => {
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
      "priority": 1,
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
        initiatorDomains: [chrome.runtime.id],
        "urlFilter": "pximg.net",
        "resourceTypes": [
          "xmlhttprequest",
        ]
      }
    }
  ];
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULE.map(o => o.id),
    addRules: RULE,
  });
});

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = getRandomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
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

async function fetchPixivJson(url) {
  try {
    let res = await fetch(url);
    if (!res.ok) {
      console.error(`Fetch pixiv json failed: ${res.status} ${res.statusText}`);
      return { __error: true, message: `HTTP ${res.status} ${res.statusText}` };
    }
    let res_json = await res.json();
    if (res_json.error) {
      console.error(`Pixiv API error: ${res_json.message}`);
      return { __error: true, message: res_json.message || "Pixiv API error" };
    }
    return res_json;
  } catch (e) {
    console.error(`Fetch pixiv json error:`, e);
    return { __error: true, message: e && e.message ? e.message : "Network error" };
  }
}

async function fetchImage(url) {
  try {
    let res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch (e) {
    console.error(`Fetch image error:`, e);
    return null;
  }
}

let baseUrl = "https://www.pixiv.net";
let illustInfoUrl = "/ajax/illust/";
let searchUrl = "/ajax/search/illustrations/";

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
  }

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

  async searchIllustPage(p, queryWord = this.activeQueryWord) {
    let paramUrl = this.generateSearchUrl(p, queryWord);
    let jsonResult = await fetchPixivJson(baseUrl + searchUrl + paramUrl);
    if (jsonResult && jsonResult.__error) {
      this.lastErrorMessage = jsonResult.message;
      return null;
    }
    return jsonResult;
  }

  getSeenHistoryLimit() {
    return Number.isInteger(this.searchParam.seenHistoryLimit) && this.searchParam.seenHistoryLimit > 0
      ? this.searchParam.seenHistoryLimit
      : 300;
  }

  getSeenHistoryTtlMs() {
    return Number.isInteger(this.searchParam.seenHistoryTtlMs) && this.searchParam.seenHistoryTtlMs > 0
      ? this.searchParam.seenHistoryTtlMs
      : 21600000;
  }

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

  markSeen(illustId) {
    this.pruneSeenHistory();
    this.seenMap.set(illustId, Date.now());
  }

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

  filterIllustArray(illustArray) {
    if (!Array.isArray(illustArray)) {
      return [];
    }
    return illustArray.filter((el) => {
      let condition1 = !this.searchParam.min_sl || el.sl >= this.searchParam.min_sl;
      let condition2 = !this.searchParam.max_sl || el.sl <= this.searchParam.max_sl;
      let condition3 = !this.searchParam.aiType || el.aiType == this.searchParam.aiType;
      return condition1 && condition2 && condition3;
    });
  }

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

    return attempts;
  }

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
  }

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
      for (const pageNumber of pageNumbers) {
        const pageObj = await this.getPage(pageNumber, queryWord);
        if (!pageObj || !pageObj.body || !pageObj.body.illust) {
          continue;
        }
        const filtered = this.filterIllustArray(pageObj.body.illust.data);
        this.enqueueCandidates(filtered);
        if (this.candidateQueue.length >= this.candidateQueueTargetSize) {
          break;
        }
      }

      if (this.candidateQueue.length > 0) {
        await this.publishResolvedRandomTags(attempt.randomTags);
        return;
      }
    }
  }

  async getRandomIllust() {
    const MAX_RETRIES = 12;
    this.lastErrorMessage = null;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        await this.fillCandidateQueue();
        let picked = this.dequeueCandidate();
        if (!picked) {
          continue;
        }

        let res = {};
        res.illustId = picked.id;
        res.profileImageUrl = picked.profileImageUrl;

        let illustInfo = await fetchPixivJson(baseUrl + illustInfoUrl + res.illustId);
        if (!illustInfo || illustInfo.__error || !illustInfo.body) {
          if (illustInfo && illustInfo.__error) {
            this.lastErrorMessage = illustInfo.message;
          }
          continue;
        }

        res.userName = illustInfo.body.userName;
        res.userId = illustInfo.body.userId;
        res.illustId = illustInfo.body.illustId;
        res.userIdUrl = baseUrl + "/users/" + illustInfo.body.userId;
        res.illustIdUrl = baseUrl + "/artworks/" + illustInfo.body.illustId;
        res.title = illustInfo.body.title;
        res.imageObjectUrl = illustInfo.body.urls.regular;
        // Extract tags for frontend (prefer zh → zh_tw → en translation)
        res.tags = (illustInfo.body.tags && illustInfo.body.tags.tags || []).map(t => {
          let tr = t.translation || {};
          return {
            tag: t.tag,
            translation: tr.zh || tr.zh_tw || tr.en || null,
          };
        });

        let [imgBlob, profileBlob] = await Promise.all([
          fetchImage(res.imageObjectUrl),
          fetchImage(res.profileImageUrl)
        ]);

        if (!imgBlob) continue;
        res.imageObjectUrl = await blobToDataUrl(imgBlob);

        if (profileBlob) {
          try {
            res.profileImageUrl = await blobToDataUrl(profileBlob);
          } catch (e) {
            // ignore profile image error
          }
        }
        this.markSeen(picked.id);
        return res;
      } catch (e) {
        console.error("Error in getRandomIllust loop:", e);
        continue;
      }
    }
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    let reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

let searchSource;

function normalizeRuntimeConfig(config) {
  migrateConfig(config);
  applyActivePreset(config);
  config.minusKeywords = computeEffectiveMinus(config);
  return config;
}

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
    profileImageUrl: "",
    imageObjectUrl: defaultImageUrl,
    tags: [],
    fallback: !!options.fallback,
    message: options.message || null,
  };
}

function applyActivePreset(config) {
  if (config.queryPresets && Array.isArray(config.queryPresets) && config.queryPresets.length > 0) {
    let idx = Math.min(config.activePresetIndex || 0, config.queryPresets.length - 1);
    if (config.queryPresets[idx] && config.queryPresets[idx].tree) {
      config.queryTree = config.queryPresets[idx].tree;
    }
  }
  return config;
}

function computeEffectiveMinus(config) {
  let globalMinus = (config.globalMinusKeywords || "").trim();
  return globalMinus.replace(/\s+/g, " ");
}

async function start() {
  let config = await getStoredConfig();
  // Persist migrated config if orKeywords was converted
  chrome.storage.local.set({ orGroups: config.orGroups, orKeywords: null });
  console.log("Current search query:", buildQuery(config));
  searchSource = new SearchSource(config);
  console.log("background script loaded");
}

let initPromise = start().catch((e) => {
  console.error("Background init failed:", e);
  return null;
});

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
      if (message.action === "fetchImage") {
        try {
          const currentConfig = searchSource.searchParam || await getStoredConfig();
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

          let res = await searchSource.getRandomIllust();
          if (res) {
            res.mode = "random";
            res.fallback = false;
            res.resolvedRandomTags = Array.isArray(searchSource.lastResolvedRandomTags)
              ? searchSource.lastResolvedRandomTags.slice()
              : [];
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
      } else if (message.action === "updateConfig") {
        let config = await getStoredConfig();
        console.log("Updated search query:", buildQuery(config));
        searchSource.updateConfig(config);
        sendResponse({ success: true });
      } else if (message.action === "bookmarkIllust") {
        try {
          const illustIdStr = String(message.illustId || "");
          if (!illustIdStr) {
            sendResponse({ success: false, error: "Invalid illust id" });
            return;
          }

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

          // 1) Try JSON endpoints (no page navigation)
          let token =
            (await fetchTokenFromJson("https://www.pixiv.net/ajax/user/extra")) ||
            (await fetchTokenFromJson("https://www.pixiv.net/ajax/user/extra?lang=zh"));

          // 2) Try HTML endpoints (no page navigation)
          if (!token) {
            token =
              (await fetchTokenFromHtml(`https://www.pixiv.net/artworks/${illustIdStr}`)) ||
              (await fetchTokenFromHtml("https://www.pixiv.net/"));
          }

          // 3) Fallback: if user already has a Pixiv tab, extract token from DOM
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
