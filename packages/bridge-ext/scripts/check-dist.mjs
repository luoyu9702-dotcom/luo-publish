import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = (rel) => read(`../src/${rel}`);

const manifest = JSON.parse(read("../dist/manifest.json"));
const popup = read("../dist/popup.html");
const background = read("../dist/background.js");
const popupJs = read("../dist/popup.js");

if (manifest.manifest_version !== 3) throw new Error("manifest is not MV3");
for (const permission of ["storage", "tabs", "scripting", "alarms"]) {
  if (!manifest.permissions.includes(permission)) throw new Error(`missing permission ${permission}`);
}
if (!manifest.host_permissions.includes("http://127.0.0.1/*")) {
  throw new Error("missing 127.0.0.1 host permission");
}
if (manifest.background?.service_worker !== "background.js") throw new Error("service worker path");
if (manifest.action?.default_popup !== "popup.html") throw new Error("popup path");
if (manifest.content_scripts) throw new Error("CSDN fill uses executeScript, not a content script");
for (const host of ["https://mp.csdn.net/*", "https://mp.weixin.qq.com/*", "https://x.com/*", "https://twitter.com/*", "https://member.bilibili.com/*", "https://creator.xiaohongshu.com/*"]) {
  if (!manifest.host_permissions.includes(host)) throw new Error(`missing host permission ${host}`);
}
if (!background.includes("https://mp.csdn.net/mp_blog/creation/editor")) {
  throw new Error("background missing CSDN editor URL");
}
if (!background.includes("https://x.com/compose/post")) {
  throw new Error("background missing X compose URL");
}
if (!background.includes("https://member.bilibili.com/york/read-editor")) {
  throw new Error("background missing Bilibili editor URL");
}
if (!background.includes("https://creator.xiaohongshu.com/publish/publish?from=menu&target=image")) {
  throw new Error("background missing Xiaohongshu editor URL");
}
// The WeChat filler stays unwired: nothing in the bundle may point at its editor.
if (background.includes("mp.weixin.qq.com") || background.includes("fill-wechat")) {
  throw new Error("background must not open the WeChat editor");
}
for (const snippet of ["尚未填写", "fill-x", "fill-xiaohongshu", "fill-bilibili", "fill-csdn"]) {
  if (!popup.includes(snippet)) throw new Error(`popup missing last fill list (${snippet})`);
}
if (popup.includes("公众号") || popup.includes("fill-wechat")) {
  throw new Error("popup must not list 公众号");
}
if (!popupJs.includes("已填入")) throw new Error("popup missing fill status text");
if (!background.includes("luoLastFills")) throw new Error("last fill storage missing");
if (!popup.includes("配对") || !popup.includes("拉取并填入")) throw new Error("popup copy missing");
if (!popup.includes("popup.js")) throw new Error("popup script missing");
if (!background.includes("/pair") || !background.includes("/pending")) throw new Error("background missing bridge paths");
if (!background.includes("/report")) throw new Error("background missing report path");
if (!background.includes("luo-auto-pull")) throw new Error("background missing auto-pull alarm");
if (!popupJs.includes("setInterval") || (!popupJs.includes("2000") && !popupJs.includes("2e3"))) {
  throw new Error("popup poll while open is missing");
}
if (!popupJs.includes("拉取") && !popupJs.includes("pending")) throw new Error("popup script missing pull");

// Source-level scope: only fillers/publish.ts may target a publish control.
// The wired fillers must stay draft-only, so a stray publish click cannot ship
// inside a fill step.
const PUBLISH_MARKERS = ["btn-publish", "发布文章", "js_send", "js_submit", "tweetButton", "xhs-publish", "mp.weixin.qq.com", "fill-wechat"];
const FILL_SOURCES = [
  "fillers/types.ts",
  "fillers/inject.ts",
  "fillers/images.ts",
  "fillers/x.ts",
  "fillers/xiaohongshu.ts",
  "fillers/bilibili.ts",
  "fillers/csdn.ts",
];
for (const file of FILL_SOURCES) {
  const code = src(file);
  for (const marker of PUBLISH_MARKERS) {
    if (code.includes(marker)) throw new Error(`fill code must not target a publish control: ${file} has ${marker}`);
  }
}
const publishSource = src("fillers/publish.ts");
for (const marker of ["tweetButton", "发布博客", "草稿", "__luoPublishClicked"]) {
  if (!publishSource.includes(marker)) throw new Error(`publish clicker missing ${marker}`);
}
if (!background.includes("tweetButton")) throw new Error("background missing the publish clicker");
if (!background.includes("__luoPublishClicked")) throw new Error("background missing the publish double-click guard");
if (!background.includes("autoPublish")) throw new Error("background missing the auto-publish flag");

console.log("extension dist ok: unpacked MV3 pairing popup, draft-only fillers, scoped publish clicker");
