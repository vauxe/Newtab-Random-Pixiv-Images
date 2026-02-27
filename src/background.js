import { defaultConfig, buildQuery, migrateConfig } from "./config.js";

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
    this.seenIds = new Set(); // Track recently shown IDs to avoid repeats
    this.lastErrorMessage = null;
  }

  updateConfig(config) {
    this.searchParam = config;
    this.totalPage = 0;
    this.seenIds.clear();
    this.lastErrorMessage = null;
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
    if (jsonResult && jsonResult.__error) {
      this.lastErrorMessage = jsonResult.message;
      return null;
    }
    return jsonResult;
  }

  async getRandomIllust() {
    const MAX_RETRIES = 8;
    this.lastErrorMessage = null;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        if (this.totalPage === 0) {
          let firstPage = await this.searchIllustPage(1);
          if (!firstPage || !firstPage.body) continue;
          let total = firstPage.body.illust.total;
          this.totalPage = Math.ceil(total / this.itemsPerPage);
          if (this.totalPage === 0) return null;
        }

        let randomPage = getRandomInt(0, this.totalPage) + 1;
        let pageObj = await this.searchIllustPage(randomPage);
        if (!pageObj || !pageObj.body) continue;

        let total = pageObj.body.illust.total;
        let tp = Math.ceil(total / this.itemsPerPage);
        if (tp > this.totalPage) {
          this.totalPage = tp;
        }

        // filter images
        let illustArray = pageObj.body.illust.data.filter(
          (el) => {
            let condition1 = !this.searchParam.min_sl || el.sl >= this.searchParam.min_sl;
            let condition2 = !this.searchParam.max_sl || el.sl <= this.searchParam.max_sl;
            let condition3 = !this.searchParam.aiType || el.aiType == this.searchParam.aiType;
            return condition1 && condition2 && condition3;
          }
        );

        if (!illustArray || illustArray.length === 0) continue;

        // Filter out recently seen IDs
        let candidates = illustArray.filter(el => !this.seenIds.has(el.id));
        if (candidates.length === 0) continue;

        let randomIndex = getRandomInt(0, candidates.length);
        let picked = candidates[randomIndex];

        // Track as seen (auto-clear when set gets too large)
        this.seenIds.add(picked.id);
        if (this.seenIds.size > 200) {
          this.seenIds.clear();
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
  let config = await chrome.storage.local.get(defaultConfig);
  migrateConfig(config);
  // Persist migrated config if orKeywords was converted
  chrome.storage.local.set({ orGroups: config.orGroups, orKeywords: null });
  applyActivePreset(config);
  config.minusKeywords = computeEffectiveMinus(config);
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
          let res = await searchSource.getRandomIllust();
          if (res) {
            sendResponse(res);
            let { profileImageUrl, imageObjectUrl, ...filteredRes } = res;
            console.log(filteredRes);
          } else {
            sendResponse({
              error: "NO_RESULT",
              message: searchSource.lastErrorMessage || "No image found. Please check your tags or Pixiv availability."
            });
          }
        } catch (e) {
          console.error("fetchImage handler error:", e);
          sendResponse({
            error: "FETCH_FAILED",
            message: "Failed to fetch image. Please try again."
          });
        }
      } else if (message.action === "updateConfig") {
        let config = await chrome.storage.local.get(defaultConfig);
        migrateConfig(config);
        applyActivePreset(config);
        config.minusKeywords = computeEffectiveMinus(config);
        console.log("Updated search query:", buildQuery(config));
        searchSource.updateConfig(config);
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
          let config = await chrome.storage.local.get({
            ...defaultConfig,
            queryPresets: null,
            activePresetIndex: 0,
          });
          migrateConfig(config);
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
      }
    }
  )();
  return true;
});
