# luo-publish × WeSight 差距分析

- 日期：2026-10-23
- 对照对象：WeSight（Obsidian 插件，v1.4.0，商业会员制）
- 我方现状：luo-publish v0.1.0（自用，本地优先，无账号、无云端、无 LLM）
- 验证状态：`pnpm install && pnpm test` 全绿（插件 65 tests / 12 文件，扩展 39 tests / 8 文件，tsc + esbuild + check-bundle + check-dist 通过）

> **实施状态（2026-10-24 追加，v0.2.0）**：P0-1 / P0-2 / P0-3 三项堵点已全部落地，测试扩到插件 99 tests / 扩展 55 tests，四平台元数据 bump 到 0.2.0，artifacts 已刷新。另应用户在看 WeSight 录屏后的诉求，追加实现了**一键发布全自动化**（默认关闭 + 分平台开关 + 确认弹窗 + 扩展代点发布 + 护栏）。下面 §4 每节末尾标注了实际做法与计划的差异；§3 表格中的对应行已更新。

> **实施状态（2026-10-24 续，OD 精讲分发补强）**：在 v0.2.0 之上落地了 **OD 模式 + Telegram 通道**（设计文档《luo-publish OD 模式设计（精讲分发补强）》状态由「待批准」转为「已实现」）。要点：①新增任务类型 `od`（`TaskType = "standard" | "od"`），OD 任务夹生成 `csdn.md / xiaohongshu.md / wechat.md / tg.md` + `status.json`（仅 `csdn/xiaohongshu/wechat` 三 key）；②`status.json` 改为宽松 `Record<string, DraftState>`，`KNOWN_STATUS_KEYS` 白名单容错（未知 key / 非法值忽略，绝不抛错），从 `wechat` key 推断 OD 类型、不写 `type` 字段以保定制版格式兼容；③一键分发/发布改为遍历任务实际 status key，跳过 `wechat`、排除 `tg`，OD 强制只填不点；④新增独立命令 **发送到 TG 频道**（`TgConfirmModal` 确认 → Bot API `sendMessage`，Markdown 优先、实体被拒自动降级纯文本重发一次、不连发），TG 配置存 `data.json`（不进库/不进 git），**发送结果记插件本地数据、不写 status.json**；⑤小红书配图实际随行自动上传（images 字段已预留）。standard 类型行为与 v0.2.0 完全一致（回归覆盖）。测试扩到插件 115 tests / 扩展 55 tests。详见 §5 的 **P1-5**。

---

## 1. 一句话结论

核心分发链路（入库 → 草稿 → 本地桥 → 浏览器填表）已经闭环且质量不差；**真正的差距不在"大功能"，而在三件事：状态回流、图片上传、平台文案规则（字数/标题限制）**——这三项不做，日常用起来就会堵。WeSight 的内容生产层（agent 聊天、行内编辑、AI 文案）与商业层（会员、分享、飞书）是路线分歧，不是必须补的差距。

## 2. 架构层面的三个根本分歧（先想清楚再决定追不追）

| 维度 | WeSight | luo-publish | 判断 |
|---|---|---|---|
| 账号与云端 | 会员制，api.wesight.ai / share.wesight.ai，IP 白名单 | 纯本地，桥只绑 127.0.0.1 | 不追。自用工具加账号体系是纯负担 |
| 文案生产 | 本地 agent CLI（Claude Code / Codex / OpenCode）+ provider 配置 | 明确不接 LLM，文案人工或 Grok Bot 写进笔记 | **决策项**。见 §5 P2-D1 |
| 公众号路线 | 云端 API 收发草稿（AppSecret 加密在云端） | 本地填表（wechat filler 曾实现，已主动下线） | 自用走本地 filler 更合适，无需云端。见 §5 P1-4 |

WeSight 有两件事和我们完全一致，说明大方向没错：**所有工作流停在可编辑草稿，最终发布永远由用户手动完成**；**本地优先、无客户端遥测**。

## 3. 能力覆盖总表

图例：✅ 已有 · ⚠️ 部分/有硬伤 · ❌ 缺失 · ➖ 不适用

### 3.1 分发与填表（我们的主战场）

