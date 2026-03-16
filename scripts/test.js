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

function getLastBlock(selector) {
  const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`, "gm");
  const matches = [...css.matchAll(re)];
  assert(matches.length > 0, `Missing CSS block for ${selector}`);
  return matches[matches.length - 1][1];
}

function expectProp(block, prop, value) {
  const re = new RegExp(`${prop}\\s*:\\s*${value}\\s*;`);
  assert(re.test(block), `Expected ${prop}: ${value}`);
}

const illustInfo = getBlock("#illustInfo");
expectProp(illustInfo, "grid-template-columns", "auto auto minmax\\(0, 1fr\\) auto");
expectProp(illustInfo, "gap", "14px");
expectProp(illustInfo, "width", "min\\(492px, calc\\(100vw - 24px\\)\\)");
expectProp(illustInfo, "min-height", "68px");
expectProp(illustInfo, "padding", "10px 16px");
expectProp(illustInfo, "border-radius", "16px");

const avatarImage = getBlock("#avatarImage");
expectProp(avatarImage, "width", "56px");
expectProp(avatarImage, "height", "56px");

const illustTitle = getBlock("#illustTitle");
expectProp(illustTitle, "font-size", "20px");

const illustName = getBlock("#illustName");
expectProp(illustName, "font-size", "16px");

const creatorActions = getBlock("#creatorActions");
expectProp(creatorActions, "gap", "18px");
expectProp(creatorActions, "justify-self", "end");
expectProp(creatorActions, "margin-top", "0");

const buttonBlock = getBlock("#likeButton,\n#bookmarkButton,\n#downloadOriginalButton,\n#dislikeButton,\n#creatorLikeButton,\n#creatorDislikeButton");
expectProp(buttonBlock, "width", "28px");
expectProp(buttonBlock, "height", "28px");
expectProp(buttonBlock, "background", "transparent");
expectProp(buttonBlock, "border", "0");

const pageControls = getBlock("#pageControls");
expectProp(pageControls, "display", "grid");
expectProp(pageControls, "width", "var\\(--dock-width\\)");

const requestPopup = getLastBlock("^\\.request-tag-popup");
expectProp(requestPopup, "bottom", "308px");

const hotspot = getBlock("#rightDockHotspot");
expectProp(hotspot, "width", "72px");
expectProp(hotspot, "height", "min\\(360px, 60vh\\)");

const hiddenDockBlock = getBlock("body\\.dock-collapsible:not\\(\\.right-dock-active\\) #pageControls,\nbody\\.dock-collapsible:not\\(\\.right-dock-active\\) #illustInfo,\nbody\\.dock-collapsible:not\\(\\.right-dock-active\\) \\.tag-popup,\nbody\\.dock-collapsible:not\\(\\.right-dock-active\\) \\.request-tag-popup");
expectProp(hiddenDockBlock, "opacity", "0");
expectProp(hiddenDockBlock, "transform", "translateX\\(20px\\)");

console.log("CSS UI size checks passed.");
