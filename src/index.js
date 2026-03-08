import { resolveDefaultImageUrl } from "./default-image-store.js";

(function () {
  // ── State ──
  let currentTags = [];
  let currentIllustId = null;
  let currentIllustUrl = null;
  let runtimeConfig = null;
  let currentImageVisible = false;
  let isRandomToggleBusy = false;
  let latestRefreshRequestId = 0;
  let activeTagPopupHandler = null;
  let activeTagPopupTrigger = null;
  let activeTagPopupPendingTags = new Set();
  let currentLikedTagsForImage = new Set();
  let currentQueuedPriorityTagForImage = "";
  let activeTagPopupMode = "exclude";
  let shouldRefreshOnTagPopupClose = false;
  const UI_STRINGS = {
    en: {
      randomLabel: "Random Pixiv",
      randomOn: "On",
      randomOff: "Off",
      randomEnabledTitle: "Random Pixiv image requests are enabled",
      randomDisabledTitle: "Random Pixiv image requests are disabled",
      settingsTitle: "Tag Manager",
      refreshTitle: "Refresh image",
      defaultBackgroundTitle: "Default background",
      configuredDefaultImage: "Configured default image",
      randomDisabledNoDefault: "Random images are off and no default image is configured.",
      failedLoadImage: "Failed to load image",
      bookmarkFailed: "Bookmark failed",
      bookmarked: "Bookmarked!",
      addRandomTagTitle: "Select tags to add to random pool",
      addRandomTagFailed: "Failed to add tag to random pool",
      addedRandomTag: "Added to random pool: {tag}",
      queuedNextRandomTag: "Next refresh will prioritize: {tag}",
      randomTagExists: "Tag already exists in random pool: {tag}",
      excludeTagTitle: "Select a tag to exclude",
      noTagsAvailable: "No tags available",
      excludeFailed: "Failed to exclude tag",
      excludedTag: "Excluded: -{tag}",
      randomSettingFailed: "Failed to update random image setting",
      fallbackDefaultImage: "Failed to load a Pixiv image. Showing the default image instead.",
      fetchFailedDefaultImage: "Failed to fetch image. Showing the default image instead.",
      noResult: "No image found. Please check your tags or Pixiv availability.",
    },
    zh: {
      randomLabel: "随机 Pixiv",
      randomOn: "开启",
      randomOff: "关闭",
      randomEnabledTitle: "当前会请求随机 Pixiv 图片",
      randomDisabledTitle: "当前不会请求随机 Pixiv 图片",
      settingsTitle: "标签管理",
      refreshTitle: "刷新图片",
      defaultBackgroundTitle: "默认背景",
      configuredDefaultImage: "已配置的默认图片",
      randomDisabledNoDefault: "随机图片已关闭，且尚未配置默认图片。",
      failedLoadImage: "图片加载失败",
      bookmarkFailed: "收藏失败",
      bookmarked: "已收藏",
      addRandomTagTitle: "选择要加入随机池的标签",
      addRandomTagFailed: "加入随机池失败",
      addedRandomTag: "已加入随机池：{tag}",
      queuedNextRandomTag: "下次刷新将优先使用：{tag}",
      randomTagExists: "随机池中已存在：{tag}",
      excludeTagTitle: "选择要排除的标签",
      noTagsAvailable: "当前图片没有可排除的标签",
      excludeFailed: "排除标签失败",
      excludedTag: "已排除：-{tag}",
      randomSettingFailed: "切换随机图片开关失败",
      fallbackDefaultImage: "Pixiv 图片加载失败，已改为显示默认图片。",
      fetchFailedDefaultImage: "图片请求失败，已改为显示默认图片。",
      noResult: "没有找到图片，请检查标签配置或 Pixiv 可用性。",
    },
    ja: {
      randomLabel: "Pixiv Random",
      randomOn: "On",
      randomOff: "Off",
      randomEnabledTitle: "Pixiv のランダム画像取得が有効です",
      randomDisabledTitle: "Pixiv のランダム画像取得が無効です",
      settingsTitle: "タグ管理",
      refreshTitle: "画像を更新",
      defaultBackgroundTitle: "デフォルト背景",
      configuredDefaultImage: "設定済みのデフォルト画像",
      randomDisabledNoDefault: "ランダム画像は無効で、デフォルト画像も未設定です。",
      failedLoadImage: "画像の読み込みに失敗しました",
      bookmarkFailed: "ブックマークに失敗しました",
      bookmarked: "ブックマークしました",
      addRandomTagTitle: "ランダムプールに追加する tag を選択",
      addRandomTagFailed: "ランダムプールへの追加に失敗しました",
      addedRandomTag: "ランダムプールに追加しました: {tag}",
      queuedNextRandomTag: "次回更新では優先して使用します: {tag}",
      randomTagExists: "ランダムプールに既に存在します: {tag}",
      excludeTagTitle: "除外する tag を選択",
      noTagsAvailable: "除外できるタグがありません",
      excludeFailed: "タグの除外に失敗しました",
      excludedTag: "除外済み: -{tag}",
      randomSettingFailed: "ランダム画像設定の更新に失敗しました",
      fallbackDefaultImage: "Pixiv 画像の読み込みに失敗したため、デフォルト画像を表示しています。",
      fetchFailedDefaultImage: "画像取得に失敗したため、デフォルト画像を表示しています。",
      noResult: "画像が見つかりません。タグ設定や Pixiv の状態を確認してください。",
    },
  };

  function getUiLanguage() {
    const raw = (chrome.i18n && chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : navigator.language || "en").toLowerCase();
    if (raw.startsWith("zh")) return "zh";
    if (raw.startsWith("ja")) return "ja";
    return "en";
  }

  function translate(key, variables = {}) {
    const language = getUiLanguage();
    const table = UI_STRINGS[language] || UI_STRINGS.en;
    let value = table[key] || UI_STRINGS.en[key] || key;
    for (const [name, replacement] of Object.entries(variables)) {
      value = value.replace(`{${name}}`, replacement);
    }
    return value;
  }

  function localizeRuntimeMessage(message) {
    if (!message) {
      return message;
    }
    const mapping = {
      "Random images are disabled and no default image is configured.": "randomDisabledNoDefault",
      "Failed to load a Pixiv image. Showing the default image instead.": "fallbackDefaultImage",
      "Failed to fetch image. Showing the default image instead.": "fetchFailedDefaultImage",
      "No image found. Please check your tags or Pixiv availability.": "noResult",
      "Failed to load image": "failedLoadImage",
    };
    return mapping[message] ? translate(mapping[message]) : message;
  }

  function applyUiText() {
    const randomToggleText = document.getElementById("randomToggleText");
    const refreshButton = document.getElementById("refreshButton");
    const settingsButton = document.getElementById("settingsButton");
    if (randomToggleText) {
      const enabled = runtimeConfig ? runtimeConfig.randomImageEnabled !== false : true;
      randomToggleText.innerHTML = `<strong>${translate("randomLabel")}</strong><small>${enabled ? translate("randomOn") : translate("randomOff")}</small>`;
    }
    if (refreshButton) {
      refreshButton.title = translate("refreshTitle");
    }
    if (settingsButton) {
      settingsButton.title = translate("settingsTitle");
    }
  }

  function warnNoDefaultImageIfNeeded() {
    if (!currentImageVisible) {
      showToast(translate("randomDisabledNoDefault"), "error");
    }
  }

  class Binding {
    constructor() {
      const bgElement = document.body.querySelector("#backgroundImage");
      const fgImageElement = document.body.querySelector("#foregroundImage");
      const avatarElement = document.body.querySelector("#avatar");
      const avatarImageElement = document.body.querySelector("#avatarImage");
      const illustTitleElement = document.body.querySelector("#illustTitle");
      const illustNameElement = document.body.querySelector("#illustName");
      const refreshElement = document.body.querySelector("#refreshButton");
      const settingsElement = document.body.querySelector("#settingsButton");
      const randomToggleInput = document.body.querySelector("#randomToggleInput");
      const randomToggleControl = document.body.querySelector("#randomToggleControl");
      const likeElement = document.body.querySelector("#likeButton");
      const dislikeElement = document.body.querySelector("#dislikeButton");
      const containerElement = document.body.querySelector("#container");
      const wallpaperElement = document.body.querySelector("#wallpaper");
      const illustInfoElement = document.body.querySelector("#illustInfo");
      this.containerElement = containerElement;
      this.illustInfoElement = illustInfoElement;
      this.randomToggleInput = randomToggleInput;
      this.randomToggleControl = randomToggleControl;

      const userNameBinding = (v) => {
        avatarImageElement.title = v;
        let e = illustNameElement.querySelector("a");
        e.text = v;
        let sw = e.scrollWidth;
        if (sw > 133) {
          let cutIndex = Math.floor((e.text.length * 123) / sw);
          e.text = v.slice(0, cutIndex) + "...";
        }
      };
      const userIdUrlBinding = (v) => {
        illustNameElement.querySelector("a").href = v;
      };
      const titleBinding = (v) => {
        illustTitleElement.title = v;
        let e = illustTitleElement.querySelector("a");
        e.text = v;
        let sw = e.scrollWidth;
        if (sw > 133) {
          let cutIndex = Math.floor((e.text.length * 123) / sw);
          e.text = v.slice(0, cutIndex) + "...";
        }
      };
      const illustIdUrlBinding = (v) => {
        illustTitleElement.querySelector("a").href = v;
      };
      const avatarBinding = (v) => {
        avatarElement.href = v;
      };
      const avatarImageBinding = (v) => {
        avatarImageElement.style["background-image"] = `url(${v})`;
      };
      const bgImageBinding = (v) => {
        bgElement.style["background-image"] = `url(${v})`;
      };
      const fgElementBinding = (v) => {
        fgImageElement.style["background-image"] = `url(${v})`;
      };
      this.ref = {
        userName: [userNameBinding],
        userIdUrl: [userIdUrlBinding, avatarBinding],
        illustIdUrl: [illustIdUrlBinding],
        title: [titleBinding],
        profileImageUrl: [avatarImageBinding],
        imageObjectUrl: [bgImageBinding, fgElementBinding],
      };

      refreshElement.addEventListener("mousedown", () => {
        refreshElement.className = "pressed";
      });
      refreshElement.addEventListener("mouseup", () => {
        refreshElement.className = "unpressed";
      });
      refreshElement.addEventListener("click", refreshCurrentPageImage);
      settingsElement.addEventListener("click", () => {
        if (chrome && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: chrome.runtime.getURL("tags.html") });
        } else {
          window.open(chrome.runtime.getURL("tags.html"), "_blank");
        }
      });
      randomToggleInput.addEventListener("change", handleRandomToggleChange);

      // Like button
      likeElement.addEventListener("click", handleLike);

      // Dislike button
      dislikeElement.addEventListener("click", handleDislike);

      this.illustInfoFadeOutTimeoutId = null;
      illustInfoElement.addEventListener("mouseleave", () => {
        this.illustInfoFadeOutTimeoutId = setTimeout(() => {
          this.illustInfoElement.className = "unfocused";
        }, 10000);
      });
      illustInfoElement.addEventListener("mouseenter", () => {
        illustInfoElement.className = "focused";
        clearTimeout(this.illustInfoFadeOutTimeoutId);
      });
      illustInfoElement.addEventListener("mouseover", () => {
        illustInfoElement.className = "focused";
        clearTimeout(this.illustInfoFadeOutTimeoutId);
      });
    }
  }
  var binding = null;
  function initApplication() {
    binding = new Binding();
    // Close popup on clicking outside
    document.addEventListener("click", (e) => {
      const popup = document.getElementById("tagPopup");
      const triggerElement = activeTagPopupTrigger;
      if (!popup.classList.contains("hidden") &&
        !popup.contains(e.target) &&
        !(triggerElement && triggerElement.contains(e.target))) {
        closeTagPopup();
      }
    });
  }

  function updateActionButtons() {
    const likeBtn = document.getElementById("likeButton");
    const dislikeBtn = document.getElementById("dislikeButton");
    likeBtn.classList.toggle("disabled", !currentTags || currentTags.length === 0);
    dislikeBtn.classList.toggle("disabled", !currentTags || currentTags.length === 0);
  }

  function setRandomToggleState(enabled) {
    if (!binding || !binding.randomToggleInput) return;
    binding.randomToggleInput.checked = !!enabled;
    binding.randomToggleControl.title = enabled
      ? translate("randomEnabledTitle")
      : translate("randomDisabledTitle");
    applyUiText();
  }

  function setRandomToggleBusy(isBusy) {
    isRandomToggleBusy = isBusy;
    if (!binding || !binding.randomToggleInput) return;
    binding.randomToggleInput.disabled = isBusy;
    binding.randomToggleControl.classList.toggle("disabled", isBusy);
  }

  function createDefaultDisplayObject(config, options = {}) {
    const defaultImageUrl = (config && config.resolvedDefaultImageUrl ? config.resolvedDefaultImageUrl : "").trim();
    if (!defaultImageUrl) {
      return null;
    }
    return {
      mode: "default",
      title: options.title || "Default background",
      userName: options.userName || translate("configuredDefaultImage"),
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

  function loadStartupConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get({
        randomImageEnabled: true,
        defaultImageUrl: "",
        defaultImageSourceType: "url",
        defaultImageUploadName: "",
      }, async (items) => {
        const config = items || {
          randomImageEnabled: true,
          defaultImageUrl: "",
          defaultImageSourceType: "url",
          defaultImageUploadName: "",
        };
        config.resolvedDefaultImageUrl = await resolveDefaultImageUrl(config, {
          onLegacyMigrated: (patch) => new Promise((patchResolve) => {
            chrome.storage.local.set(patch, patchResolve);
          })
        });
        if (config.defaultImageSourceType === "upload") {
          config.defaultImageUrl = "";
        }
        resolve(config);
      });
    });
  }

  function handleStoredRandomImageEnabledChange(enabled) {
    if (!runtimeConfig) {
      return;
    }
    const previousEnabled = runtimeConfig.randomImageEnabled !== false;
    runtimeConfig.randomImageEnabled = enabled;
    setRandomToggleState(enabled);
    if (isRandomToggleBusy || previousEnabled === enabled) {
      return;
    }
    if (enabled) {
      sendRefreshMessage();
      return;
    }
    latestRefreshRequestId += 1;
    showConfiguredDefaultImage().then((hasDefaultImage) => {
      if (!hasDefaultImage) {
        showToast("Random images are disabled and no default image is configured.", "error");
      }
    });
  }

  async function refreshRuntimeDefaultImageConfig(changes) {
    if (!runtimeConfig) {
      return;
    }

    if (changes.defaultImageUrl) {
      runtimeConfig.defaultImageUrl = typeof changes.defaultImageUrl.newValue === "string"
        ? changes.defaultImageUrl.newValue
        : "";
    }
    if (changes.defaultImageSourceType) {
      runtimeConfig.defaultImageSourceType = changes.defaultImageSourceType.newValue || "url";
    }
    if (changes.defaultImageUploadName) {
      runtimeConfig.defaultImageUploadName = typeof changes.defaultImageUploadName.newValue === "string"
        ? changes.defaultImageUploadName.newValue
        : "";
    }

    runtimeConfig.resolvedDefaultImageUrl = await resolveDefaultImageUrl(runtimeConfig, {
      onLegacyMigrated: (patch) => new Promise((patchResolve) => {
        chrome.storage.local.set(patch, patchResolve);
      }),
    });

    if (runtimeConfig.defaultImageSourceType === "upload") {
      runtimeConfig.defaultImageUrl = "";
    }

    if (runtimeConfig.randomImageEnabled === false) {
      const hasDefaultImage = await showConfiguredDefaultImage();
      if (!hasDefaultImage) {
        warnNoDefaultImageIfNeeded();
      }
    }
  }

  async function showConfiguredDefaultImage(options = {}) {
    const defaultDisplay = createDefaultDisplayObject(runtimeConfig, options);
    if (!defaultDisplay) {
      return false;
    }
    await changeElement(defaultDisplay);
    return true;
  }

  function persistRandomImageEnabled(enabled) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ randomImageEnabled: enabled }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        chrome.runtime.sendMessage({ action: "updateConfig" }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        });
      });
    });
  }

  async function changeElement(illustObject) {
    if (!illustObject) { return; }
    if (illustObject.error) {
      showToast(localizeRuntimeMessage(illustObject.message) || translate("failedLoadImage"), "error");
      return;
    }

    // Store tags and illustId for like/dislike
    currentTags = illustObject.tags || [];
    currentIllustId = illustObject.illustId || null;
    currentIllustUrl = illustObject.illustIdUrl || null;
    currentImageVisible = !!illustObject.imageObjectUrl;
    currentLikedTagsForImage = new Set();
    currentQueuedPriorityTagForImage = "";
    console.log("Illust tags:", currentTags.map(t => t.tag));

    // Reset like state
    const likeBtn = document.getElementById("likeButton");
    likeBtn.classList.remove("liked");

    // Close tag popup if open
    closeTagPopup({ triggerRefresh: false });

    for (let k in binding.ref) {
      if (illustObject.hasOwnProperty(k)) {
        let value = illustObject[k];
        if (value === null || value === undefined) {
          if (k === 'userName' || k === 'title') value = '';
        }
        for (let o of binding.ref[k]) {
          o(value);
        }
      }
    }
    updateActionButtons();
    binding.containerElement.classList.toggle("notReady", false);
    clearTimeout(binding.illustInfoFadeOutTimeoutId);
    binding.illustInfoFadeOutTimeoutId = setTimeout(() => {
      binding.illustInfoElement.className = "unfocused";
    }, 10000);
    if (illustObject.fallback && illustObject.message) {
      showToast(localizeRuntimeMessage(illustObject.message), "error");
    }
  }

  // ── Like (add to random tag pool) ──
  function handleLike() {
    if (!currentTags || currentTags.length === 0) {
      showToast(translate("noTagsAvailable"), "error");
      return;
    }
    openTagPopup(currentTags, {
      title: translate("addRandomTagTitle"),
      mode: "random",
      expanded: true,
      triggerElement: document.getElementById("likeButton"),
      onSelect: addTagToRandomPool,
    });
  }

  function addTagToRandomPool(tag) {
    if (activeTagPopupPendingTags.has(tag)) {
      return;
    }
    if (currentLikedTagsForImage.has(tag)) {
      queueNextPriorityRandomTag(tag);
      return;
    }
    activeTagPopupPendingTags.add(tag);
    setTagChipPending(tag, true);
    chrome.runtime.sendMessage(
      { action: "addRandomTag", tag },
      (res) => {
        activeTagPopupPendingTags.delete(tag);
        setTagChipPending(tag, false);
        if (chrome.runtime.lastError) {
          showToast(translate("addRandomTagFailed"), "error");
          return;
        }
        if (res && res.success && res.added !== false) {
          document.getElementById("likeButton").classList.add("liked");
          markTagChipState(tag, "selected-like");
          currentLikedTagsForImage.add(tag);
          showToast(translate("addedRandomTag", { tag }), "success");
        } else if (res && res.success && res.exists) {
          markTagChipState(tag, "selected-like");
          currentLikedTagsForImage.add(tag);
          showToast(translate("randomTagExists", { tag }), "success");
        } else {
          showToast(res?.error || translate("addRandomTagFailed"), "error");
        }
      }
    );
  }

  function queueNextPriorityRandomTag(tag) {
    if (activeTagPopupPendingTags.has(tag)) {
      return;
    }
    activeTagPopupPendingTags.add(tag);
    setTagChipPending(tag, true);
    chrome.runtime.sendMessage(
      { action: "queueNextPriorityRandomTag", tag },
      (res) => {
        activeTagPopupPendingTags.delete(tag);
        setTagChipPending(tag, false);
        if (chrome.runtime.lastError) {
          showToast(translate("addRandomTagFailed"), "error");
          return;
        }
        if (res && res.success) {
          if (currentQueuedPriorityTagForImage && currentQueuedPriorityTagForImage !== tag) {
            markTagChipState(
              currentQueuedPriorityTagForImage,
              currentLikedTagsForImage.has(currentQueuedPriorityTagForImage) ? "selected-like" : ""
            );
          }
          currentQueuedPriorityTagForImage = tag;
          currentLikedTagsForImage.add(tag);
          markTagChipState(tag, "queued-next");
          showToast(translate("queuedNextRandomTag", { tag }), "success");
        } else {
          showToast(res?.error || translate("addRandomTagFailed"), "error");
        }
      }
    );
  }

  // ── Dislike (show tag popup) ──
  function handleDislike() {
    if (!currentTags || currentTags.length === 0) {
      showToast(translate("noTagsAvailable"), "error");
      return;
    }
    openTagPopup(currentTags, {
      title: translate("excludeTagTitle"),
      mode: "exclude",
      triggerElement: document.getElementById("dislikeButton"),
      onSelect: excludeTag,
    });
  }

  function openTagPopup(tags, options = {}) {
    const popup = document.getElementById("tagPopup");
    const popupHeader = popup.querySelector(".tag-popup-header");
    const tagList = document.getElementById("tagList");
    activeTagPopupPendingTags = new Set();
    activeTagPopupMode = options.mode === "random" ? "random" : "exclude";
    shouldRefreshOnTagPopupClose = false;
    popupHeader.textContent = options.title || translate("excludeTagTitle");
    tagList.innerHTML = "";
    activeTagPopupHandler = typeof options.onSelect === "function" ? options.onSelect : null;
    activeTagPopupTrigger = options.triggerElement || null;
    popup.classList.toggle("expanded", !!options.expanded);
    popup.classList.toggle("mode-random", options.mode === "random");
    popup.classList.toggle("mode-exclude", options.mode !== "random");

    tags.forEach((t) => {
      const chip = document.createElement("div");
      chip.className = "tag-chip";
      chip.dataset.tag = t.tag;
      let html = `<span class="tag-name">${escapeHtml(t.tag)}</span>`;
      if (t.translation) {
        html += ` <span class="tag-translation">(${escapeHtml(t.translation)})</span>`;
      }
      chip.innerHTML = html;
      chip.addEventListener("click", () => {
        if (activeTagPopupHandler) {
          activeTagPopupHandler(t.tag);
        }
      });
      tagList.appendChild(chip);
      if (activeTagPopupMode === "random" && currentQueuedPriorityTagForImage && currentQueuedPriorityTagForImage === t.tag) {
        markTagChipState(t.tag, "queued-next");
      } else if (activeTagPopupMode === "random" && currentLikedTagsForImage.has(t.tag)) {
        markTagChipState(t.tag, "selected-like");
      }
    });

    popup.classList.remove("hidden");
  }

  function closeTagPopup(options = {}) {
    const popup = document.getElementById("tagPopup");
    const shouldTriggerRefresh = options.triggerRefresh !== false
      && activeTagPopupMode === "exclude"
      && shouldRefreshOnTagPopupClose;
    popup.classList.add("hidden");
    popup.classList.remove("expanded", "mode-random", "mode-exclude");
    activeTagPopupHandler = null;
    activeTagPopupTrigger = null;
    activeTagPopupPendingTags = new Set();
    activeTagPopupMode = "exclude";
    shouldRefreshOnTagPopupClose = false;
    if (shouldTriggerRefresh) {
      sendRefreshMessage();
    }
  }

  function excludeTag(tag) {
    if (activeTagPopupPendingTags.has(tag) || getTagChipState(tag) === "selected-dislike") {
      return;
    }
    activeTagPopupPendingTags.add(tag);
    setTagChipPending(tag, true);
    chrome.runtime.sendMessage(
      { action: "excludeTag", tag: tag, scope: "global" },
      (res) => {
        activeTagPopupPendingTags.delete(tag);
        setTagChipPending(tag, false);
        if (chrome.runtime.lastError) {
          showToast(translate("excludeFailed"), "error");
          return;
        }
        if (res && res.success) {
          markTagChipState(tag, "selected-dislike");
          shouldRefreshOnTagPopupClose = true;
          showToast(translate("excludedTag", { tag }), "success");
        } else {
          showToast(res?.error || translate("excludeFailed"), "error");
        }
      }
    );
  }

  function getTagChipByTag(tag) {
    return document.querySelector(`.tag-chip[data-tag="${CSS.escape(tag)}"]`);
  }

  function getTagChipState(tag) {
    const chip = getTagChipByTag(tag);
    if (!chip) {
      return "";
    }
    if (chip.classList.contains("selected-like")) {
      return "selected-like";
    }
    if (chip.classList.contains("queued-next")) {
      return "queued-next";
    }
    if (chip.classList.contains("selected-dislike")) {
      return "selected-dislike";
    }
    return "";
  }

  function markTagChipState(tag, state) {
    const chip = getTagChipByTag(tag);
    if (!chip) {
      return;
    }
    chip.classList.remove("selected-like", "queued-next", "selected-dislike");
    if (state) {
      chip.classList.add(state);
    }
  }

  function setTagChipPending(tag, pending) {
    const chip = getTagChipByTag(tag);
    if (!chip) {
      return;
    }
    chip.classList.toggle("pending", !!pending);
  }

  // ── Toast ──
  let toastTimer = null;
  function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = `toast toast-${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = "toast"; }, 2500);
  }

  // ── Util ──
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  const sendRefreshMessage = (() => {
    let isRequestInProgress = false;
    return () => {
      if (runtimeConfig && runtimeConfig.randomImageEnabled === false) {
        showConfiguredDefaultImage().then((hasDefaultImage) => {
          if (!hasDefaultImage) {
            warnNoDefaultImageIfNeeded();
          }
        });
        return;
      }
      if (isRequestInProgress) {
        return;
      }
      isRequestInProgress = true;
      const requestId = ++latestRefreshRequestId;
      console.log("Refresh: sending fetchImage");
      chrome.runtime.sendMessage({ action: "fetchImage" }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn("Context invalidated, message could not be processed:", chrome.runtime.lastError.message);
          isRequestInProgress = false;
          return;
        }
        if (requestId !== latestRefreshRequestId || (runtimeConfig && runtimeConfig.randomImageEnabled === false)) {
          isRequestInProgress = false;
          return;
        }
        try {
          changeElement(res).finally(() => {
            isRequestInProgress = false;
          });
        } catch (e) {
          console.error("changeElement error:", e);
          isRequestInProgress = false;
        }
      });
    };
  })();

  function refreshCurrentPageImage() {
    sendRefreshMessage();
  }

  async function handleRandomToggleChange(event) {
    if (!runtimeConfig || isRandomToggleBusy) {
      if (binding && binding.randomToggleInput) {
        binding.randomToggleInput.checked = runtimeConfig ? runtimeConfig.randomImageEnabled !== false : true;
      }
      return;
    }

    const nextEnabled = !!event.target.checked;
    const previousEnabled = runtimeConfig.randomImageEnabled !== false;

    if (nextEnabled === previousEnabled) {
      return;
    }

    setRandomToggleBusy(true);
    try {
      await persistRandomImageEnabled(nextEnabled);
      runtimeConfig.randomImageEnabled = nextEnabled;
      setRandomToggleState(nextEnabled);

      if (nextEnabled) {
        sendRefreshMessage();
      } else {
        latestRefreshRequestId += 1;
        const hasDefaultImage = await showConfiguredDefaultImage();
        if (!hasDefaultImage) {
          warnNoDefaultImageIfNeeded();
        }
      }
    } catch (error) {
      console.error("Failed to update random image setting:", error);
      runtimeConfig.randomImageEnabled = previousEnabled;
      setRandomToggleState(previousEnabled);
      showToast(translate("randomSettingFailed"), "error");
    } finally {
      setRandomToggleBusy(false);
    }
  }

  async function bootstrap() {
    initApplication();
    updateActionButtons();
    runtimeConfig = await loadStartupConfig();
    applyUiText();
    setRandomToggleState(runtimeConfig.randomImageEnabled !== false);

    const hasDefaultImage = await showConfiguredDefaultImage({
      title: translate("defaultBackgroundTitle"),
      userName: translate("configuredDefaultImage"),
    });

    if (!hasDefaultImage && runtimeConfig.randomImageEnabled === false) {
      binding.containerElement.classList.toggle("notReady", false);
      warnNoDefaultImageIfNeeded();
    }

    if (runtimeConfig.randomImageEnabled !== false) {
      sendRefreshMessage();
    }
    console.log("content script loaded");
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    if (changes.randomImageEnabled) {
      handleStoredRandomImageEnabledChange(changes.randomImageEnabled.newValue !== false);
    }
    if (changes.defaultImageUrl || changes.defaultImageSourceType || changes.defaultImageUploadName) {
      refreshRuntimeDefaultImageConfig(changes).catch((error) => {
        console.error("Failed to refresh default image config:", error);
      });
    }
  });

  bootstrap();
})();