| WeSight 能力 | 我方现状 | 差距 | 优先级 |
|---|---|---|---|
| 草稿清洗（去 frontmatter/属性、标题提取、话题标签） | ✅ publish-body.ts：剥 YAML、剥 ingest 属性、标题不重复、小红书去标题+`#话题` | 无 | — |
| 本地配对桥 | ✅ bridge-server.ts：127.0.0.1 + 令牌 + 队列持久化 | 无 | — |
| 浏览器填表（X/小红书/B站/CSDN） | ✅ fillers 四件套 + inject 重试 + 不点发布 | 无 | — |
| 平台覆盖数量 | ⚠️ 4 平台 vs WeSight 11 个（社交 4 + 文章 7） | 缺微博、即刻、知乎、掘金、头条、X Articles、公众号 | P1 |
| 填表结果回流（per-platform status、retry、登录恢复） | ✅ `POST /report` 按 fill/publish 两阶段回传，status.json 实时更新，失败带 reason | 无（retry 靠重推） | **P0-1 ✅ 已完成** |
| 图片上传（X 前 4 张 ≤5MB；小红书选图后才出现编辑区） | ✅ 插件读库内图转 base64 随 /push 下发，扩展 DataUpload/defineProperty 双路径上传；小红书先传图再填字 | B站/CSDN 仍只提示手动上传 | **P0-2 ✅ 已完成** |
| 发布中心 UI（标题/摘要/封面调整、本地 md 导入、链接导入） | ❌ 入口是插件命令 + 扩展弹窗 | 我们形态更轻，可补"发布前预览"但不必做全套 | P2 |

### 3.2 内容生产（WeSight 的主战场，我们的空白）

| WeSight 能力 | 我方现状 | 差距 | 优先级 |
|---|---|---|---|
| Agent 侧边栏聊天（Claude Code/Codex/OpenCode 子进程、文件 mention、图片、模型切换、slash） | ❌ 无 | 最大功能块。但直接违背"不调 LLM"的现有设计原则 | 决策项 |
| 选中行内编辑 | ❌ 无 | 同上，依赖 agent CLI | 决策项 |
| 转为图文（每平台独立文案、600–900 字、X 280 加权字符、图片选择排序） | ⚠️ 有草稿但一份 markdown 通投 4 平台，无字数控制 | 无平台级文案 shaping | P1 |
| 公众号草稿（苍贺模板、gzh-design Skill 主题、AI 自定义主题） | ❌ 本地 filler 已下线 | 自用版只需要"能填进公众号编辑器"，不需要 Skill 主题 | P1 |
| 飞书文档（lark-cli） | ❌ 无 | 依赖外部 CLI 安装 | P3 |
| 互联网分享快照（share.wesight.ai） | ➖ | 依赖商业云服务 | 不适用 |

### 3.3 知识与协作

| WeSight 能力 | 我方现状 | 差距 | 优先级 |
|---|---|---|---|
| 知识大脑（claude-obsidian，SHA 校验、事务、恢复） | ❌ 无 | 我们的 raw/wiki 入库体系已覆盖"沉淀+检索"核心需求，不需要追重工程 | P3 |
| GitHub 协作（拉取/推送/idle commit/开库拉取） | ❌ 无 | vault 若要多设备同步才有价值 | P2 |
| 更新检查（GitHub Releases manifest，6 小时一次） | ❌ 无 | 低成本，顺带做版本号管理 | P2 |

### 3.4 工程与安全

| WeSight 能力 | 我方现状 | 差距 | 优先级 |
|---|---|---|---|
| 密钥管理（Obsidian SecretStorage，日志脱敏） | ⚠️ bridgeToken 明文存 data.json；扩展 token 存 chrome.storage.local | 可迁移 SecretStorage（需确认 Obsidian 版本要求） | P2 |
| 平台字数/标题限制 | ✅ publish-body.ts：weightedLength（CJK=2/URL=23）+ clampTitle，X 280 截断、小红书标题 20 字、B站 40 字，超限 Notice 提示人工核对 | 无 | **P0-3 ✅ 已完成** |
| CI | ❌ 无，测试靠本地 pnpm test | 可加 GitHub Actions | P2 |

## 4. P0 堵点详述（日常真会用痛的三项）

### P0-1 状态回流断链

