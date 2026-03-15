const fs = require("fs");
const path = require("path");
const assert = require("assert");

const indexHtml = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
const indexJs = fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8");
const backgroundJs = fs.readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8");

assert(indexHtml.includes('id="downloadOriginalButton"'), "Missing download original button in index.html");
assert(indexJs.includes("let currentOriginalImageUrl = null;"), "Missing original image state in index.js");
assert(indexJs.includes("function handleDownloadOriginal()"), "Missing download handler in index.js");
assert(indexJs.includes('translate("downloadOriginalTitle")'), "Missing localized download title");
assert(indexJs.includes("fetch(currentOriginalImageUrl"), "Missing original image fetch call");
assert(indexJs.includes("link.download = getOriginalDownloadFilename(currentOriginalImageUrl);"), "Missing download filename assignment");
assert(backgroundJs.includes('res.originalImageUrl = illustInfo.body.urls.original || "";'), "Missing original image URL in background response");

console.log("Original image download wiring checks passed.");
