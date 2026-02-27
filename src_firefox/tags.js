import { defaultConfig, buildQuery, buildQueryFromTree, migrateConfig, legacyToTree, treeToLegacy } from "./config.js";

// ── State ──
let queryTree = { type: "group", connector: "AND", children: [] };
let presets = [];
let activePresetIndex = 0;

// ── DOM refs ──
const flowContainer = document.getElementById("flowContainer");
const emptyState = document.getElementById("emptyState");
const presetSelect = document.getElementById("presetSelect");

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
  toggleBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleNegated(tag); });

  const textSpan = document.createElement("span");
  textSpan.className = "capsule-text";
  textSpan.textContent = tag.value;

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", (e) => { e.stopPropagation(); removeChild(parentGroup, index); });

  el.appendChild(toggleBtn);
  el.appendChild(textSpan);
  el.appendChild(removeBtn);
  return el;
}

function createConnector(group) {
  const conn = document.createElement("span");
  const isOR = group.connector === "OR";
  conn.className = `connector ${isOR ? "connector-or" : "connector-and"}`;
  conn.textContent = isOR ? "OR" : "AND";
  conn.title = "Click to toggle AND/OR";
  conn.addEventListener("click", (e) => { e.stopPropagation(); toggleConnector(group); });
  return conn;
}

function createInlineInput(group) {
  const wrapper = document.createElement("span");
  wrapper.className = "inline-input";
  const input = document.createElement("input");
  input.placeholder = _translations["addTagPlaceholder"] ? _translations["addTagPlaceholder"].message : "Add a tag...";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = input.value.trim();
      if (val) val.split(/\s+/).filter(Boolean).forEach(v => addTagToGroup(group, v));
    } else if (e.key === "Escape") { wrapper.remove(); }
  });
  input.addEventListener("blur", () => {
    const val = input.value.trim();
    if (val) val.split(/\s+/).filter(Boolean).forEach(v => addTagToGroup(group, v));
    else wrapper.remove();
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
  label.textContent = _translations["groupLabel"] ? _translations["groupLabel"].message : "Group (Parentheses)";
  const removeBtn = document.createElement("button");
  removeBtn.className = "btn-remove-group";
  removeBtn.textContent = "🗑";
  removeBtn.addEventListener("click", (e) => { e.stopPropagation(); removeChild(parentGroup, indexInParent); });
  header.appendChild(icon); header.appendChild(label); header.appendChild(removeBtn);
  card.appendChild(header);

  const flow = document.createElement("div");
  flow.className = "group-flow";
  renderFlowItems(group, flow);
  const addBtn = document.createElement("button");
  addBtn.className = "group-add-btn";
  addBtn.innerHTML = `+ <span>${_translations["addKeywordLabel"] ? _translations["addKeywordLabel"].message : "Keyword"}</span>`;
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const inputEl = createInlineInput(group);
    flow.insertBefore(inputEl, addBtn);
    inputEl.querySelector("input").focus();
  });
  flow.appendChild(addBtn);
  card.appendChild(flow);
  return card;
}

function renderFlowItems(group, container) {
  group.children.forEach((child, i) => {
    if (i > 0) container.appendChild(createConnector(group));
    if (child.type === "tag") container.appendChild(createCapsule(child, group, i));
    else if (child.type === "group") container.appendChild(renderGroupCard(child, group, i));
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
    opt.value = i; opt.textContent = p.name;
    if (i === activePresetIndex) opt.selected = true;
    presetSelect.appendChild(opt);
  });
}

function switchPreset(index) {
  if (presets[activePresetIndex]) presets[activePresetIndex].tree = JSON.parse(JSON.stringify(queryTree));
  activePresetIndex = index;
  if (presets[index]) queryTree = JSON.parse(JSON.stringify(presets[index].tree));
  renderPresetSelect(); renderAll();
}

function addPreset(name) {
  if (presets[activePresetIndex]) presets[activePresetIndex].tree = JSON.parse(JSON.stringify(queryTree));
  presets.push({ name: name || `Preset ${presets.length + 1}`, tree: { type: "group", connector: "AND", children: [] } });
  activePresetIndex = presets.length - 1;
  queryTree = JSON.parse(JSON.stringify(presets[activePresetIndex].tree));
  renderPresetSelect(); renderAll();
}

function renamePreset(index) {
  const current = presets[index]; if (!current) return;
  const newName = prompt(_translations["presetRenamePrompt"] ? _translations["presetRenamePrompt"].message : "Enter new preset name:", current.name);
  if (newName && newName.trim()) { current.name = newName.trim(); renderPresetSelect(); }
}

function deletePreset(index) {
  if (presets.length <= 1) { showToast(_translations["presetDeleteLast"] ? _translations["presetDeleteLast"].message : "Cannot delete the last preset", "error"); return; }
  presets.splice(index, 1);
  if (activePresetIndex >= presets.length) activePresetIndex = presets.length - 1;
  queryTree = JSON.parse(JSON.stringify(presets[activePresetIndex].tree));
  renderPresetSelect(); renderAll();
}

// ── Preview ──

function updatePreview() {
  const previewEl = document.getElementById("queryPreview");
  if (previewEl) { previewEl.textContent = buildQuery({ queryTree }) || "(empty)"; }
}

// ── Storage (Firefox uses browser.* Promise API) ──

function loadTags() {
  browser.storage.local.get({ ...defaultConfig, queryPresets: null, activePresetIndex: 0 }).then((items) => {
    migrateConfig(items);
    if (items.queryPresets && Array.isArray(items.queryPresets) && items.queryPresets.length > 0) {
      presets = items.queryPresets;
      activePresetIndex = Math.min(items.activePresetIndex || 0, presets.length - 1);
      queryTree = JSON.parse(JSON.stringify(presets[activePresetIndex].tree));
    } else {
      queryTree = items.queryTree || { type: "group", connector: "AND", children: [] };
      presets = [{ name: "Default", tree: JSON.parse(JSON.stringify(queryTree)) }];
      activePresetIndex = 0;
    }
    renderPresetSelect(); renderAll();
  });
}

