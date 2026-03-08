import { defaultConfig, buildQuery, migrateConfig, legacyToTree, treeToLegacy } from "./config.js";
import {
  clearUploadedDefaultImage,
  resolveDefaultImageUrl,
  saveUploadedDefaultImage,
} from "./default-image-store.js";

const ext = typeof chrome !== "undefined"
  ? chrome
  : (typeof browser !== "undefined" ? browser : null);

// ── State ──
let queryTree = { type: "group", connector: "AND", children: [] };
let presets = []; // Array of { name: string, tree: queryTree }
let activePresetIndex = 0;
let globalMinusKeywords = "";
let randomImageEnabled = true;
let onlyR18Content = false;
let defaultImageUrl = "";
let defaultImagePreviewUrl = "";
let defaultImageSourceType = "url";
let defaultImageUploadName = "";
let randomTagPoolEnabled = false;
let randomTagPool = [];
let randomTagPoolCounts = {};
let randomTagPoolPickCount = 2;
let randomTagPoolLastResolvedTags = [];
let randomTagPoolLastResolvedAt = 0;
let isRandomImageToggleBusy = false;
const MAX_DEFAULT_IMAGE_FILE_SIZE = 20 * 1024 * 1024;

// ── DOM refs ──
const flowContainer = document.getElementById("flowContainer");
const emptyState = document.getElementById("emptyState");
const presetSelect = document.getElementById("presetSelect");
const presetRenameInput = document.getElementById("presetRenameInput");
const globalMinusInput = document.getElementById("globalMinusKeywords");
const blocklistCard = document.getElementById("blocklistCard");
const blocklistToggle = document.getElementById("blocklistToggle");
const displaySettingsCard = document.getElementById("displaySettingsCard");
const displaySettingsToggle = document.getElementById("displaySettingsToggle");
const randomImageEnabledInput = document.getElementById("randomImageEnabled");
const onlyR18ContentInput = document.getElementById("onlyR18Content");
const defaultImageUrlInput = document.getElementById("defaultImageUrl");
const defaultImagePreview = document.getElementById("defaultImagePreview");
const defaultImageUploadBtn = document.getElementById("defaultImageUploadBtn");
const defaultImageClearBtn = document.getElementById("defaultImageClearBtn");
const defaultImageFileInput = document.getElementById("defaultImageFileInput");
const defaultImageSourceHint = document.getElementById("defaultImageSourceHint");
const randomTagPoolCard = document.getElementById("randomTagPoolCard");
const randomTagPoolToggle = document.getElementById("randomTagPoolToggle");
const randomTagPoolEnabledInput = document.getElementById("randomTagPoolEnabled");
const randomTagPoolPickCountInput = document.getElementById("randomTagPoolPickCount");
const randomTagPoolContainer = document.getElementById("randomTagPoolContainer");
const randomTagPoolEmptyState = document.getElementById("randomTagPoolEmptyState");
const randomTagPoolLastResolvedContainer = document.getElementById("randomTagPoolLastResolvedContainer");
const randomTagPoolLastResolvedEmptyState = document.getElementById("randomTagPoolLastResolvedEmptyState");
const randomTagPoolAddBtn = document.getElementById("randomTagPoolAddBtn");
const randomTagPoolImportBtn = document.getElementById("randomTagPoolImportBtn");
const randomTagPoolMenu = document.getElementById("randomTagPoolMenu");
const randomTagPoolMoveToGlobalBtn = document.getElementById("randomTagPoolMoveToGlobalBtn");
const randomTagPoolDeleteBtn = document.getElementById("randomTagPoolDeleteBtn");

let currentImportTarget = "queryTree";
let activeRandomTagPoolIndex = null;
let draggedRandomTagPoolIndex = null;

// ── Tree Manipulation ──

function addTagToGroup(group, value, negated = false) {
  group.children.push({ type: "tag", value, negated });
  renderAll();
}

function addGroupToGroup(parentGroup) {
  parentGroup.children.push({ type: "group", connector: "OR", children: [] });
  renderAll();
}

function removeChild(parentGroup, index) {
  parentGroup.children.splice(index, 1);
  renderAll();
}

function toggleNegated(tag) {
  tag.negated = !tag.negated;
  renderAll();
}

function toggleConnector(group) {
  group.connector = group.connector === "AND" ? "OR" : "AND";
  renderAll();
}

// ── Rendering ──

function createCapsule(tag, parentGroup, index) {
  const el = document.createElement("span");
  el.className = `capsule ${tag.negated ? "capsule-negated" : "capsule-normal"}`;

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "toggle-neg";
  toggleBtn.textContent = tag.negated ? "−" : "+";
  toggleBtn.title = tag.negated ? "Click to include" : "Click to exclude";
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleNegated(tag);
  });

  const textSpan = document.createElement("span");
  textSpan.className = "capsule-text";
  textSpan.textContent = tag.value;

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeChild(parentGroup, index);
  });

  el.appendChild(toggleBtn);
  el.appendChild(textSpan);
  el.appendChild(removeBtn);
  return el;
}

function createConnector(group, childIndex) {
  const conn = document.createElement("span");
  const isOR = group.connector === "OR";
  conn.className = `connector ${isOR ? "connector-or" : "connector-and"}`;
  conn.textContent = isOR ? "OR" : "AND";
  conn.title = "Click to toggle AND/OR";
  conn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleConnector(group);
  });
  return conn;
}

function createPoolCapsule(tag, index) {
  const el = document.createElement("span");
  el.className = "capsule capsule-normal";
  el.draggable = true;
  el.dataset.index = String(index);
  el.title = _translations["randomTagPoolCapsuleTitle"]
    ? _translations["randomTagPoolCapsuleTitle"].message
    : "Click for actions, drag to reorder";

  const textSpan = document.createElement("span");
  textSpan.className = "capsule-text";
  textSpan.textContent = tag;

  const dragHandle = document.createElement("span");
  dragHandle.className = "capsule-text";
  dragHandle.textContent = "↕";
  dragHandle.style.opacity = "0.55";

  el.appendChild(textSpan);
  el.appendChild(dragHandle);

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    openRandomTagPoolMenu(index, el);
  });
  el.addEventListener("dragstart", (e) => {
    draggedRandomTagPoolIndex = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    el.style.opacity = "0.5";
  });
  el.addEventListener("dragend", () => {
    draggedRandomTagPoolIndex = null;
    el.style.opacity = "";
  });
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    if (draggedRandomTagPoolIndex === null || draggedRandomTagPoolIndex === index) {
      return;
    }
    const [movedTag] = randomTagPool.splice(draggedRandomTagPoolIndex, 1);
    randomTagPool.splice(index, 0, movedTag);
    draggedRandomTagPoolIndex = null;
    closeRandomTagPoolMenu();
    renderRandomTagPool();
  });
  return el;
}

