const fs = require("fs");
const path = require("path");
const assert = require("assert");

const indexHtml = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
const indexJs = fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8");
const backgroundJs = fs.readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8");
const styleCss = fs.readFileSync(path.join(__dirname, "..", "src", "style.css"), "utf8");

assert(indexHtml.includes('id="randomTagSearchInput"'), "Missing random tag search input in index.html");
assert(styleCss.includes(".page-search-input"), "Missing page search input style");

assert(indexJs.includes('randomTagSearchPlaceholder'), "Missing random tag search placeholder string");
assert(indexJs.includes('randomTagSearchTitle'), "Missing random tag search title string");
assert(indexJs.includes('document.body.querySelector("#randomTagSearchInput")'), "Missing random tag search input binding");
assert(indexJs.includes('sendRuntimeMessageWithTimeout({ action: "fetchImage", manualRandomTag }'), "Missing manual random tag fetch request");
assert(indexJs.includes('showToast(translate("manualRandomTagNoResult"), "success");'), "Missing manual random tag fallback toast");

assert(backgroundJs.includes("function createManualRandomTagSearchSource(config, manualRandomTag)"), "Missing manual random tag search source helper");
assert(backgroundJs.includes('const manualRandomTag = String(message.manualRandomTag || "").trim();'), "Missing manual random tag extraction in background");
assert(backgroundJs.includes("res.usedManualRandomTag = manualRandomTag ? usedManualRandomTag : null;"), "Missing manual random tag result marker");

console.log("Manual random tag input checks passed.");
