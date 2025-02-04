import { defaultConfig, getKeywords } from "./config.js";

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
    orKeywords: document.getElementById('orKeywords').value.trim(),
    minusKeywords: document.getElementById('minusKeywords').value.trim(),
    andKeywords: document.getElementById('andKeywords').value.trim(),
    keywords: document.getElementById('keywords').value.trim()
  };

  chrome.storage.local.set(
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

  chrome.runtime.sendMessage({ action: "updateConfig" }, (response) => {
    let lastError = chrome.runtime.lastError;
    if (lastError) {
      console.log(lastError.message);
      return;
    }
  });
};

const resetOptions = () => {
  chrome.storage.local.set(
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
      document.getElementById('orKeywords').value = items.orKeywords;
      document.getElementById('minusKeywords').value = items.minusKeywords;
      updateKeywords();
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
  chrome.storage.local.get(defaultConfig, (items) => {
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
    document.getElementById('aiType').value = items.aiType;
    document.getElementById('andKeywords').value = items.andKeywords;
    document.getElementById('orKeywords').value = items.orKeywords;
    document.getElementById('minusKeywords').value = items.minusKeywords;
    updateKeywords();
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

function updateKeywords() {
  let andKeywords = document.getElementById('andKeywords').value;
  let orKeywords = document.getElementById('orKeywords').value;
  let minusKeywords = document.getElementById('minusKeywords').value;
  let word = getKeywords(andKeywords, orKeywords, minusKeywords);
  document.getElementById('keywords').value = word;
}

document.getElementById('timeOption').addEventListener('change', function () { toggleDateInputs(this.value); });
document.getElementById('orKeywords').addEventListener('input', updateKeywords);
document.getElementById('minusKeywords').addEventListener('input', updateKeywords);
document.getElementById('andKeywords').addEventListener('input', updateKeywords);
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