function createReadonlyPoolCapsule(tag) {
  const el = document.createElement("span");
  el.className = "capsule capsule-normal capsule-readonly";

  const textSpan = document.createElement("span");
  textSpan.className = "capsule-text";
  textSpan.textContent = tag;

  el.appendChild(textSpan);
  return el;
}

function normalizeRandomTagPoolCounts(counts, pool = randomTagPool) {
  const normalized = {};
  const poolSet = new Set(
    Array.isArray(pool)
      ? pool.map((item) => String(item || "").trim()).filter(Boolean)
      : []
  );
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    return normalized;
  }
  for (const [tag, count] of Object.entries(counts)) {
    const normalizedTag = String(tag || "").trim();
    const normalizedCount = parseInt(count, 10);
    if (poolSet.has(normalizedTag) && Number.isInteger(normalizedCount) && normalizedCount > 0) {
      normalized[normalizedTag] = normalizedCount;
    }
  }
  return normalized;
}

function createInlineInput(group, container) {
  const wrapper = document.createElement("span");
  wrapper.className = "inline-input";

  const input = document.createElement("input");
  input.placeholder = _translations["addTagPlaceholder"]
    ? _translations["addTagPlaceholder"].message
    : "Add a tag...";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = input.value.trim();
      if (val) {
        val.split(/\s+/).filter(Boolean).forEach(v => addTagToGroup(group, v));
      }
    } else if (e.key === "Escape") {
      wrapper.remove();
    }
  });

  input.addEventListener("blur", () => {
    const val = input.value.trim();
    if (val) {
      val.split(/\s+/).filter(Boolean).forEach(v => addTagToGroup(group, v));
    } else {
      wrapper.remove();
    }
  });

  wrapper.appendChild(input);
  return wrapper;
}

function createPoolInlineInput(container) {
  const wrapper = document.createElement("span");
  wrapper.className = "inline-input";

  const input = document.createElement("input");
  input.placeholder = _translations["randomTagPoolInputPlaceholder"]
    ? _translations["randomTagPoolInputPlaceholder"].message
    : "tag-a";

  const commit = () => {
    const values = parseRandomTagPoolInput(input.value);
    if (values.length > 0) {
      values.forEach((value) => {
        if (!randomTagPool.includes(value)) {
          randomTagPool.push(value);
        }
      });
      randomTagPoolCounts = normalizeRandomTagPoolCounts(randomTagPoolCounts, randomTagPool);
      renderRandomTagPool();
    } else {
      wrapper.remove();
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commit();
    } else if (e.key === "Escape") {
      wrapper.remove();
    }
  });

  input.addEventListener("blur", commit);
  wrapper.appendChild(input);
  return wrapper;
}

function renderGroupCard(group, parentGroup, indexInParent) {
  const card = document.createElement("div");
  card.className = "group-card";

  const header = document.createElement("div");
  header.className = "group-header";

  const icon = document.createElement("span");
  icon.className = "group-icon";
  icon.textContent = "🔗";

  const label = document.createElement("span");
  label.className = "group-label";
  label.textContent = _translations["groupLabel"]
    ? _translations["groupLabel"].message
    : "Group (Parentheses)";

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn-remove-group";
  removeBtn.textContent = "🗑";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeChild(parentGroup, indexInParent);
  });

  header.appendChild(icon);
  header.appendChild(label);
  header.appendChild(removeBtn);
  card.appendChild(header);

  const flow = document.createElement("div");
  flow.className = "group-flow";

  renderFlowItems(group, flow);

  const addBtn = document.createElement("button");
  addBtn.className = "group-add-btn";
  addBtn.innerHTML = `+ <span>${_translations["addKeywordLabel"] ? _translations["addKeywordLabel"].message : "Keyword"}</span>`;
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const inputEl = createInlineInput(group, flow);
    flow.insertBefore(inputEl, addBtn);
    inputEl.querySelector("input").focus();
  });
  flow.appendChild(addBtn);

  card.appendChild(flow);
  return card;
}

function renderFlowItems(group, container) {
  group.children.forEach((child, i) => {
    if (i > 0) {
      container.appendChild(createConnector(group, i));
    }
    if (child.type === "tag") {
      container.appendChild(createCapsule(child, group, i));
    } else if (child.type === "group") {
      container.appendChild(renderGroupCard(child, group, i));
    }
  });
}

function renderAll() {
  flowContainer.innerHTML = "";

  if (queryTree.children.length === 0) {
    emptyState.style.display = "";
    flowContainer.appendChild(emptyState);
  } else {
    emptyState.style.display = "none";
    renderFlowItems(queryTree, flowContainer);
  }

  renderRandomTagPool();
  renderLastResolvedRandomTags();
  updatePreview();
}

function renderRandomTagPool() {
  if (!randomTagPoolContainer || !randomTagPoolEmptyState) {
    return;
  }
  closeRandomTagPoolMenu();
  randomTagPoolContainer.innerHTML = "";
  if (randomTagPool.length === 0) {
    randomTagPoolEmptyState.textContent = _translations["randomTagPoolEmptyState"]
      ? _translations["randomTagPoolEmptyState"].message
      : "Add tags to build the random pool";
    randomTagPoolEmptyState.style.display = "";
    randomTagPoolContainer.appendChild(randomTagPoolEmptyState);
    return;
  }
  randomTagPoolEmptyState.style.display = "none";
  randomTagPool.forEach((tag, index) => {
    randomTagPoolContainer.appendChild(createPoolCapsule(tag, index));
  });
}