- 现状：`pushDraft` 成功后写 `filled`；`一键分发` 写 `queued`。扩展填表结果只存在扩展自己的 `chrome.storage.local`（`luoLastFills`），插件侧永远看不到"到底填进去没有"。v2 task-6 报告已承认：*Filling an editor does not move `queued` to `filled`*。
- 后果：分发一批文章后，无法在 Obsidian 里回答"哪个平台填好了、哪个失败了、失败原因是什么"，只能挨个开浏览器看。
- 做法（约 1 个迭代）：
  1. `bridge-server.ts` 加 `POST /report`（带 token），body `{ platform, ok, reason?, at }`，由插件启动桥时注入 `onReport` 回调（main.ts 传入写 `status.json` 的函数）。
  2. `background.ts` 的 `fillFromPending` 在合并 `lastFills` 后，把每条结果 POST 回桥。
  3. 状态机加一个 `filled` 语义修正：`queued`（已入队）→ `filled`（扩展确认填入）/ `failed`（带回 reason）。`parseStatus` 白名单加 `failed`，写 `error` 字段进 status.json。
  4. 插件加一个「分发状态」命令/Notice：列出各 slug×platform 的当前状态。
- 涉及文件：`bridge-server.ts`、`main.ts`、`status.ts`、`outbox.ts`（类型）、`commands.ts`、`bridge-ext/src/background.ts`、`last-fills.ts`。

✅ **已完成（2026-10-24，v0.2.0）**。实际做法与计划的差异：回报体带 `stage: "fill" | "publish"` 两段（填入一段、自动发布一段，自动发布失败时平台停在 `filled` 而不是 `failed`，便于区分"没填进去"和"填了没发出去"）；`/report` 复用 push 的 token 校验链路；插件侧新增 **查看分发状态** 命令（选任务 → Notice 列出四平台状态）。失败时 `status.json` 写 `error` 字段。

### P0-2 图片上传（小红书硬阻塞）

- 现状：`draftToPush` 已从 markdown 提取图片路径塞进 item.images，但扩展 `fillers/*` 全部只写标题+正文，没有任何上传动作。小红书图文发布页**选图之前标题和正文编辑区根本不存在**（fillers/xiaohongshu.ts 注释自己写了），所以纯文字草稿在小红书 100% 失败。
- 做法（约 1–2 个迭代）：
  1. 插件侧 push 时把 vault 内图片读成 base64（或写到一个共享临时目录）随 item 下发，限制单张 ≤5MB、X 取前 4 张，超限在 Notice 里报告跳过。
  2. 扩展侧 filler 增加 `uploadImages(tabId, files)`：构造 `DataTransfer` + `File`，找到 `input[type=file]` 派发 `change`。小红书选图后编辑区出现，再走现有填表逻辑（injectFill 已有 12s 重试窗口，正好覆盖）。
  3. B站专栏/CSDN 同样支持封面/正文图（可选，先做小红书+X）。
- 涉及文件：`status.ts`（draftToPush）、`bridge-server.ts`（item 体积上限，现为 1MB body 限制需提高）、`fillers/inject.ts`、`fillers/xiaohongshu.ts`、`fillers/x.ts`、新增 `fillers/upload.ts`。

✅ **已完成（2026-10-24，v0.2.0）**。实际做法：不走共享临时目录，改为 base64 随 `/push` 线上下发（`PushImage = {name, mime, data}`），`/push` 单独放到 48MB 请求体；限制单张 ≤5MB、每篇前 4 张，跳过记 Notice；扩展侧 `applyImageUpload` 优先 `DataTransfer`，环境不允许时 `Object.defineProperty` 兜底，派发 `change`；X 先文字后传图，小红书先传图（图文模式编辑区选图后才出现）再填文字。**仅 X/小红书自动传图**，B站/CSDN 推时 Notice 提示手动上传——计划里的"B站/CSDN 可选支持"暂缓，封面图对专栏不是硬阻塞。

### P0-3 平台字数与标题限制

- 现状：一份正文通投。X 的 280 加权字符（CJK=2）完全没有检查；小红书标题限 ~20 字、B站标题限 ~30 字，超出原样写入（task-8 concern 自记未处理）。
- 做法（约 0.5 个迭代，纯本地计算，无外部依赖）：
  1. `publish-body.ts` 加 `weightedLength(text)`（CJK 记 2、URL 记 23、其余记 1）和 `clampTitle(text, max)`。
  2. `outbox.ts` 的 `shapedBody` 按平台裁剪：X 超 280 时按句号/换行截断并在 Notice 提示"已按 X 上限截断，请人工核对"；小红书/B站标题 clamp + 提示。
  3. 单元测试覆盖加权长度与截断。

