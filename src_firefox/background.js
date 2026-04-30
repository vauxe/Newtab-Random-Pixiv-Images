import { defaultConfig, getKeywords, buildQuery, migrateConfig, treeToLegacy } from "./config.js";

browser.webRequest.onBeforeSendHeaders.addListener(
  function (details) {
    let existed = false;
    let refName = "Referer";
    let refValue = "https://www.pixiv.net/";
    for (var i = 0; i < details.requestHeaders.length; ++i) {
      if (
        details.requestHeaders[i].name.toLowerCase() === refName.toLowerCase()
      ) {
        details.requestHeaders[i].value = refValue;
        existed = true;
        break;
      }
    }
    if (!existed) {
      details.requestHeaders.push({
        name: refName,
        value: refValue,
      });
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["*://*.pixiv.net/*", "*://*.pximg.net/*"] },
  ["blocking", "requestHeaders"]
);

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min);
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
      return null;
    }
    let res_json = await res.json();
    if (res_json.error) {
      console.error(`Pixiv API error: ${res_json.message}`);
      return null;
    }
    return res_json;
  } catch (e) {
    console.error(`Fetch pixiv json error:`, e);
    return null;
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
    this.illustInfoPages = {};
    this.maxCachedPages = 5;
    this.seenIds = new Set();
  }

  updateConfig(config) {
    this.searchParam = config;
    this.totalPage = 0;
    this.illustInfoPages = {};
    this.seenIds.clear();
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

  generateSearchUrl(p = 1) {
    let sp = this.searchParam;
    sp.p = p;
    let word = buildQuery(sp);
    let firstPart = encodeURIComponent(word);
    let secondPartArray = [];
    secondPartArray.push("?word=" + this.replaceSpecialCharacter(word));
    for (let o of this.params) {
      if (sp.hasOwnProperty(o) && sp[o]) {
        secondPartArray.push(`${o}=${sp[o]}`);
      }
    }
    let secondPart = secondPartArray.join("&");
    return firstPart + secondPart;
  }

  async searchIllustPage(p) {
    let paramUrl = this.generateSearchUrl(p);
    let jsonResult = await fetchPixivJson(baseUrl + searchUrl + paramUrl);
    return jsonResult;
  }

  async getRandomIllust() {
    const MAX_RETRIES = 8;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        if (this.totalPage === 0) {
          let firstPage = await this.searchIllustPage(1);
          if (!firstPage || !firstPage.body) continue;
          let total = firstPage.body.illust.total;
          this.totalPage = Math.ceil(total / this.itemsPerPage);
          if (this.totalPage === 0) return null;
        }

        // Prefer uncached pages for variety (70% chance to pick a fresh page)
        let randomPage;
        const cachedKeys = Object.keys(this.illustInfoPages).map(Number);
        const preferFresh = cachedKeys.length > 0 && Math.random() < 0.7;

        if (preferFresh && cachedKeys.length < this.totalPage) {
          do {
            randomPage = getRandomInt(0, this.totalPage) + 1;
          } while (cachedKeys.includes(randomPage) && cachedKeys.length < this.totalPage);
        } else {
          randomPage = getRandomInt(0, this.totalPage) + 1;
        }

        if (!this.illustInfoPages[randomPage]) {
          if (cachedKeys.length >= this.maxCachedPages) {
            const evictKey = cachedKeys[getRandomInt(0, cachedKeys.length)];
            delete this.illustInfoPages[evictKey];
          }

          let pageObj = await this.searchIllustPage(randomPage);
          if (!pageObj || !pageObj.body) continue;

          let total = pageObj.body.illust.total;
          let tp = Math.ceil(total / this.itemsPerPage);
          if (tp > this.totalPage) {
            this.totalPage = tp;
          }

          let pageData = pageObj.body.illust.data.filter(
            (el) => {
              let condition1 = !this.searchParam.min_sl || el.sl >= this.searchParam.min_sl;
              let condition2 = !this.searchParam.max_sl || el.sl <= this.searchParam.max_sl;
              let condition3 = !this.searchParam.aiType || el.aiType == this.searchParam.aiType;
              return condition1 && condition2 && condition3;
            }
          );

          // Fisher-Yates shuffle
          for (let j = pageData.length - 1; j > 0; j--) {
            const k = getRandomInt(0, j + 1);
            [pageData[j], pageData[k]] = [pageData[k], pageData[j]];
          }

          this.illustInfoPages[randomPage] = pageData;
        }

        let illustArray = this.illustInfoPages[randomPage];
        if (!illustArray || illustArray.length === 0) continue;

        // Filter out recently seen IDs
        let candidates = illustArray.filter(el => !this.seenIds.has(el.id));
        if (candidates.length === 0) {
          delete this.illustInfoPages[randomPage];
          continue;
        }

        let randomIndex = getRandomInt(0, candidates.length);
        let picked = candidates[randomIndex];

        this.seenIds.add(picked.id);
        if (this.seenIds.size > 200) {
          this.seenIds.clear();
        }

        let res = {};
        res.illustId = picked.id;
        res.profileImageUrl = picked.profileImageUrl;

        let illustInfo = await fetchPixivJson(baseUrl + illustInfoUrl + res.illustId);
        if (!illustInfo || !illustInfo.body) continue;

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
let illust_queue;
let running = 0;

function fillQueue() {
  while (running < illust_queue.capacity() - illust_queue.size()) {
    ++running;
    setTimeout(async () => {
      if (illust_queue.full()) { return; }
      let res = await searchSource.getRandomIllust();
      if (res) {
        illust_queue.push(res);
        browser.storage.session.set({ illustQueue: illust_queue });
      }
      --running;
    }, 0);
  }
}

async function start() {
  let config = await browser.storage.local.get(defaultConfig);
  migrateConfig(config);
  browser.storage.local.set({ orGroups: config.orGroups, orKeywords: null });
  searchSource = new SearchSource(config);
  let queue_cache = await browser.storage.session.get("illustQueue");

  if (Object.keys(queue_cache).length === 0) {
    illust_queue = new Queue(4);
  } else {
    illust_queue = Object.setPrototypeOf(queue_cache.illustQueue, Queue.prototype)
  }

  fillQueue();
  console.log("background script loaded");
}

let initPromise = start();

browser.runtime.onMessage.addListener(function (
  message,
  sender,
  sendResponse
) {
  (
    async () => {
      await initPromise;
      if (message.action === "fetchImage") {
        try {
          let res = illust_queue.pop();
          if (!res) {
            res = await searchSource.getRandomIllust();
          }
          if (res) {
            sendResponse(res);
            let { profileImageUrl, imageObjectUrl, ...filteredRes } = res;
            console.log(filteredRes);
          } else {
            sendResponse({
              error: "NO_RESULT",
              message: "No image found. Please check your tags or Pixiv availability."
            });
          }
          fillQueue();
        } catch (e) {
          console.error("fetchImage handler error:", e);
          sendResponse({
            error: "FETCH_FAILED",
            message: "Failed to fetch image. Please try again."
          });
        }
      } else if (message.action === "updateConfig") {
        let config = await browser.storage.local.get(defaultConfig);
        migrateConfig(config);
        console.log("Updated search query:", buildQuery(config));
        searchSource.updateConfig(config);
        illust_queue = new Queue(4);
        browser.storage.session.set({ illustQueue: illust_queue });
        fillQueue();
      } else if (message.action === "bookmarkIllust") {
        try {
          const attemptBookmark = async (illustId, retryCount = 0) => {
            // Find an existing Pixiv tab to inject into
            let tabs = await browser.tabs.query({ url: "*://*.pixiv.net/*" });
            let tabId;
            if (tabs.length > 0) {
              tabId = tabs[0].id;
            } else {
              // Open a Pixiv tab in background, wait for it to load
              let tab = await browser.tabs.create({ url: "https://www.pixiv.net/", active: false });
              tabId = tab.id;
              // Wait for the tab to finish loading
              await new Promise((resolve) => {
                let listener = (id, info) => {
                  if (id === tabId && info.status === "complete") {
                    browser.tabs.onUpdated.removeListener(listener);
                    resolve();
                  }
                };
                browser.tabs.onUpdated.addListener(listener);
                // Timeout after 15s
                setTimeout(() => { browser.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
              });
            }

            let illustIdStr = String(illustId);
            console.log("Bookmark: injecting into tab", tabId, "for illust", illustIdStr);

            // Inject script into the Pixiv tab to extract CSRF token and POST bookmark
            let results = await browser.scripting.executeScript({
              target: { tabId: tabId },
              world: "MAIN",
              func: async (illustId) => {
                // --- Extract CSRF token (try multiple sources) ---
                let token = null;

                // 1. Meta tag
                let meta = document.querySelector('#meta-global-data')
                  || document.querySelector('meta[name="global-data"]');
                if (meta) {
                  try { token = JSON.parse(meta.getAttribute('content')).token; } catch (e) { }
                }

                // 2. JS globals (Pixiv stores token in various places)
                if (!token && typeof pixiv !== 'undefined' && pixiv.context) {
                  token = pixiv.context.token;
                }
                if (!token && typeof globalInitData !== 'undefined') {
                  token = globalInitData.token;
                }

                // 3. __NEXT_DATA__ script tag
                if (!token) {
                  let nd = document.querySelector('#__NEXT_DATA__');
                  if (nd) {
                    try {
                      let data = JSON.parse(nd.textContent);
                      token = data?.props?.pageProps?.token;
                    } catch (e) { }
                  }
                }

                // 4. Search all script tags
                if (!token) {
                  for (let s of document.querySelectorAll('script')) {
                    let m = s.textContent.match(/"token"\s*:\s*"([a-f0-9]{32})"/);
                    if (m) { token = m[1]; break; }
                  }
                }

                // 5. Ultimate fallback: fetch current page HTML (same-origin, bypasses Cloudflare)
                if (!token) {
                  try {
                    let res = await fetch(location.href, { credentials: 'include' });
                    let html = await res.text();
                    let m = html.match(/"token"\s*:\s*"([a-f0-9]{32})"/);
                    if (m) token = m[1];
                  } catch (e) { }
                }

                if (!token) {
                  return { success: false, code: "TOKEN_NOT_FOUND", error: "CSRF token not found. Please refresh pixiv.net." };
                }

                // --- Send bookmark request (same-origin) ---
                try {
                  let r = await fetch("/ajax/illusts/bookmarks/add", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json; charset=utf-8",
                      "Accept": "application/json",
                      "X-CSRF-Token": token,
                    },
                    body: JSON.stringify({
                      illust_id: illustId,
                      restrict: 0,
                      comment: "",
                      tags: [],
                    }),
                    credentials: "include",
                  });
                  let json = await r.json();
                  if (json.error) {
                    return { success: false, code: "BOOKMARK_FAILED", error: json.message || "Bookmark failed" };
                  }
                  return { success: true };
                } catch (e) {
                  return { success: false, code: "BOOKMARK_FAILED", error: e.message };
                }
              },
              args: [illustIdStr],
            });

            let result = results && results[0] && results[0].result;
            console.log("Bookmark result:", result);
            if (result && result.code === "TOKEN_NOT_FOUND" && retryCount < 1) {
              // Retry once by reloading the Pixiv tab
              try {
                await browser.tabs.reload(tabId);
                await new Promise((resolve) => {
                  let listener = (id, info) => {
                    if (id === tabId && info.status === "complete") {
                      browser.tabs.onUpdated.removeListener(listener);
                      resolve();
                    }
                  };
                  browser.tabs.onUpdated.addListener(listener);
                  setTimeout(() => { browser.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
                });
              } catch (e) {
                console.warn("Pixiv tab reload failed:", e);
              }
              return attemptBookmark(illustIdStr, retryCount + 1);
            }
            return result || { success: false, code: "INJECT_FAILED", error: "Script injection failed" };
          };

          let result = await attemptBookmark(message.illustId, 0);
          if (result && result.code === "TOKEN_NOT_FOUND") {
            // Open login page to help user re-auth
            await browser.tabs.create({ url: "https://www.pixiv.net/login", active: true });
            sendResponse({
              success: false,
              error: "CSRF token not found. Opened Pixiv login page. Please log in and try again."
            });
            return;
          }
          sendResponse(result || { success: false, error: "Script injection failed" });
        } catch (e) {
          console.error("Bookmark error:", e);
          sendResponse({ success: false, error: e.message });
        }
      } else if (message.action === "excludeTag") {
        try {
          let config = await browser.storage.local.get({
            ...defaultConfig,
            queryPresets: null,
            activePresetIndex: 0,
          });
          migrateConfig(config);

          let tree = config.queryTree || { type: "group", connector: "AND", children: [] };
          // Add negated tag
          tree.children.push({ type: "tag", value: message.tag, negated: true });

          let legacy = treeToLegacy(tree);
          let saveData = {
            queryTree: tree,
            andKeywords: legacy.andKeywords,
            orGroups: legacy.orGroups,
            minusKeywords: legacy.minusKeywords,
          };

          // Also update active preset if presets exist
          if (config.queryPresets && Array.isArray(config.queryPresets) && config.queryPresets.length > 0) {
            let idx = config.activePresetIndex || 0;
            if (idx < config.queryPresets.length) {
              config.queryPresets[idx].tree = JSON.parse(JSON.stringify(tree));
            }
            saveData.queryPresets = config.queryPresets;
          }

          await browser.storage.local.set(saveData);
          searchSource.updateConfig({ ...config, ...saveData });
          illust_queue = new Queue(4);
          browser.storage.session.set({ illustQueue: illust_queue });
          fillQueue();
          sendResponse({ success: true });
        } catch (e) {
          console.error("Exclude tag error:", e);
          sendResponse({ success: false, error: e.message });
        }
      }
    }
  )();
  return true;
});