function renderLastResolvedRandomTags() {
  if (!randomTagPoolLastResolvedContainer || !randomTagPoolLastResolvedEmptyState) {
    return;
  }

  randomTagPoolLastResolvedContainer.innerHTML = "";
  if (randomTagPoolLastResolvedAt <= 0) {
    randomTagPoolLastResolvedEmptyState.textContent = _translations["randomTagPoolLastResolvedEmptyState"]
      ? _translations["randomTagPoolLastResolvedEmptyState"].message
      : "No successful random tag hit yet";
    randomTagPoolLastResolvedEmptyState.style.display = "";
    randomTagPoolLastResolvedContainer.appendChild(randomTagPoolLastResolvedEmptyState);
    return;
  }

  if (randomTagPoolLastResolvedTags.length === 0) {
    randomTagPoolLastResolvedEmptyState.textContent = _translations["randomTagPoolLastResolvedBaseOnly"]
      ? _translations["randomTagPoolLastResolvedBaseOnly"].message
      : "This round fell back to the base query only";
    randomTagPoolLastResolvedEmptyState.style.display = "";
    randomTagPoolLastResolvedContainer.appendChild(randomTagPoolLastResolvedEmptyState);
    return;
  }

  randomTagPoolLastResolvedEmptyState.style.display = "none";
  randomTagPoolLastResolvedTags.forEach((tag) => {
    randomTagPoolLastResolvedContainer.appendChild(createReadonlyPoolCapsule(tag));
  });
}

function closeRandomTagPoolMenu() {
  activeRandomTagPoolIndex = null;
  if (randomTagPoolMenu) {
    randomTagPoolMenu.classList.add("hidden");
  }
}

function openRandomTagPoolMenu(index, targetElement) {
  if (!randomTagPoolMenu || !targetElement) {
    return;
  }
  activeRandomTagPoolIndex = index;
  const rect = targetElement.getBoundingClientRect();
  const menuWidth = 152;
  const left = Math.min(window.innerWidth - menuWidth - 12, Math.max(12, rect.left));
  const top = Math.min(window.innerHeight - 96, rect.bottom + 8);
  randomTagPoolMenu.style.left = `${left}px`;
  randomTagPoolMenu.style.top = `${top}px`;
  randomTagPoolMenu.classList.remove("hidden");
}

function moveRandomTagPoolItemToGlobal() {
  if (activeRandomTagPoolIndex === null) {
    return;
  }
  const tag = randomTagPool[activeRandomTagPoolIndex];
  if (!tag) {
    closeRandomTagPoolMenu();
    return;
  }
  const exists = queryTree.children.some((child) =>
    child.type === "tag" &&
    child.negated !== true &&
    child.value === tag
  );
  if (!exists) {
    queryTree.children.push({ type: "tag", value: tag, negated: false });
  }
  randomTagPool.splice(activeRandomTagPoolIndex, 1);
  delete randomTagPoolCounts[tag];
  randomTagPoolCounts = normalizeRandomTagPoolCounts(randomTagPoolCounts, randomTagPool);
  closeRandomTagPoolMenu();
  renderAll();
}

function deleteRandomTagPoolItem() {
  if (activeRandomTagPoolIndex === null) {
    return;
  }
  const [removedTag] = randomTagPool.splice(activeRandomTagPoolIndex, 1);
  delete randomTagPoolCounts[removedTag];
  randomTagPoolCounts = normalizeRandomTagPoolCounts(randomTagPoolCounts, randomTagPool);
  closeRandomTagPoolMenu();
  renderRandomTagPool();
}

// ── Preset Management ──

function renderPresetSelect() {
  presetSelect.innerHTML = "";
  presets.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = p.name;
    if (i === activePresetIndex) opt.selected = true;
    presetSelect.appendChild(opt);
  });
}

function switchPreset(index) {
  // Save current tree to current preset before switching
  if (presets[activePresetIndex]) {
    presets[activePresetIndex].tree = JSON.parse(JSON.stringify(queryTree));
  }
  activePresetIndex = index;
  if (presets[index]) {
    queryTree = JSON.parse(JSON.stringify(presets[index].tree));
  }
  renderPresetSelect();
  renderAll();
}

function addPreset(name) {
  // Save current first
  if (presets[activePresetIndex]) {
    presets[activePresetIndex].tree = JSON.parse(JSON.stringify(queryTree));
  }
  const newPreset = {
    name: name || `Preset ${presets.length + 1}`,
    tree: { type: "group", connector: "AND", children: [] }
  };
  presets.push(newPreset);
  activePresetIndex = presets.length - 1;
  queryTree = JSON.parse(JSON.stringify(newPreset.tree));
  renderPresetSelect();
  renderAll();
}

function renamePreset(index) {
  const current = presets[index];
  if (!current) return;
  if (!presetRenameInput || !presetSelect) return;
  presetRenameInput.value = current.name || "";
  presetRenameInput.classList.add("active");
  presetSelect.style.display = "none";
  presetRenameInput.focus();
  presetRenameInput.select();
}

function deletePreset(index) {
  if (presets.length <= 1) {
    showToast(
      _translations["presetDeleteLast"]
        ? _translations["presetDeleteLast"].message
        : "Cannot delete the last preset",
      "error"
    );
    return;
  }
  presets.splice(index, 1);
  if (activePresetIndex >= presets.length) {
    activePresetIndex = presets.length - 1;
  }
  queryTree = JSON.parse(JSON.stringify(presets[activePresetIndex].tree));
  renderPresetSelect();
  renderAll();
}

function savePresetsToStorage() {
  // Sync current tree to active preset
  if (presets[activePresetIndex]) {
    presets[activePresetIndex].tree = JSON.parse(JSON.stringify(queryTree));
  }
  if (!ext || !ext.storage || !ext.storage.local) return;
  ext.storage.local.set({
    queryPresets: JSON.parse(JSON.stringify(presets)),
    activePresetIndex: activePresetIndex,
    globalMinusKeywords: globalMinusKeywords,
    randomImageEnabled: randomImageEnabled,
    mode: onlyR18Content ? "r18" : "safe",
    randomTagPoolEnabled: randomTagPoolEnabled,
    randomTagPool: JSON.parse(JSON.stringify(randomTagPool)),
    randomTagPoolPickCount: randomTagPoolPickCount,
    defaultImageUrl: defaultImageSourceType === "url" ? defaultImageUrl : "",
    defaultImageSourceType: defaultImageSourceType,
    defaultImageUploadName: defaultImageUploadName,
    presetMinusKeywords: [],
  });
}

