const fs = require("fs");
const path = require("path");
const assert = require("assert");

const configJs = fs.readFileSync(path.join(__dirname, "..", "src", "config.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
const indexJs = fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8");
const backgroundJs = fs.readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8");

assert(configJs.includes("blockedIllustIds: []"), "Missing blockedIllustIds default config");
assert(configJs.includes("config.blockedIllustIds = Array.from(new Set("), "Missing blockedIllustIds migration normalization");
assert(indexHtml.includes('id="tagPopupActions"'), "Missing tag popup actions container");
assert(indexJs.includes('label: translate("blockIllustAction")'), "Missing block illust popup action");
assert(indexJs.includes("function blockCurrentIllust(actionBtn)"), "Missing blockCurrentIllust handler");
assert(indexJs.includes('{ action: "blockIllust", illustId: currentIllustId }'), "Missing blockIllust runtime message");
assert(backgroundJs.includes('} else if (message.action === "blockIllust") {'), "Missing background blockIllust action");
assert(backgroundJs.includes("blockedIllustIds.push(illustId);"), "Missing blocked illust persistence");
assert(backgroundJs.includes("let condition5 = !this.isBlockedIllust(el.id);"), "Missing blocked illust filtering");

console.log("Blocked illust wiring checks passed.");