✅ **已完成（2026-10-24，v0.2.0）**。`publish-body.ts` 落 `PLATFORM_LIMITS`：X 加权 280（CJK=2、URL=23）、小红书标题 20/正文 1000、B站标题 40/正文下限 200、CSDN 标题 100 字符；`clampTitle` + `truncateWeighted` 在句号/换行边界截断，超限时 Notice 提示"已按平台上限截断，请人工核对"。注意 gap 分析原文记的"B站 30 字"有误，实际为 40。

## 5. P1/P2 缺口与决策项

### P1-1 平台扩展（4 → 8+）

- 优先级顺序建议：**微博文章、知乎、掘金**（都是 markdown 编辑器， filler 模式与 CSDN/B站同构，成本低）→ 即刻/X 短内容 → 头条。
- 每加一个平台要动：`outbox.ts` PLATFORMS + `status.ts` PLATFORM_CHOICES + `fallback.ts` COMPOSE_URLS + `settings.ts` ACCOUNT_FIELDS + 新 filler + 测试 + manifest host_permissions。目前这套扩展点是散的，建议先抽一个 `platforms.ts` 单一注册表，把"平台元数据（id/label/编辑器 URL/标题上限/是否支持图片）"集中，避免五处同步改。
- 发文平台可参考 WeSight 的 11 个清单做取舍，不必全追。

### P1-2 每平台文案 shaping（不接 LLM 也能做）

- 模板级 shaping：X 短文化（取首段+要点）、小红书（去 markdown 语法+话题标签+emoji 风格可选）、B站/CSDN（保留 markdown）。WeSight 的"600–900 字、含话题不超 1000"可以做成**校验器**而不是生成器：超限给警告，让人工删。
- 这一项把"一份笔记通投"变成"一个笔记、N 个平台形态"，是性价比最高的 P1。

### P1-3 发布前预览

- 在插件侧加一个「预览分发草稿」命令/Markdown 视图：按平台展示 shaping 后的标题+正文+图片列表，替代直接盲push。低成本，显著减少填错。

### P1-4 公众号去留（决策）

- 现状：`fillers/wechat.ts` 和 `tests/wechat-fill.test.ts` 还在，但 `background.ts` 不路由、`PLATFORMS` 不含 wechat，是**死代码**。
- 选项 A（建议）：恢复为第 5 个平台（本地 filler，沿用"停在草稿不点发布"原则），设置页加回公众号账号栏。
- 选项 B：删掉 wechat.ts + 测试 + manifest 里 mp.weixin.qq.com 权限，明确不做。
- 不要选 C：追 WeSight 的云端 API 路线（IP 白名单 + AppSecret 上云），自用不值。
- **更新（2026-10-24 续）**：公众号未走选项 A 的"第 5 个 filler 平台"，而是作为 **OD 精讲任务的文件型产物**落地——OD 任务夹里生成 `wechat.md` 供你在公众号编辑器手动处理，**只建文件、不入队、不被一键分发推送**，沿用"停在草稿/手动发布"原则。`fillers/wechat.ts` 的浏览器 filler 死代码仍待清理（见 §6 #4）。

### P1-0 一键发布全自动化（用户看 WeSight 录屏后追加，已完成）

- 诉求："完善这些功能……想做成这种一键发布，全程自动化"。
- 做法：**默认关闭 + 显式开启**，不动"本地优先、无账号"的底线：
  1. `settings.ts` 新增 `AutoPublishSettings`（总开关 + 四平台分开关，默认全关），设置页有独立区块和风险说明。
  2. 新命令 **一键发布**：先查设置，一个平台都没勾时提示 `尚未开启自动发布……` 且不落盘；否则建任务 → 弹 `PublishConfirmModal`（列明哪些平台自动发布、哪些仅填草稿、"发布后无法撤回"）→ 确认后四平台入队，勾选的平台带 `autoPublish` 标记。
  3. 扩展 `fillers/publish.ts` 是**唯一允许点发布的模块**：分层标签精确匹配真实发布按钮（X `tweetButton`、B站/CSDN「发布文章/发布」等），「草稿/保存/预览/取消/下一步/定时」类按钮黑名单，`__luoPublishClicked` 页面级防重，小红书/B站/CSDN 的二次确认弹窗延迟自动点掉。
  4. `check-dist.mjs` 源码级作用域检查：发布控制标记只允许出现在 `publish.ts`，接线 filler 必须零出现——防止"填表模块顺手点发布"。
  5. 回报分 fill/publish 两阶段（见 P0-1），`status.json` 能看到每个平台最终停在哪。