// ── Preview ──

function updatePreview() {
  // Preview removed
}

function updateDefaultImagePreview(url) {
  if (!defaultImagePreview) return;
  const safeUrl = (url || "").trim();
  if (safeUrl) {
    defaultImagePreview.style.backgroundImage = `url(${safeUrl})`;
    defaultImagePreview.textContent = "";
    defaultImagePreview.classList.add("has-image");
  } else {
    defaultImagePreview.style.backgroundImage = "";
    defaultImagePreview.textContent = _translations["defaultImagePreviewEmpty"]
      ? _translations["defaultImagePreviewEmpty"].message
      : "No default image configured";
    defaultImagePreview.classList.remove("has-image");
  }
}

function updateDefaultImageSourceHint() {
  if (!defaultImageSourceHint) return;
  if (defaultImageSourceType === "upload" && defaultImageUploadName) {
    const template = _translations["defaultImageSourceUpload"]
      ? _translations["defaultImageSourceUpload"].message
      : "Current source: local upload ({name})";
    defaultImageSourceHint.textContent = template.replace("{name}", defaultImageUploadName || "image");
    return;
  }
  if (!defaultImageUrl) {
    defaultImageSourceHint.textContent = _translations["defaultImageSourceNone"]
      ? _translations["defaultImageSourceNone"].message
      : "Current source: none";
    return;
  }
  defaultImageSourceHint.textContent = _translations["defaultImageSourceUrl"]
    ? _translations["defaultImageSourceUrl"].message
    : "Current source: URL";
}

function syncDefaultImageControls() {
  if (defaultImageUrlInput) {
    defaultImageUrlInput.value = defaultImageSourceType === "url" ? defaultImageUrl : "";
  }
  updateDefaultImagePreview(defaultImagePreviewUrl);
  updateDefaultImageSourceHint();
}

function syncRandomImageToggleControl() {
  if (!randomImageEnabledInput) return;
  randomImageEnabledInput.checked = randomImageEnabled;
  randomImageEnabledInput.disabled = isRandomImageToggleBusy;
  if (onlyR18ContentInput) {
    onlyR18ContentInput.checked = onlyR18Content;
  }
}

