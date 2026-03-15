const fs = require("fs");
const path = require("path");
const assert = require("assert");

const cssPath = path.join(__dirname, "..", "src", "style.css");
const css = fs.readFileSync(cssPath, "utf8");

function getBlock(selector) {
  const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`);
  const match = css.match(re);
  assert(match, `Missing CSS block for ${selector}`);
  return match[1];
}

function expectProp(block, prop, value) {
  const re = new RegExp(`${prop}\\s*:\\s*${value}\\s*;`);
  assert(re.test(block), `Expected ${prop}: ${value}`);
}

const illustInfo = getBlock("#illustInfo");
expectProp(illustInfo, "gap", "10px");
expectProp(illustInfo, "min-height", "72px");
expectProp(illustInfo, "padding", "12px");

const avatarImage = getBlock("#avatarImage");
expectProp(avatarImage, "width", "48px");
expectProp(avatarImage, "height", "48px");

const illustTitle = getBlock("#illustTitle");
expectProp(illustTitle, "font-size", "14px");

const illustName = getBlock("#illustName");
expectProp(illustName, "font-size", "12px");

const creatorActions = getBlock("#creatorActions");
expectProp(creatorActions, "gap", "6px");
expectProp(creatorActions, "margin-top", "6px");

const buttonBlock = getBlock("#likeButton,\n#bookmarkButton,\n#downloadOriginalButton,\n#dislikeButton,\n#creatorLikeButton,\n#creatorDislikeButton");
expectProp(buttonBlock, "width", "24px");
expectProp(buttonBlock, "height", "24px");

const pageControls = getBlock("#pageControls");
expectProp(pageControls, "display", "grid");
expectProp(pageControls, "width", "var\\(--dock-width\\)");

const requestPopup = getBlock("\\.request-tag-popup");
expectProp(requestPopup, "bottom", "308px");

console.log("CSS UI size checks passed.");