- 与 WeSight 的分歧：WeSight 是"全部工作流停在草稿、发布永远手动"；我们把这一条变成了**用户可选的开关**而不是信条，因为自用场景下"确认文案后一键发四个平台"是真实高频操作。默认值仍然站在 WeSight 那一边。

### P1-5 OD 精讲分发补强（已完成，2026-10-24 续）

- 诉求："OD 精讲"类内容需要一套与四平台标准任务平行的定版分发：生成 CSDN、小红书、公众号（仅文件）、Telegram（仅 Bot API 发送）四份，不碰 X/B站，公众号不进队列、TG 不走一键分发、不自动点发布。设计文档《luo-publish OD 模式设计（精讲分发补强）》原状态「待批准」，现转为「已实现」。
- 决策项（经用户拍板，全部取推荐项）：
  1. TG 发送结果记**插件本地数据**（`data.json` 的 `tgSent`），不写 `status.json`——保持 `status.json` 只描述浏览器填表四平台的语义。
  2. OD 任务**禁止**走一键发布自动代点；OD 强制只填草稿，发布由用户到平台手动点。
  3. `wechat.md` 仅 OD 生成，standard 任务永不生成；公众号永远只建文件、不入队、不被推送。
  4. 小红书配图**实际自动上传**（images 字段此前已预留）。
- 做法（与标准任务共用分发骨架，按类型分流）：
  1. `outbox.ts` 新增 `TaskType`、`STANDARD_STATUS_KEYS` / `OD_STATUS_KEYS` / `KNOWN_STATUS_KEYS` / `STATUS_KEY_LABELS`。`buildOutbox(type)` 按类型出文件；`writeOutbox(type)` 按类型写 status（OD 三 key）。`taskTypeFromPath`（领域 `od-exam` 推断 od）+ `readTaskType`（含 `wechat` key 即 od）做类型识别，**status.json 不写 type 字段**以保定制版格式兼容。
  2. `status.ts` 的 `parseStatus` 改为宽松：遍历实际 key，只保留白名单内且值合法的 key，未知 key / 非法值忽略（绝不抛错）；`statusLines` 按实际 key 渲染；`sourceDirsOf` 支持「任务夹 + 源目录」多基准解析图片。
  3. `images.ts` 的 `resolveImagePath` / `attachImages` 支持多基准目录（任务夹优先，兼容 OD 卡片图）。
  4. `settings.ts` + `tg.ts` + `settings-tab.ts`：TG 配置（token / chatId）存 `data.json`，不进 vault/git；`sendTgMessage` 走 Bot API，`/bot<token>/sendMessage`，Markdown 优先、失败降级纯文本重发一次、不连发；`markTgSent` / `readTgSent` 记发送结果。
  5. `commands.ts`：新增 **创建 OD 分发任务**（`registerOutboxOdCommand`，传 `"od"`）与 **发送到 TG 频道**（`registerSendTgCommand` + `TgConfirmModal` 确认）；`distributeActiveNote` / `publishActiveNote` 改为遍历任务实际 status key，skip `wechat`、排除 `tg`，OD 强制 `autoPlatforms=[]`。
- 涉及文件：`outbox.ts`、`status.ts`、`images.ts`、`settings.ts`、`tg.ts`、`settings-tab.ts`、`commands.ts`、`main.ts`、`ingest.ts`（领域加 `od-exam`），及对应测试（outbox / status / images / settings / tg / tg-command / distribute / commands / publish-all）。
- 与设计的差异：设计文档原写"status 初始 `generated` / wechat 零引用 / StatusJson 严格 4 key / images 已实际自动上传"等四处与代码不符，落地时以实际代码为准（status 初始即 `generated`、wechat 现在被 OD 生成、`status.json` 改为宽松白名单、images 已自动上传），并补齐了设计未明确的「TG 结果不写 status.json」等护栏。

