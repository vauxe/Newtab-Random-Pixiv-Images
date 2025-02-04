import { defaultConfig, getKeywords } from "./config.js";

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
  let res = await fetch(url);
  let res_json = await res.json();
  if (res_json.error == true) {
    console.error(`Fetch pixiv json error: ${res_json}`);
  }
  return res_json;
}

async function fetchImage(url) {
  let res = await fetch(url);
  return await res.blob();
}

let baseUrl = "https://www.pixiv.net";
let illustInfoUrl = "/ajax/illust/";
let searchUrl = "/ajax/search/illustrations/";

class SearchSource {
  constructor(config) {
    this.searchParam = config;
    this.params = ["order", "mode", "p", "s_mode", "type", "scd", "ecd", "blt", "bgt"];
    this.totalPage = 1;
    this.itemsPerPage = 60;
    this.illustInfoPages = {};
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
    let word = getKeywords(sp.andKeywords, sp.orKeywords, sp.minusKeywords);
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
    let randomPage = getRandomInt(0, Math.min(this.totalPage, 1000)) + 1;
    if (!this.illustInfoPages[randomPage]) {
      let pageObj = await this.searchIllustPage(randomPage);
      if (!pageObj) {
        console.error('Fetch empty page, maybe search params is flawed');
      }
      let total = pageObj.body.illust.total;
      let tp = Math.ceil(total / this.itemsPerPage);
      if (tp > this.totalPage) {
        this.totalPage = tp;
      }
      // filter images
      pageObj.body.illust.data = pageObj.body.illust.data.filter(
        (el) => {
          let condition1 = !this.searchParam.min_sl || el.sl >= this.searchParam.min_sl;
          let condition2 = !this.searchParam.max_sl || el.sl <= this.searchParam.max_sl;
          let condition3 = !this.searchParam.aiType || el.aiType == this.searchParam.aiType;
          return condition1 && condition2 && condition3;
        }
      );
      this.illustInfoPages[randomPage] = pageObj.body.illust.data;
    }
    let illustArray = this.illustInfoPages[randomPage];
    let randomIndex = getRandomInt(0, illustArray.length);
    let res = {};
    res.illustId = illustArray[randomIndex].id;
    res.profileImageUrl = illustArray[randomIndex].profileImageUrl;
    let illustInfo = await fetchPixivJson(baseUrl + illustInfoUrl + res.illustId);

    res.userName = illustInfo.body.userName;
    res.userId = illustInfo.body.userId;
    res.illustId = illustInfo.body.illustId;
    res.userIdUrl = baseUrl + "/users/" + illustInfo.body.userId;
    res.illustIdUrl = baseUrl + "/artworks/" + illustInfo.body.illustId;
    res.title = illustInfo.body.title;
    res.imageObjectUrl = illustInfo.body.urls.regular;
    await Promise.all([
      fetchImage(res.imageObjectUrl)
        .then((blob) => blobToDataUrl(blob))
        .then((url) => { res.imageObjectUrl = url; }),
      fetchImage(res.profileImageUrl)
        .then((blob) => blobToDataUrl(blob))
        .then((url) => { res.profileImageUrl = url; })
    ]);
    return res;
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

async function start() {
  let config = await chrome.storage.local.get(defaultConfig);
  let searchSource = new SearchSource(config);
  let queue_cache = await chrome.storage.session.get("illustQueue");
  let illust_queue;
  if (Object.keys(queue_cache).length === 0) {
    illust_queue = new Queue(2, []);
  } else {
    illust_queue = Object.setPrototypeOf(queue_cache.illustQueue, Queue.prototype)
  }

  let running = 0;
  while (running < illust_queue.capacity() - illust_queue.size()) {
    ++running;
    setTimeout(async () => {
      if (illust_queue.full()) { return; }
      let res = await searchSource.getRandomIllust();
      illust_queue.push(res);
      chrome.storage.session.set({ illustQueue: illust_queue });
      --running;
    }, 0);
  }

  chrome.runtime.onMessage.addListener(function (
    message,
    sender,
    sendResponse
  ) {
    (
      async () => {
        if (message.action === "fetchImage") {
          let res = illust_queue.pop();
          if (!res) {
            res = await searchSource.getRandomIllust();
          }
          sendResponse(res);
          let { profileImageUrl, imageObjectUrl, ...filteredRes } = res;
          console.log(filteredRes);
          while (running < illust_queue.capacity() - illust_queue.size()) {
            ++running;
            setTimeout(async () => {
              if (illust_queue.full()) { return; }
              let res = await searchSource.getRandomIllust();
              illust_queue.push(res);
              chrome.storage.session.set({ illustQueue: illust_queue });
              --running;
            }, 0);
          }
        } else if (message.action === "updateConfig") {
          let config = await chrome.storage.local.get(defaultConfig);
          Object.assign(searchSource.searchParam, config);
        }
      }
    )();
    return true;
  });
  console.log("background script loaded");
};

start();
