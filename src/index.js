import { resolveDefaultImageUrl } from "./default-image-store.js";

(function () {
  // ── State ──
  let currentTags = [];
  let currentIllustId = null;
  let currentIllustUrl = null;
  let runtimeConfig = null;
  let isRandomToggleBusy = false;
  let latestRefreshRequestId = 0;

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
    // Tag popup close
    document.getElementById("tagPopupClose").addEventListener("click", closeTagPopup);
    // Close popup on clicking outside
    document.addEventListener("click", (e) => {
      const popup = document.getElementById("tagPopup");
      const dislikeBtn = document.getElementById("dislikeButton");
      if (!popup.classList.contains("hidden") &&
        !popup.contains(e.target) &&
        !dislikeBtn.contains(e.target)) {
        closeTagPopup();
      }
    });
  }

  function updateActionButtons() {
    const likeBtn = document.getElementById("likeButton");
    const dislikeBtn = document.getElementById("dislikeButton");
    likeBtn.classList.toggle("disabled", !currentIllustId);
    dislikeBtn.classList.toggle("disabled", !currentTags || currentTags.length === 0);
  }

  function setRandomToggleState(enabled) {
    if (!binding || !binding.randomToggleInput) return;
    binding.randomToggleInput.checked = !!enabled;
    binding.randomToggleControl.title = enabled
      ? "Random Pixiv image requests are enabled"
      : "Random Pixiv image requests are disabled";
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
      showToast(illustObject.message || "Failed to load image", "error");
      return;
    }

    // Store tags and illustId for like/dislike
    currentTags = illustObject.tags || [];
    currentIllustId = illustObject.illustId || null;
    currentIllustUrl = illustObject.illustIdUrl || null;
    console.log("Illust tags:", currentTags.map(t => t.tag));

    // Reset like state
    const likeBtn = document.getElementById("likeButton");
    likeBtn.classList.remove("liked");

    // Close tag popup if open
    closeTagPopup();

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
      showToast(illustObject.message, "error");
    }
  }

  // ── Like (bookmark) ──
  function handleLike() {
    if (!currentIllustId) return;
    chrome.runtime.sendMessage(
      { action: "bookmarkIllust", illustId: currentIllustId },
      (res) => {
        if (chrome.runtime.lastError) {
          showToast("Bookmark failed", "error");
          return;
        }
        if (res && res.success) {
          document.getElementById("likeButton").classList.add("liked");
          showToast("Bookmarked!", "success");
        } else {
          showToast(res?.error || "Bookmark failed", "error");
        }
      }
    );
  }

  // ── Dislike (show tag popup) ──
  function handleDislike() {
    if (!currentTags || currentTags.length === 0) {
      showToast("No tags available", "error");
      return;
    }
    openTagPopup(currentTags);
  }

  function openTagPopup(tags) {
    const popup = document.getElementById("tagPopup");
    const tagList = document.getElementById("tagList");
    tagList.innerHTML = "";

    tags.forEach((t) => {
      const chip = document.createElement("div");
      chip.className = "tag-chip";
      let html = `<span class="tag-name">${escapeHtml(t.tag)}</span>`;
      if (t.translation) {
        html += ` <span class="tag-translation">(${escapeHtml(t.translation)})</span>`;
      }
      chip.innerHTML = html;
      chip.addEventListener("click", () => {
        excludeTag(t.tag);
      });
      tagList.appendChild(chip);
    });

    popup.classList.remove("hidden");
  }

  function closeTagPopup() {
    document.getElementById("tagPopup").classList.add("hidden");
  }

  function excludeTag(tag) {
    closeTagPopup();
    chrome.runtime.sendMessage(
      { action: "excludeTag", tag: tag, scope: "global" },
      (res) => {
        if (chrome.runtime.lastError) {
          showToast("Failed to exclude tag", "error");
          return;
        }
        if (res && res.success) {
          showToast(`Excluded: −${tag}`, "success");
          // Auto refresh to next image
          sendRefreshMessage();
        } else {
          showToast(res?.error || "Failed to exclude tag", "error");
        }
      }
    );
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
            showToast("Random images are disabled and no default image is configured.", "error");
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
          showToast("Random images are disabled and no default image is configured.", "error");
        }
      }
    } catch (error) {
      console.error("Failed to update random image setting:", error);
      runtimeConfig.randomImageEnabled = previousEnabled;
      setRandomToggleState(previousEnabled);
      showToast("Failed to update random image setting", "error");
    } finally {
      setRandomToggleBusy(false);
    }
  }

  async function bootstrap() {
    initApplication();
    updateActionButtons();
    runtimeConfig = await loadStartupConfig();
    setRandomToggleState(runtimeConfig.randomImageEnabled !== false);

    const hasDefaultImage = await showConfiguredDefaultImage({
      title: "Default background",
      userName: "Configured default image",
    });

    if (!hasDefaultImage && runtimeConfig.randomImageEnabled === false) {
      binding.containerElement.classList.toggle("notReady", false);
      showToast("Random images are disabled and no default image is configured.", "error");
    }

    if (runtimeConfig.randomImageEnabled !== false) {
      sendRefreshMessage();
    }
    console.log("content script loaded");
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.randomImageEnabled) {
      return;
    }
    handleStoredRandomImageEnabledChange(changes.randomImageEnabled.newValue !== false);
  });

  bootstrap();
})();
