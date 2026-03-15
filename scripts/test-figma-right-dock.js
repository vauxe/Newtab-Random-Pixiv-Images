const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");

assert(
  html.includes('id="illustPrimaryActions" class="illust-action-strip"'),
  "Expected the left action group to use the Figma-style action strip",
);

assert(
  html.includes('id="creatorActions" class="illust-action-strip"'),
  "Expected the right action group to use the Figma-style action strip",
);

assert(
  html.includes('stroke:currentColor') && html.includes('fill:none'),
  "Expected outline-style SVG icons for the Figma-inspired info bar",
);

console.log("Figma right dock structure checks passed.");
