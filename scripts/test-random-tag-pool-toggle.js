const fs = require("fs");
const path = require("path");
const assert = require("assert");

const indexHtml = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
const indexJs = fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8");
const styleCss = fs.readFileSync(path.join(__dirname, "..", "src", "style.css"), "utf8");

assert(indexHtml.includes('id="randomTagPoolToggleControl"'), "Missing random tag pool toggle control in index.html");
assert(indexHtml.includes('id="randomTagPoolToggleInput"'), "Missing random tag pool toggle input in index.html");
assert(indexHtml.includes('id="randomTagPoolToggleText"'), "Missing random tag pool toggle text in index.html");

assert(indexJs.includes('randomTagPoolLabel: "随机池"'), "Missing random tag pool UI string");
assert(indexJs.includes("function setRandomTagPoolToggleState(enabled)"), "Missing random tag pool toggle state helper");
assert(indexJs.includes("function handleRandomTagPoolToggleChange(event)"), "Missing random tag pool toggle handler");
assert(indexJs.includes("chrome.storage.local.set({ randomTagPoolEnabled: enabled }"), "Missing random tag pool storage persistence");
assert(indexJs.includes("handleStoredRandomTagPoolEnabledChange"), "Missing random tag pool storage sync handler");
assert(indexJs.includes('document.body.querySelector("#randomTagPoolToggleInput")'), "Missing random tag pool toggle binding");

assert(styleCss.includes("#randomTagPoolToggleInput"), "Missing random tag pool toggle styling");
assert(styleCss.includes("#randomTagPoolToggleText"), "Missing random tag pool toggle text styling");

console.log("Random tag pool page toggle checks passed.");