### P2-D1 决策项：接本地 agent CLI 做文案生成/行内编辑

- 如果接，最小侵入方案：新增「生成平台文案」命令，spawn 本地 `claude`/`codex`/`opencode` CLI（仿 WeSight 的子进程模式），prompt 里带平台规则（字数/标题/话题），输出写进 outbox 草稿文件供人工 review。**默认关闭**，保留"无 LLM"的现网形态。
- 这会改变产品定位（从"分发管道"变成"分发+创作"），需要你拍板后再排期。

### P2-1 GitHub vault 同步 / P2-2 SecretStorage / P2-3 更新检查+CI

- 都是独立小项，互不依赖，可穿插排。

## 6. 我代码自身的工程质量问题（与 WeSight 无关）

| # | 问题 | 位置 | 建议 |
|---|---|---|---|
| 1 | 状态回流断链（见 P0-1） | background.ts / status.ts | ✅ 已加 /report 回传（fill/publish 两阶段 + failed 状态） |
| 2 | 图片全链路缺失（见 P0-2） | status.ts / fillers | ✅ base64 下发 + DataTransfer 上传（X/小红书） |
| 3 | 无平台字数/标题校验（见 P0-3） | publish-body.ts / outbox.ts | ✅ weightedLength + clampTitle + 截断提示 |
| 4 | wechat 死代码（filler+测试在，路由没有）；但 OD 任务已生成 `wechat.md` 仅作文件产物 | fillers/wechat.ts, background.ts, outbox.ts | ⚠️ OD 路径已用上 wechat（仅文件）；浏览器 filler 死代码仍待删 |
| 5 | bridgeToken 明文 data.json；扩展 token 明文 chrome.storage.local | main.ts / pairing.ts | 评估 SecretStorage 迁移 |
| 6 | 桥 CORS 是 `Access-Control-Allow-Origin: *` | bridge-server.ts | 127.0.0.1 + token 已是防线，但可收紧为仅扩展 origin |
| 7 | `/pending` 复用 `validatePush` 做 token 校验（传假 body） | bridge-server.ts handle() | 抽一个 `checkToken()`，可读性 |
| 8 | 平台元数据五处散落（PLATFORMS/CHOICES/COMPOSE_URLS/ACCOUNT_FIELDS/host_permissions） | outbox/status/fallback/settings/manifest | 抽 platforms.ts 注册表 |
| 9 | 版本号 0.1.0 无发布说明机制 | manifest.json | ⚠️ 部分：已 bump 0.2.0，release notes 机制仍未建 |
| 10 | 无 CI | .github/ | 加 pnpm test workflow |

## 7. 建议路线图（三轮）

**第一轮 · 闭环（把现有的用完）**：P0-1 状态回流 → P0-3 字数/标题校验 → P0-2 图片上传。做完之后，现有 4 平台才是"真的能用"。→ ✅ **已完成（2026-10-24，v0.2.0，另附赠 P1-0 一键发布自动发布，以及 P1-5 OD 精讲分发补强 + Telegram 通道）**

**第二轮 · 扩面**：P1-4 公众号决策 → P1-1 平台扩展（先抽注册表，再加微博/知乎/掘金）→ P1-2 每平台 shaping → P1-3 发布前预览。

**第三轮 · 决策与周边**：P2-D1 是否接 agent CLI（定位问题，单独议）→ GitHub 同步 / SecretStorage / 更新检查 / CI 按需穿插。

## 8. 明确不追的项（记录在案，避免反复）

- 会员体系、计费、云端分享、飞书、知识大脑重工程、AI 主题生成——商业插件的基础设施或重依赖外部服务的功能，与自用定位不符。
- WeSight 的发布中心扩展（zhihu/csdn/juejin/bilibili/toutiao/weibo/X Articles 一键多选）形态上比我们的"命令+弹窗"重，但其"标题/摘要/封面可编辑 + 导入本地 md"思想可吸收进 P1-3。
- WeSight"所有工作流停在可编辑草稿"的原则：2026-10-24 起改为**默认关闭的可选开关**（P1-0），不再作为不可动摇的约束记录在案。