function saveTags() {
  if (presets[activePresetIndex]) presets[activePresetIndex].tree = JSON.parse(JSON.stringify(queryTree));
  const legacy = treeToLegacy(queryTree);
  browser.storage.local.set({
    queryTree: JSON.parse(JSON.stringify(queryTree)),
    queryPresets: JSON.parse(JSON.stringify(presets)),
    activePresetIndex,
    andKeywords: legacy.andKeywords, orGroups: legacy.orGroups, minusKeywords: legacy.minusKeywords, orKeywords: null,
  }).then(() => {
    showToast(_translations["tagsSaved"] ? _translations["tagsSaved"].message : "Tags saved!", "success");
  });
  browser.runtime.sendMessage({ action: "updateConfig" }).catch(e => console.log(e.message || e));
  updatePreview();
}

// ── Import / Export ──

function importFromText(text) {
  const tags = text.split(/[\s,，、\n]+/).map(t => t.trim()).filter(Boolean);
  if (!tags.length) return;
  tags.forEach(tag => {
    if (tag.startsWith("-")) queryTree.children.push({ type: "tag", value: tag.slice(1), negated: true });
    else queryTree.children.push({ type: "tag", value: tag, negated: false });
  });
  renderAll();
  showToast((_translations["importedCount"] ? _translations["importedCount"].message : "Imported {count} tags").replace("{count}", tags.length), "success");
}

function importFromJsonFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.queryTree && data.queryTree.type === "group") { queryTree = data.queryTree; }
      else { const tree = legacyToTree(data.andKeywords || "", data.orGroups || [], data.minusKeywords || ""); tree.children.forEach(c => queryTree.children.push(c)); }
      renderAll();
      showToast(_translations["importedCount"] ? _translations["importedCount"].message.replace("{count}", queryTree.children.length) : "Imported successfully!", "success");
    } catch (err) { showToast(_translations["importError"] ? _translations["importError"].message : "Invalid JSON file", "error"); console.error("Import error:", err); }
  };
  reader.readAsText(file);
}

function exportToJsonFile() {
  const data = { queryTree: JSON.parse(JSON.stringify(queryTree)), ...treeToLegacy(queryTree) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `pixiv-tags-${new Date().toISOString().split("T")[0]}.json`;
  a.click(); URL.revokeObjectURL(url);
  showToast(_translations["exportSuccess"] ? _translations["exportSuccess"].message : "Exported successfully!", "success");
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
function openImportModal() { document.getElementById("importModal").classList.add("active"); document.getElementById("importTextarea").value = ""; document.getElementById("importTextarea").focus(); }
function closeImportModal() { document.getElementById("importModal").classList.remove("active"); }
function confirmImport() { const text = document.getElementById("importTextarea").value; if (text.trim()) importFromText(text); closeImportModal(); }

// ── i18n ──
let _translations = {};
function loadTranslations(lang) {
  fetch(`_locales/${lang}/messages.json`).then(r => r.json()).then(data => {
    _translations = data;
    document.querySelectorAll("[id]").forEach(el => {
      if (data[el.id] && !el.closest(".flow-builder") && !el.closest(".preset-bar")) {
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
        if (el.id === "queryPreview") return;
        el.textContent = data[el.id].message;
      }
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { const key = el.getAttribute("data-i18n-placeholder"); if (data[key]) el.placeholder = data[key].message; });
    renderAll();
  }).catch(err => console.error("Error loading translations:", err));
}

// ── Event Listeners ──
document.getElementById("addKeywordBtn").addEventListener("click", () => { const inp = createInlineInput(queryTree); flowContainer.appendChild(inp); inp.querySelector("input").focus(); });
document.getElementById("addGroupBtn").addEventListener("click", () => addGroupToGroup(queryTree));

presetSelect.addEventListener("change", e => switchPreset(parseInt(e.target.value, 10)));
document.getElementById("presetNewBtn").addEventListener("click", () => { const name = prompt(_translations["presetNewPrompt"] ? _translations["presetNewPrompt"].message : "Enter preset name:", `Preset ${presets.length + 1}`); if (name && name.trim()) addPreset(name.trim()); });
document.getElementById("presetRenameBtn").addEventListener("click", () => renamePreset(activePresetIndex));
document.getElementById("presetDeleteBtn").addEventListener("click", () => deletePreset(activePresetIndex));

document.getElementById("saveBtn").addEventListener("click", saveTags);
document.getElementById("importTextBtn").addEventListener("click", openImportModal);
document.getElementById("modalCancelBtn").addEventListener("click", closeImportModal);
document.getElementById("modalConfirmBtn").addEventListener("click", confirmImport);
document.getElementById("importFileBtn").addEventListener("click", () => document.getElementById("fileInput").click());
document.getElementById("fileInput").addEventListener("change", e => { const file = e.target.files[0]; if (file) { importFromJsonFile(file); e.target.value = ""; } });
document.getElementById("exportBtn").addEventListener("click", exportToJsonFile);
document.getElementById("importModal").addEventListener("click", e => { if (e.target === e.currentTarget) closeImportModal(); });

const langSelect = document.getElementById("languageSelect");
const defaultLang = localStorage.getItem("language") || "en";
langSelect.value = defaultLang;
loadTranslations(defaultLang);
langSelect.addEventListener("change", e => { const lang = e.target.value; localStorage.setItem("language", lang); loadTranslations(lang); });

// Init
loadTags();