function parseRandomTagPoolInput(value) {
  return String(value || "")
    .split(/[\n,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRandomTagPoolPickCount(value) {
  return 2;
}

function syncRandomTagPoolControls() {
  if (randomTagPoolEnabledInput) {
    randomTagPoolEnabledInput.checked = randomTagPoolEnabled;
  }
  if (randomTagPoolPickCountInput) {
    randomTagPoolPickCount = normalizeRandomTagPoolPickCount(randomTagPoolPickCount);
    randomTagPoolPickCountInput.value = String(randomTagPoolPickCount);
  }
  renderRandomTagPool();
}

async function resetDefaultImage() {
  defaultImageUrl = "";
  defaultImagePreviewUrl = "";
  defaultImageSourceType = "url";
  defaultImageUploadName = "";
  await clearUploadedDefaultImage();
  if (defaultImageFileInput) {
    defaultImageFileInput.value = "";
  }
  syncDefaultImageControls();
  await persistDisplaySettings();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function persistRandomImageEnabledSetting(enabled) {
  return new Promise((resolve, reject) => {
    if (!ext || !ext.storage || !ext.storage.local) {
      reject(new Error("Chrome storage unavailable."));
      return;
    }
    ext.storage.local.set({ randomImageEnabled: enabled }, () => {
      if (ext.runtime && ext.runtime.lastError) {
        reject(new Error(ext.runtime.lastError.message));
        return;
      }
      if (ext && ext.runtime && ext.runtime.sendMessage) {
        ext.runtime.sendMessage({ action: "updateConfig" }, () => {
          if (ext.runtime.lastError) {
            reject(new Error(ext.runtime.lastError.message));
            return;
          }
          resolve();
        });
        return;
      }
      resolve();
    });
  });
}

function notifyRuntimeConfigUpdated() {
  return new Promise((resolve, reject) => {
    if (ext && ext.runtime && ext.runtime.sendMessage) {
      ext.runtime.sendMessage({ action: "updateConfig" }, () => {
        if (ext.runtime.lastError) {
          reject(new Error(ext.runtime.lastError.message));
          return;
        }
        resolve();
      });
      return;
    }
    resolve();
  });
}

function persistDisplaySettings() {
  return new Promise((resolve, reject) => {
    if (!ext || !ext.storage || !ext.storage.local) {
      reject(new Error("Chrome storage unavailable."));
      return;
    }
    ext.storage.local.set({
      randomImageEnabled,
      mode: onlyR18Content ? "r18" : "safe",
      defaultImageUrl: defaultImageSourceType === "url" ? defaultImageUrl : "",
      defaultImageSourceType,
      defaultImageUploadName,
    }, async () => {
      if (ext.runtime && ext.runtime.lastError) {
        reject(new Error(ext.runtime.lastError.message));
        return;
      }
      try {
        await notifyRuntimeConfigUpdated();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

// ── Storage ──

function loadTags() {
  if (!ext || !ext.storage || !ext.storage.local) {
    console.error("Chrome storage unavailable.", {
      href: location.href,
      chromeDefined: typeof chrome !== "undefined",
      storageDefined: typeof chrome !== "undefined" && !!chrome.storage,
      runtimeId: ext && ext.runtime ? ext.runtime.id : null,
    });
    showToast("Chrome storage unavailable. Open from extension.", "error");
    return;
  }
  ext.storage.local.get({
    ...defaultConfig,
    queryPresets: null,
    activePresetIndex: 0,
    globalMinusKeywords: "",
    randomImageEnabled: true,
    randomTagPoolEnabled: false,
    randomTagPool: [],
    randomTagPoolCounts: {},
    randomTagPoolPickCount: 2,
    randomTagPoolLastResolvedTags: [],
    randomTagPoolLastResolvedAt: 0,
    mode: "safe",
    defaultImageUrl: "",
    defaultImageSourceType: "url",
    defaultImageUploadName: "",
    presetMinusKeywords: [],
  }, async (items) => {
    migrateConfig(items);

    if (items.queryPresets && Array.isArray(items.queryPresets) && items.queryPresets.length > 0) {
      // Load presets
      presets = items.queryPresets;
      activePresetIndex = Math.min(items.activePresetIndex || 0, presets.length - 1);
      queryTree = JSON.parse(JSON.stringify(presets[activePresetIndex].tree));
    } else {
      // First time — migrate existing config to first preset
      queryTree = items.queryTree || { type: "group", connector: "AND", children: [] };
      presets = [{ name: "Default", tree: JSON.parse(JSON.stringify(queryTree)) }];
      activePresetIndex = 0;
    }

    globalMinusKeywords = items.globalMinusKeywords || "";
    if (globalMinusInput) globalMinusInput.value = globalMinusKeywords;
    randomImageEnabled = items.randomImageEnabled !== false;
    onlyR18Content = items.mode === "r18";
    randomTagPoolEnabled = items.randomTagPoolEnabled === true;
    randomTagPool = Array.isArray(items.randomTagPool)
      ? items.randomTagPool.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    randomTagPoolCounts = normalizeRandomTagPoolCounts(items.randomTagPoolCounts, randomTagPool);
    randomTagPoolPickCount = normalizeRandomTagPoolPickCount(items.randomTagPoolPickCount);
    randomTagPoolLastResolvedTags = Array.isArray(items.randomTagPoolLastResolvedTags)
      ? items.randomTagPoolLastResolvedTags.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    randomTagPoolLastResolvedAt = Number.isFinite(items.randomTagPoolLastResolvedAt)
      ? Number(items.randomTagPoolLastResolvedAt)
      : 0;
    defaultImageUrl = items.defaultImageSourceType === "url"
      ? (items.defaultImageUrl || "").trim()
      : "";
    defaultImageSourceType = items.defaultImageSourceType || "url";
    defaultImageUploadName = items.defaultImageUploadName || "";
    defaultImagePreviewUrl = await resolveDefaultImageUrl(items, {
      onLegacyMigrated: (patch) => new Promise((patchResolve) => {
        ext.storage.local.set(patch, patchResolve);
      }),
    });
    syncRandomImageToggleControl();
    syncRandomTagPoolControls();
    syncDefaultImageControls();
    renderLastResolvedRandomTags();

    renderPresetSelect();
    renderAll();
  });
}

async function saveTags() {
  // Sync to preset
  if (presets[activePresetIndex]) {
    presets[activePresetIndex].tree = JSON.parse(JSON.stringify(queryTree));
  }
  if (globalMinusInput) {
    globalMinusKeywords = globalMinusInput.value.trim();
  }
  if (randomImageEnabledInput) {
    randomImageEnabled = !!randomImageEnabledInput.checked;
  }
  if (randomTagPoolEnabledInput) {
    randomTagPoolEnabled = !!randomTagPoolEnabledInput.checked;
  }
  if (randomTagPoolPickCountInput) {
    const parsedPickCount = parseInt(randomTagPoolPickCountInput.value, 10);
    randomTagPoolPickCount = normalizeRandomTagPoolPickCount(parsedPickCount);
  }
  if (defaultImageUrlInput) {
    if (defaultImageSourceType === "url") {
      defaultImageUrl = defaultImageUrlInput.value.trim();
      defaultImageUploadName = "";
      defaultImagePreviewUrl = defaultImageUrl;
    }
  }
  if (defaultImageSourceType === "url") {
    await clearUploadedDefaultImage();
  }

  // Derive legacy fields from active preset
  const legacy = treeToLegacy(queryTree);

  const newValues = {
    queryTree: JSON.parse(JSON.stringify(queryTree)),
    queryPresets: JSON.parse(JSON.stringify(presets)),
    activePresetIndex: activePresetIndex,
    andKeywords: legacy.andKeywords,
    orGroups: legacy.orGroups,
    minusKeywords: legacy.minusKeywords,
    orKeywords: null,
    globalMinusKeywords: globalMinusKeywords,
    randomImageEnabled: randomImageEnabled,
    mode: onlyR18Content ? "r18" : "safe",
    randomTagPoolEnabled: randomTagPoolEnabled,
    randomTagPool: JSON.parse(JSON.stringify(randomTagPool)),
    randomTagPoolCounts: JSON.parse(JSON.stringify(normalizeRandomTagPoolCounts(randomTagPoolCounts, randomTagPool))),
    randomTagPoolPickCount: randomTagPoolPickCount,
    defaultImageUrl: defaultImageUrl,
    defaultImageSourceType: defaultImageSourceType,
    defaultImageUploadName: defaultImageUploadName,
    presetMinusKeywords: [],
  };

  if (!ext || !ext.storage || !ext.storage.local) {
    showToast("Chrome storage unavailable. Open from extension.", "error");
    return;
  }
  ext.storage.local.set(newValues, () => {
    showToast(
      _translations["tagsSaved"]
        ? _translations["tagsSaved"].message
        : "Tags saved!",
      "success"
    );
  });

  try {
    await notifyRuntimeConfigUpdated();
  } catch (error) {
    console.warn("Extension runtime unavailable, updateConfig not sent.", error);
  }

  updatePreview();
}

// ── Import / Export ──

function importFromText(text) {
  const tags = text
    .split(/[\s,，、\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tags.length === 0) return;

  tags.forEach((tag) => {
    if (tag.startsWith("-")) {
      queryTree.children.push({ type: "tag", value: tag.slice(1), negated: true });
    } else {
      queryTree.children.push({ type: "tag", value: tag, negated: false });
    }
  });

  renderAll();
  showToast(
    (_translations["importedCount"]
      ? _translations["importedCount"].message
      : "Imported {count} tags"
    ).replace("{count}", tags.length),
    "success"
  );
}

function importRandomTagPoolFromText(text) {
  const tags = parseRandomTagPoolInput(text);
  if (tags.length === 0) return;
  tags.forEach((tag) => {
    if (!randomTagPool.includes(tag)) {
      randomTagPool.push(tag);
    }
  });
  randomTagPoolCounts = normalizeRandomTagPoolCounts(randomTagPoolCounts, randomTagPool);
  renderRandomTagPool();
  showToast(
    (_translations["importedCount"]
      ? _translations["importedCount"].message
      : "Imported {count} tags"
    ).replace("{count}", tags.length),
    "success"
  );
}

function importFromJsonFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);

      // Presets
      if (Array.isArray(data.queryPresets) && data.queryPresets.length > 0) {
        presets = data.queryPresets;
        activePresetIndex = Math.min(data.activePresetIndex || 0, presets.length - 1);
        queryTree = JSON.parse(JSON.stringify(presets[activePresetIndex].tree || { type: "group", connector: "AND", children: [] }));
      } else if (data.queryTree && data.queryTree.type === "group") {
        queryTree = data.queryTree;
        presets = [{ name: "Default", tree: JSON.parse(JSON.stringify(queryTree)) }];
        activePresetIndex = 0;
      } else {
        const tree = legacyToTree(
          data.andKeywords || "",
          data.orGroups || [],
          data.minusKeywords || ""
        );
        queryTree = tree;
        presets = [{ name: "Default", tree: JSON.parse(JSON.stringify(queryTree)) }];
        activePresetIndex = 0;
      }

      globalMinusKeywords = data.globalMinusKeywords || "";
      randomImageEnabled = data.randomImageEnabled !== false;
      onlyR18Content = data.mode === "r18";
      randomTagPoolEnabled = data.randomTagPoolEnabled === true;
      randomTagPool = Array.isArray(data.randomTagPool)
        ? data.randomTagPool.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      randomTagPoolCounts = normalizeRandomTagPoolCounts(data.randomTagPoolCounts, randomTagPool);
      randomTagPoolPickCount = normalizeRandomTagPoolPickCount(data.randomTagPoolPickCount);
      defaultImageSourceType = data.defaultImageSourceType || "url";
      defaultImageUploadName = data.defaultImageUploadName || "";
      defaultImageUrl = defaultImageSourceType === "url"
        ? (data.defaultImageUrl || "").trim()
        : "";
      defaultImagePreviewUrl = "";
      if (defaultImageSourceType === "upload") {
        if (typeof data.defaultImageUrl === "string" && data.defaultImageUrl.trim().startsWith("data:image/")) {
          defaultImagePreviewUrl = data.defaultImageUrl.trim();
          await saveUploadedDefaultImage(defaultImagePreviewUrl, defaultImageUploadName);
        } else {
          await clearUploadedDefaultImage();
        }
      } else {
        await clearUploadedDefaultImage();
        defaultImagePreviewUrl = defaultImageUrl;
      }
      if (Array.isArray(data.presetMinusKeywords) && data.presetMinusKeywords.length > 0) {
        const extra = data.presetMinusKeywords.map(s => (s || "").trim()).filter(Boolean).join(" ");
        if (extra) {
          globalMinusKeywords = [globalMinusKeywords, extra].filter(Boolean).join(" ").replace(/\s+/g, " ");
        }
      }
      if (globalMinusInput) globalMinusInput.value = globalMinusKeywords;
      if (randomImageEnabledInput) randomImageEnabledInput.checked = randomImageEnabled;
      syncRandomTagPoolControls();
      syncDefaultImageControls();

      renderAll();
      showToast(
        _translations["importedCount"]
          ? _translations["importedCount"].message.replace("{count}", queryTree.children.length)
          : `Imported successfully!`,
        "success"
      );
    } catch (err) {
      showToast(
        _translations["importError"]
          ? _translations["importError"].message
          : "Invalid JSON file",
        "error"
      );
      console.error("Import error:", err);
    }
  };
  reader.readAsText(file);
}

function exportToJsonFile() {
  const data = {
    queryTree: JSON.parse(JSON.stringify(queryTree)),
    queryPresets: JSON.parse(JSON.stringify(presets)),
    activePresetIndex: activePresetIndex,
    globalMinusKeywords: globalMinusKeywords,
    randomImageEnabled: randomImageEnabled,
    mode: onlyR18Content ? "r18" : "safe",
    randomTagPoolEnabled: randomTagPoolEnabled,
    randomTagPool: JSON.parse(JSON.stringify(randomTagPool)),
    randomTagPoolCounts: JSON.parse(JSON.stringify(normalizeRandomTagPoolCounts(randomTagPoolCounts, randomTagPool))),
    randomTagPoolPickCount: randomTagPoolPickCount,
    defaultImageUrl: defaultImageSourceType === "url" ? defaultImageUrl : "",
    defaultImageSourceType: defaultImageSourceType,
    defaultImageUploadName: defaultImageUploadName,
    presetMinusKeywords: [],
    ...treeToLegacy(queryTree),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const dateStr = new Date().toISOString().split("T")[0];
  a.download = `pixiv-tags-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(
    _translations["exportSuccess"]
      ? _translations["exportSuccess"].message
      : "Exported successfully!",
    "success"
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

// ── Modal ──

function openImportModal(target = "queryTree") {
  currentImportTarget = target;
  const modalTitle = document.getElementById("modalTitle");
  const modalDesc = document.getElementById("modalDesc");
  if (modalTitle) {
    modalTitle.textContent = target === "randomTagPool"
      ? (_translations["randomTagPoolModalTitle"] ? _translations["randomTagPoolModalTitle"].message : "Import Random Pool Tags")
      : (_translations["modalTitle"] ? _translations["modalTitle"].message : "Import Tags from Text");
  }
  if (modalDesc) {
    modalDesc.textContent = target === "randomTagPool"
      ? (_translations["randomTagPoolModalDesc"] ? _translations["randomTagPoolModalDesc"].message : "Paste tags for the random pool (separated by spaces, commas, or newlines)")
      : (_translations["modalDesc"] ? _translations["modalDesc"].message : "Paste keywords below (separated by spaces, commas, or newlines)");
  }
  document.getElementById("importModal").classList.add("active");
  document.getElementById("importTextarea").value = "";
  document.getElementById("importTextarea").focus();
}

function closeImportModal() {
  document.getElementById("importModal").classList.remove("active");
}

function confirmImport() {
  const text = document.getElementById("importTextarea").value;
  if (text.trim()) {
    if (currentImportTarget === "randomTagPool") {
      importRandomTagPoolFromText(text);
    } else {
      importFromText(text);
    }
  }
  closeImportModal();
}

// ── i18n ──

let _translations = {};

function loadTranslations(lang) {
  fetch(`_locales/${lang}/messages.json`)
    .then((r) => r.json())
    .then((data) => {
      _translations = data;
      document.querySelectorAll("[id]").forEach((el) => {
        if (data[el.id] && !el.closest(".flow-builder") && !el.closest(".preset-bar")) {
          if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
          el.textContent = data[el.id].message;
        }
      });
      document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const key = el.getAttribute("data-i18n-placeholder");
        if (data[key]) {
          el.placeholder = data[key].message;
        }
      });
      syncRandomTagPoolControls();
      syncDefaultImageControls();
      renderAll();
    })
    .catch((error) => console.error("Error loading translations:", error));
}

// ── Event Listeners ──

// Add keyword
document.getElementById("addKeywordBtn").addEventListener("click", () => {
  const inputEl = createInlineInput(queryTree, flowContainer);
  flowContainer.appendChild(inputEl);
  inputEl.querySelector("input").focus();
});

// Add group
document.getElementById("addGroupBtn").addEventListener("click", () => {
  addGroupToGroup(queryTree);
});

if (randomTagPoolAddBtn && randomTagPoolContainer) {
  randomTagPoolAddBtn.addEventListener("click", () => {
    const inputEl = createPoolInlineInput(randomTagPoolContainer);
    randomTagPoolContainer.appendChild(inputEl);
    inputEl.querySelector("input").focus();
  });
}

if (randomTagPoolImportBtn) {
  randomTagPoolImportBtn.addEventListener("click", () => {
    openImportModal("randomTagPool");
  });
}

if (randomTagPoolMoveToGlobalBtn) {
  randomTagPoolMoveToGlobalBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    moveRandomTagPoolItemToGlobal();
  });
}

if (randomTagPoolDeleteBtn) {
  randomTagPoolDeleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteRandomTagPoolItem();
  });
}

// Preset controls
presetSelect.addEventListener("change", (e) => {
  switchPreset(parseInt(e.target.value, 10));
});

document.getElementById("presetNewBtn").addEventListener("click", () => {
  addPreset();
  showToast(
    _translations["presetCreated"]
      ? _translations["presetCreated"].message
      : "Preset created",
    "success"
  );
});

document.getElementById("presetRenameBtn").addEventListener("click", () => {
  renamePreset(activePresetIndex);
});

document.getElementById("presetDeleteBtn").addEventListener("click", () => {
  deletePreset(activePresetIndex);
});

if (presetRenameInput && presetSelect) {
  const commitRename = () => {
    const val = presetRenameInput.value.trim();
    if (val && presets[activePresetIndex]) {
      presets[activePresetIndex].name = val;
    }
    presetRenameInput.classList.remove("active");
    presetSelect.style.display = "";
    renderPresetSelect();
  };

  presetRenameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") {
      presetRenameInput.classList.remove("active");
      presetSelect.style.display = "";
    }
  });

  presetRenameInput.addEventListener("blur", commitRename);
}

// Save
document.getElementById("saveBtn").addEventListener("click", saveTags);

// Import / Export
document.getElementById("importTextBtn").addEventListener("click", () => openImportModal("queryTree"));
document.getElementById("modalCancelBtn").addEventListener("click", closeImportModal);
document.getElementById("modalConfirmBtn").addEventListener("click", confirmImport);

document.getElementById("importFileBtn").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});
document.getElementById("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    importFromJsonFile(file);
    e.target.value = "";
  }
});

document.getElementById("exportBtn").addEventListener("click", exportToJsonFile);

document.getElementById("importModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeImportModal();
});

document.addEventListener("click", (e) => {
  if (randomTagPoolMenu && !randomTagPoolMenu.classList.contains("hidden")) {
    if (!randomTagPoolMenu.contains(e.target) && !(e.target.closest && e.target.closest("#randomTagPoolContainer"))) {
      closeRandomTagPoolMenu();
    }
  }
});

if (blocklistToggle && blocklistCard) {
  blocklistToggle.addEventListener("click", () => {
    const isCollapsed = blocklistCard.classList.toggle("collapsed");
    blocklistToggle.textContent = isCollapsed ? "Show" : "Hide";
  });
}

if (displaySettingsToggle && displaySettingsCard) {
  displaySettingsToggle.addEventListener("click", () => {
    const isCollapsed = displaySettingsCard.classList.toggle("collapsed");
    displaySettingsToggle.textContent = isCollapsed ? "Show" : "Hide";
  });
}

if (randomTagPoolToggle && randomTagPoolCard) {
  randomTagPoolToggle.addEventListener("click", () => {
    const isCollapsed = randomTagPoolCard.classList.toggle("collapsed");
    randomTagPoolToggle.textContent = isCollapsed ? "Show" : "Hide";
  });
}

if (globalMinusInput) {
  globalMinusInput.addEventListener("input", () => {
    globalMinusKeywords = globalMinusInput.value.trim();
    updatePreview();
  });
}

if (randomImageEnabledInput) {
  randomImageEnabledInput.addEventListener("change", async () => {
    if (isRandomImageToggleBusy) {
      syncRandomImageToggleControl();
      return;
    }
    const previousEnabled = randomImageEnabled;
    const nextEnabled = !!randomImageEnabledInput.checked;
    if (nextEnabled === previousEnabled) {
      return;
    }
    isRandomImageToggleBusy = true;
    randomImageEnabled = nextEnabled;
    syncRandomImageToggleControl();
    try {
      await persistRandomImageEnabledSetting(nextEnabled);
    } catch (error) {
      console.error("Failed to update random image setting:", error);
      randomImageEnabled = previousEnabled;
      syncRandomImageToggleControl();
      showToast("Failed to update random image setting", "error");
    } finally {
      isRandomImageToggleBusy = false;
      syncRandomImageToggleControl();
    }
  });
}

if (onlyR18ContentInput) {
  onlyR18ContentInput.addEventListener("change", async () => {
    const previousValue = onlyR18Content;
    onlyR18Content = !!onlyR18ContentInput.checked;
    syncRandomImageToggleControl();
    try {
      await persistDisplaySettings();
    } catch (error) {
      console.error("Failed to update R18 content setting:", error);
      onlyR18Content = previousValue;
      syncRandomImageToggleControl();
      showToast("Failed to update R18 content setting", "error");
    }
  });
}

if (defaultImageUrlInput) {
  defaultImageUrlInput.addEventListener("input", () => {
    defaultImageSourceType = "url";
    defaultImageUploadName = "";
    defaultImageUrl = defaultImageUrlInput.value.trim();
    defaultImagePreviewUrl = defaultImageUrl;
    syncDefaultImageControls();
  });
  defaultImageUrlInput.addEventListener("change", async () => {
    try {
      await persistDisplaySettings();
    } catch (error) {
      console.error("Failed to persist default image URL:", error);
      showToast("Failed to save default image settings", "error");
    }
  });
}

if (defaultImageUploadBtn && defaultImageFileInput) {
  defaultImageUploadBtn.addEventListener("click", () => {
    defaultImageFileInput.click();
  });
}

if (defaultImageClearBtn) {
  defaultImageClearBtn.addEventListener("click", async () => {
    try {
      await resetDefaultImage();
      showToast(
        _translations["defaultImagePreviewEmpty"]
          ? _translations["defaultImagePreviewEmpty"].message
          : "No default image configured",
        "success"
      );
    } catch (error) {
      console.error("Failed to clear default image:", error);
      showToast("Failed to save default image settings", "error");
    }
  });
}

if (randomTagPoolEnabledInput) {
  randomTagPoolEnabledInput.addEventListener("change", () => {
    randomTagPoolEnabled = !!randomTagPoolEnabledInput.checked;
  });
}

if (randomTagPoolPickCountInput) {
  randomTagPoolPickCountInput.addEventListener("input", () => {
    const parsedPickCount = parseInt(randomTagPoolPickCountInput.value, 10);
    randomTagPoolPickCount = normalizeRandomTagPoolPickCount(parsedPickCount);
    randomTagPoolPickCountInput.value = String(randomTagPoolPickCount);
  });
}

if (defaultImageFileInput) {
  defaultImageFileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast(
        _translations["defaultImageInvalidType"]
          ? _translations["defaultImageInvalidType"].message
          : "Please choose an image file",
        "error"
      );
      e.target.value = "";
      return;
    }
    if (file.size > MAX_DEFAULT_IMAGE_FILE_SIZE) {
      showToast(
        (_translations["defaultImageTooLarge"]
          ? _translations["defaultImageTooLarge"].message
          : "Image is too large. Please keep it under {size} MB."
        ).replace("{size}", String(MAX_DEFAULT_IMAGE_FILE_SIZE / 1024 / 1024)),
        "error"
      );
      e.target.value = "";
      return;
    }
    try {
      defaultImagePreviewUrl = await readFileAsDataUrl(file);
      await saveUploadedDefaultImage(file, file.name || "");
      defaultImageUrl = "";
      defaultImageSourceType = "upload";
      defaultImageUploadName = file.name || "";
      syncDefaultImageControls();
      await persistDisplaySettings();
      showToast(
        _translations["defaultImageUploadSuccess"]
          ? _translations["defaultImageUploadSuccess"].message
          : "Default image loaded from local file",
        "success"
      );
    } catch (err) {
      console.error("Default image upload error:", err);
      showToast(
        _translations["defaultImageUploadError"]
          ? _translations["defaultImageUploadError"].message
          : "Failed to read local image",
        "error"
      );
    } finally {
      e.target.value = "";
    }
  });
}

// Language
const langSelect = document.getElementById("languageSelect");
const defaultLang = localStorage.getItem("language") || "en";
langSelect.value = defaultLang;
loadTranslations(defaultLang);

langSelect.addEventListener("change", (e) => {
  const lang = e.target.value;
  localStorage.setItem("language", lang);
  loadTranslations(lang);
});

// Init
if (ext && ext.storage && ext.storage.onChanged) {
  ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.randomImageEnabled) {
      randomImageEnabled = changes.randomImageEnabled.newValue !== false;
      syncRandomImageToggleControl();
    }

    if (changes.mode) {
      onlyR18Content = changes.mode.newValue === "r18";
      syncRandomImageToggleControl();
    }

    if (changes.randomTagPool) {
      randomTagPool = Array.isArray(changes.randomTagPool.newValue)
        ? changes.randomTagPool.newValue.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
    }

    if (changes.randomTagPoolCounts || changes.randomTagPool) {
      const nextCountsSource = changes.randomTagPoolCounts
        ? changes.randomTagPoolCounts.newValue
        : randomTagPoolCounts;
      randomTagPoolCounts = normalizeRandomTagPoolCounts(nextCountsSource, randomTagPool);
      renderRandomTagPool();
    }

    if (changes.randomTagPoolLastResolvedTags) {
      randomTagPoolLastResolvedTags = Array.isArray(changes.randomTagPoolLastResolvedTags.newValue)
        ? changes.randomTagPoolLastResolvedTags.newValue.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
    }

    if (changes.randomTagPoolLastResolvedAt) {
      randomTagPoolLastResolvedAt = Number.isFinite(changes.randomTagPoolLastResolvedAt.newValue)
        ? Number(changes.randomTagPoolLastResolvedAt.newValue)
        : 0;
    }

    if (changes.randomTagPoolLastResolvedTags || changes.randomTagPoolLastResolvedAt) {
      renderLastResolvedRandomTags();
    }
  });
}

loadTags();
