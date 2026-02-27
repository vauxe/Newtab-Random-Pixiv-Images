import { defaultConfig, buildQuery, migrateConfig, legacyToTree, treeToLegacy } from "./config.js";

const ext = typeof chrome !== "undefined"
  ? chrome
  : (typeof browser !== "undefined" ? browser : null);

// ── State ──
let queryTree = { type: "group", connector: "AND", children: [] };
let presets = []; // Array of { name: string, tree: queryTree }
let activePresetIndex = 0;
let globalMinusKeywords = "";

// ── DOM refs ──
const flowContainer = document.getElementById("flowContainer");
const emptyState = document.getElementById("emptyState");
const presetSelect = document.getElementById("presetSelect");
const presetRenameInput = document.getElementById("presetRenameInput");
const globalMinusInput = document.getElementById("globalMinusKeywords");
const blocklistCard = document.getElementById("blocklistCard");
const blocklistToggle = document.getElementById("blocklistToggle");

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

  updatePreview();
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
    presetMinusKeywords: [],
  });
}

// ── Preview ──

function updatePreview() {
  // Preview removed
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
    presetMinusKeywords: [],
  }, (items) => {
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

    renderPresetSelect();
    renderAll();
  });
}

function saveTags() {
  // Sync to preset
  if (presets[activePresetIndex]) {
    presets[activePresetIndex].tree = JSON.parse(JSON.stringify(queryTree));
  }
  if (globalMinusInput) {
    globalMinusKeywords = globalMinusInput.value.trim();
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

  if (ext && ext.runtime && ext.runtime.sendMessage) {
    ext.runtime.sendMessage({ action: "updateConfig" }, (response) => {
      if (ext.runtime.lastError) {
        console.log(ext.runtime.lastError.message);
      }
    });
  } else {
    console.warn("Extension runtime unavailable, updateConfig not sent.");
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

function importFromJsonFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
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
      if (Array.isArray(data.presetMinusKeywords) && data.presetMinusKeywords.length > 0) {
        const extra = data.presetMinusKeywords.map(s => (s || "").trim()).filter(Boolean).join(" ");
        if (extra) {
          globalMinusKeywords = [globalMinusKeywords, extra].filter(Boolean).join(" ").replace(/\s+/g, " ");
        }
      }
      if (globalMinusInput) globalMinusInput.value = globalMinusKeywords;

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

function openImportModal() {
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
    importFromText(text);
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
document.getElementById("importTextBtn").addEventListener("click", openImportModal);
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

if (blocklistToggle && blocklistCard) {
  blocklistToggle.addEventListener("click", () => {
    const isCollapsed = blocklistCard.classList.toggle("collapsed");
    blocklistToggle.textContent = isCollapsed ? "Show" : "Hide";
  });
}

if (globalMinusInput) {
  globalMinusInput.addEventListener("input", () => {
    globalMinusKeywords = globalMinusInput.value.trim();
    updatePreview();
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
loadTags();
