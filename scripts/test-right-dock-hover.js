const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
const js = fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8");

assert(
  html.includes('<div id="rightDockHotspot" aria-hidden="true"></div>'),
  "Expected a right dock hotspot element in index.html",
);

assert(
  js.includes('document.body.classList.add("dock-collapsible")'),
  "Expected desktop dock mode to add the dock-collapsible class",
);

assert(
  js.includes('window.innerWidth - 72') && js.includes('Math.min(220, Math.round(window.innerHeight * 0.38))'),
  "Expected right dock hotspot geometry to be enforced in index.js",
);

assert(
  js.includes('revealRightDockFor(3000);') && js.includes('revealRightDockFor(2500);'),
  "Expected right dock to reveal itself when popups open",
);

assert(
  !js.includes('this.illustInfoFadeOutTimeoutId = setTimeout'),
  "Artwork info panel should no longer auto-fade out",
);

console.log("Right dock hover behavior checks passed.");
