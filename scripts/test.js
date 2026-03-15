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
expectProp(illustInfo, "gap", "6px");
expectProp(illustInfo, "min-height", "54px");
expectProp(illustInfo, "padding", "8px 10px");

const avatarImage = getBlock("#avatarImage");
expectProp(avatarImage, "width", "44px");
expectProp(avatarImage, "height", "44px");

const illustTitle = getBlock("#illustTitle");
expectProp(illustTitle, "font-size", "14px");

const illustName = getBlock("#illustName");
expectProp(illustName, "font-size", "12px");

const creatorActions = getBlock("#creatorActions");
expectProp(creatorActions, "gap", "4px");
expectProp(creatorActions, "margin-top", "2px");

const buttonBlock = getBlock("#likeButton,\n#bookmarkButton,\n#downloadOriginalButton,\n#dislikeButton,\n#creatorLikeButton,\n#creatorDislikeButton");
expectProp(buttonBlock, "width", "20px");
expectProp(buttonBlock, "height", "20px");

console.log("CSS UI size checks passed.");
