import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../main.js", import.meta.url), "utf8");
const manifest = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
);

if (manifest.id !== "luo-publish") {
  throw new Error(`manifest id is ${manifest.id}, expected luo-publish`);
}
if (manifest.isDesktopOnly !== true) {
  throw new Error("manifest isDesktopOnly must be true");
}

for (const snippet of [
  "luo-ping",
  "Luo Publish: Ping",
  "luo-publish ok",
  "入库当前笔记",
  "创建分发任务",
  "复制配对令牌",
  "重新生成配对令牌",
  "推送到浏览器草稿",
  "标记已发布",
  "复制并打开创作页",
  "https://x.com/compose/post",
  "https://mp.csdn.net/mp_blog/creation/editor",
  "127.0.0.1",
  "push-queue.json",
  "桥地址",
  "平台账号",
  "从 publish-accounts 导入",
  "one-click-distribute",
  "一键分发",
  "one-click-publish",
  "一键发布",
  "自动发布总开关",
  "尚未开启自动发布",
  "请先入库当前笔记",
]) {
  if (!js.includes(snippet)) {
    throw new Error(`main.js is missing ${JSON.stringify(snippet)}`);
  }
}

console.log("plugin bundle ok: Ping, ingest, outbox, and bridge commands are present");
