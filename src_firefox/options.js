import { defaultConfig, getKeywords, buildQuery, migrateConfig } from "./config.js";

const saveOptions = () => {
  updateKeywords();
  const newConfig = {
    order: document.getElementById('order').value,
    mode: document.getElementById('mode').value,
    timeOption: document.getElementById('timeOption').value,
    scd: document.getElementById('scd').value || null,
    ecd: document.getElementById('ecd').value || null,
    blt: document.getElementById('blt').value ? Number(document.getElementById('blt').value) : null,
    bgt: document.getElementById('bgt').value ? Number(document.getElementById('bgt').value) : null,
    s_mode: document.getElementById('s_mode').value,
    type: document.getElementById('type').value,
    min_sl: document.getElementById('min_sl').value ? Number(document.getElementById('min_sl').value) : null,
    max_sl: document.getElementById('max_sl').value ? Number(document.getElementById('max_sl').value) : null,
    aiType: document.getElementById('aiType').value ? Number(document.getElementById('aiType').value) : null,
    // orGroups is managed by the tag manager page, preserve it from storage
    minusKeywords: document.getElementById('minusKeywords').value.trim(),
    andKeywords: document.getElementById('andKeywords').value.trim(),
  };

  browser.storage.local.set(
    newConfig,
    () => {
      const status = document.getElementById('status');
      status.textContent = 'Options saved.';
      setTimeout(() => {
        status.textContent = '';
      }, 1000);
      console.log("Save config");
      console.log(newConfig);
    }
  );

  browser.runtime.sendMessage({ action: "updateConfig" }, (response) => {
    let lastError = browser.runtime.lastError;
    if (lastError) {
      console.log(lastError.message);
      return;
    }
  });
};

const resetOptions = () => {
  browser.storage.local.set(
    defaultConfig,
    () => {
      console.log("Reset config");
      console.log(defaultConfig);
      let items = defaultConfig;
      document.getElementById('order').value = items.order;
      document.getElementById('mode').value = items.mode;
      document.getElementById('timeOption').value = items.timeOption;
      toggleDateInputs(items.timeOption);
      document.getElementById('scd').value = items.scd;
      document.getElementById('ecd').value = items.ecd;
      document.getElementById('blt').value = items.blt;
      document.getElementById('bgt').value = items.bgt;
      document.getElementById('s_mode').value = items.s_mode;
      document.getElementById('type').value = items.type;
      document.getElementById('min_sl').value = items.min_sl;
      document.getElementById('max_sl').value = items.max_sl;
      document.getElementById('aiType').value = items.aiType;
      document.getElementById('andKeywords').value = items.andKeywords;
      document.getElementById('minusKeywords').value = items.minusKeywords;
      updateKeywords(items);
      const status = document.getElementById('status');
      status.textContent = 'Options reset.';
      setTimeout(() => {
        status.textContent = '';
      }, 1000);
      console.log("Reset config");
      console.log(items);
    }
  );
};


const restoreOptions = () => {
  browser.storage.local.get(defaultConfig, (items) => {
    console.log("Load config");
    console.log(items);
    document.getElementById('order').value = items.order;
    document.getElementById('mode').value = items.mode;
    document.getElementById('timeOption').value = items.timeOption;
    toggleDateInputs(items.timeOption);
    document.getElementById('scd').value = items.scd;
    document.getElementById('ecd').value = items.ecd;
    document.getElementById('blt').value = items.blt;
    document.getElementById('bgt').value = items.bgt;
    document.getElementById('s_mode').value = items.s_mode;
    document.getElementById('type').value = items.type;
    document.getElementById('min_sl').value = items.min_sl;
    document.getElementById('max_sl').value = items.max_sl;
    document.getElementById('aiType').value = items.aiType === null ? '' : items.aiType;
    document.getElementById('andKeywords').value = items.andKeywords;
    document.getElementById('minusKeywords').value = items.minusKeywords;
    migrateConfig(items);
    updateKeywords(items);
  });
};

function toggleDateInputs(option) {
  const dateInputs = document.getElementById('dateInputs');
  if (option === "specific") {
    dateInputs.style.display = "block";
  } else {
    dateInputs.style.display = "none";
    document.getElementById('scd').value = "";
    document.getElementById('ecd').value = "";
  }
}

function updateKeywords(configOrNull) {
  let andKeywords = document.getElementById('andKeywords').value;
  let minusKeywords = document.getElementById('minusKeywords').value;
  // Get orGroups from passed config or from last loaded config
  let orGroups = configOrNull && configOrNull.orGroups ? configOrNull.orGroups : _lastOrGroups;
  if (orGroups) _lastOrGroups = orGroups;
  // Use tree-based query if available
  let queryTree = configOrNull && configOrNull.queryTree ? configOrNull.queryTree : _lastQueryTree;
  if (queryTree) _lastQueryTree = queryTree;
  let word;
  if (queryTree) {
    word = buildQuery({ queryTree });
  } else {
    word = getKeywords(andKeywords, orGroups || [], minusKeywords);
  }
  document.getElementById('keywords').value = word;
}
let _lastOrGroups = null;
let _lastQueryTree = null;

document.getElementById('timeOption').addEventListener('change', function () { toggleDateInputs(this.value); });
document.getElementById('minusKeywords').addEventListener('input', () => updateKeywords());
document.getElementById('andKeywords').addEventListener('input', () => updateKeywords());
document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('reset').addEventListener('click', resetOptions);

document.addEventListener("DOMContentLoaded", function () {
  const langSelect = document.getElementById("languageSelect");
  const defaultLang = localStorage.getItem("language") || "en";
  langSelect.value = defaultLang;

  function loadTranslations(lang) {
    fetch(`_locales/${lang}/messages.json`)
      .then((response) => response.json())
      .then((data) => {
        document.querySelectorAll("[id]").forEach((el) => {
          if (data[el.id]) {
            el.textContent = data[el.id].message;
          }
        });
        document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
          const key = el.getAttribute("data-i18n-placeholder");
          if (data[key]) {
            el.placeholder = data[key].message;
          }
        });
      })
      .catch((error) => console.error("Error loading translations:", error));
  }

  loadTranslations(defaultLang);

  langSelect.addEventListener("change", (event) => {
    const selectedLang = event.target.value;
    localStorage.setItem("language", selectedLang);
    loadTranslations(selectedLang);
  });
});
