(function () {
  // ── State ──
  let currentTags = [];
  let currentIllustId = null;

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
      const likeElement = document.body.querySelector("#likeButton");
      const dislikeElement = document.body.querySelector("#dislikeButton");
      const containerElement = document.body.querySelector("#container");
      const wallpaperElement = document.body.querySelector("#wallpaper");
      const illustInfoElement = document.body.querySelector("#illustInfo");
      this.containerElement = containerElement;
      this.illustInfoElement = illustInfoElement;

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
      refreshElement.addEventListener("click", sendRefreshMessage);
      settingsElement.addEventListener("click", () => {
        window.open(browser.runtime.getURL("tags.html"), "_blank");
      });

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

  async function changeElement(illustObject) {
    if (!illustObject) { return; }
    if (illustObject.error) {
      showToast(illustObject.message || "Failed to load image", "error");
      return;
    }

    // Store tags and illustId for like/dislike
    currentTags = illustObject.tags || [];
    currentIllustId = illustObject.illustId || null;
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
    binding.containerElement.classList.toggle("notReady", false);
    clearTimeout(binding.illustInfoFadeOutTimeoutId);
    binding.illustInfoFadeOutTimeoutId = setTimeout(() => {
      binding.illustInfoElement.className = "unfocused";
    }, 10000);
  }

  // ── Like (bookmark) ──
  function handleLike() {
    if (!currentIllustId) return;
    const likeBtn = document.getElementById("likeButton");
    if (likeBtn.classList.contains("liked")) return; // already bookmarked

      browser.runtime.sendMessage(
        { action: "bookmarkIllust", illustId: currentIllustId },
        (res) => {
          if (browser.runtime.lastError) {
            showToast("Failed to bookmark", "error");
            return;
          }
          if (res && res.success) {
            likeBtn.classList.add("liked");
            showToast("♥ Bookmarked!", "success");
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
    browser.runtime.sendMessage(
      { action: "excludeTag", tag: tag },
      (res) => {
        if (browser.runtime.lastError) {
          showToast("Failed to exclude tag", "error");
          return;
        }
        if (res && res.success) {
          showToast(`Excluded: −${tag}`, "success");
          // Auto refresh to next image
          setTimeout(() => sendRefreshMessage(), 500);
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
    let safetyTimer = null;
    return () => {
      if (isRequestInProgress) {
        return;
      }
      isRequestInProgress = true;
      // Safety timeout: force-unlock after 30s in case response never comes
      clearTimeout(safetyTimer);
      safetyTimer = setTimeout(() => {
        console.warn("Refresh safety timeout — force unlocking");
        isRequestInProgress = false;
      }, 30000);
      browser.runtime.sendMessage({ action: "fetchImage" }, (res) => {
        clearTimeout(safetyTimer);
        if (browser.runtime.lastError) {
          console.warn("Context invalidated, message could not be processed:", browser.runtime.lastError.message);
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

  initApplication();
  sendRefreshMessage();
  console.log("content script loaded");
})();
