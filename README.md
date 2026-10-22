<div align="center">

# dsh-migra-clean

**把会话当文件来管：彻底删除 · 跨工作区迁移 · 拖拽直达**

<p>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="version" src="https://img.shields.io/badge/version-1.3.2-informational.svg">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg">
  <img alt="plugin" src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-8A2BE2.svg">
</p>

一个 [DeepSeek Harness](https://deepseek.com) 侧边栏插件：给会话补上原生缺失的两个动作——
**真正删干净**，以及**把会话搬到另一个工作区（连工作目录一起搬）**。

</div>

---

## 目录

- [为什么需要它](#为什么需要它)
- [功能](#功能)
- [安装](#安装)
- [使用](#使用)
- [行为语义](#行为语义)
- [HTTP 接口](#http-接口)
- [实现要点](#实现要点)
- [性能](#性能)
- [开发与测试](#开发与测试)
- [已知限制](#已知限制)
- [FAQ](#faq)
- [变更日志](#变更日志)
- [许可](#许可)

## 为什么需要它

Harness 的会话天然绑定工作区（工作目录）。日常会出现两类需求：

1. **这个会话不要了，我想让它从磁盘上彻底消失** —— 只从列表里藏起来不够，日志、缓存、索引、归属全是残留。
2. **这个会话开错地方了 / 项目搬家了，我要把它挪到别的工作区继续干** —— 而且挪完之后的命令与产物应该落在新工作区。

本插件把这两件事做成了一等公民操作，并保证**磁盘一致性**：搬得动、删得掉、失败能回滚。

## 功能

| 功能 | 说明 | 入口 |
|---|---|---|
| 🗑️ 彻底删除会话 | 会话目录 `rm -rf`、投影缓存、工作区列表、归属实体、索引表一次清干净；子会话级联删除 | 右键菜单 / 会话头部按钮 |
| 📁 跨工作区迁移 | 重写会话头 `cwd`、把日志目录物理搬进目标工作区的 sessions 分区、迁移归属、同步索引 | 右键菜单 / 会话头部按钮 / **拖拽** |
| 🖱️ 拖拽直达 | 会话行拖到工作区行即迁移；空白/归档会话走指针通道同样可拖 | 侧边栏 |
| 👀 迁移预览 | 弹窗底部实时显示「迁移后 cwd → 路径」，当前工作区标注「不变」 | 迁移弹窗 |
| 🔎 工作区搜索 | 弹窗内按名称/路径过滤，↑↓ 选择、Enter 确认、Esc 取消 | 迁移弹窗 |
| 🧯 失败回滚 | 归属挂载失败时把目录与 `cwd` 全部搬回原处，会话不会变成孤儿 | 自动 |
| 🧾 删除核验工具 | 给一个会话 id，逐项检查是否还有残留 | CLI |

## 安装

插件由「宿主半边」（`lib/index.js`）+「客户端半边」（`client.js`）组成，靠 `package.json` 里 `dsh.bundle.patch` 指向的 `cordis.patch.yml` 注册进 profile。

「装好了」= 两件事同时成立：

1. 包文件进了 `<profile>/node_modules/`
2. 包名出现在 `<profile>/package.json` 的 `dsh.profile.bundles` 数组里 ← **少了这步就是「装了但不挂载」**

> `DSH_HOME` 默认 `~/.dsh`，profile 目录是 `$DSH_HOME/profiles/<profile>`，桌面端一般叫 `desktop`。

### 方式一：让 AI 帮你装（新手推荐）

把下面整段复制给任意 AI 编程助手（Claude Code / Cursor / DeepSeek Harness 内的代理都可以）：

```text
请帮我安装 DeepSeek Harness 插件 dsh-migra-clean（GitHub: Cheney0819/dsh-migra-clean）。
按顺序执行，不确定时只做只读排查，不要删除任何既有文件：

1. 定位 profile：$DSH_HOME（默认 ~/.dsh）下的 profiles/<profile>，桌面端一般是 profiles/desktop；
   若存在多个 profile，列出候选先问我选哪个。
2. 安装包：在 profile 目录执行
   dsh plugin --profile <profile> add github:Cheney0819/dsh-migra-clean#v1.3.2
   若 dsh 不在 PATH，改用：pnpm add github:Cheney0819/dsh-migra-clean#v1.3.2；
   网络受限时：git clone 后 pnpm add file:/绝对路径。
3. 注册为 bundle：编辑 <profile>/package.json，把 "dsh-migra-clean" 追加进 dsh.profile.bundles
   （已存在则跳过），保证 JSON 合法、其他字段一个字节都别动。
4. 重启 DeepSeek Harness（宿主端代码没有热替换，必须重启才算生效）。
5. 验证：侧边栏任一会话上右键应出现「移动到其他工作区」「彻底删除会话」；
   把会话拖到另一个工作区应弹出确认弹窗。
6. 汇报：实际使用的 profile、安装规格、bundles 是否包含该包、验证结果；
   失败时贴出完整报错原文，不要自行删文件重装。
```

### 方式二：命令行安装（三条命令）

```bash
# 1) 装包（pin 到 tag 更稳；追新可用 main）
dsh plugin --profile desktop add github:Cheney0819/dsh-migra-clean#v1.3.2

# 2) 登记 bundle（漏了这步插件不会挂载）
node -e 'const fs=require("fs"),p=process.env.HOME+"/.dsh/profiles/desktop/package.json";const d=JSON.parse(fs.readFileSync(p,"utf8"));d.dsh??={};d.dsh.profile??={};const b=d.dsh.profile.bundles??=[];if(!b.includes("dsh-migra-clean"))b.push("dsh-migra-clean");fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");console.log("bundles:",b.join(", "));'

# 3) 重启 DeepSeek Harness
```

`dsh plugin` 会把参数原样转发给 pnpm，因此下面这些规格都能用：

| 规格 | 示例 |
|---|---|
| GitHub 简写 | `github:Cheney0819/dsh-migra-clean#v1.3.2` |
| Git URL | `git+https://github.com/Cheney0819/dsh-migra-clean.git` |
| 远程 tarball | `https://github.com/Cheney0819/dsh-migra-clean/archive/refs/tags/v1.3.2.tar.gz` |
| 本地目录（开发用，软链进去） | `file:/Users/me/code/dsh-migra-clean` |

### 方式三：手动拷目录（离线可用）

```bash
git clone https://github.com/Cheney0819/dsh-migra-clean.git
cp -r dsh-migra-clean "$DSH_HOME/profiles/desktop/node_modules/"
```

再手工把这两处写进 `$DSH_HOME/profiles/desktop/package.json`：

```jsonc
{
  "dependencies": { "dsh-migra-clean": "file:/absolute/path/to/dsh-migra-clean" },
  "dsh": { "profile": { "bundles": ["dsh-migra-clean"] } }
}
```

### 生效方式

| 改动涉及 | 生效方式 |
|---|---|
| `client.js`（界面/菜单/拖拽/弹窗） | 刷新页面即可；宿主 HMR 通常直接推送 |
| `lib/index.js`（删除/迁移/接口） | **必须重启 DeepSeek Harness**（Node 半边没有热替换） |

### 怎么确认真的装好了

```text
客户端半边  → 侧边栏会话右键出现「移动到其他工作区」「彻底删除会话」
宿主半边    → $DSH_HOME/logs 里出现 [dsh-migra-clean] 前缀的日志
两者都不出现 → 九成是 dsh.profile.bundles 里没登记，或被别的 profile 抢了 cwd
```

### 卸载

```bash
dsh plugin --profile desktop remove dsh-migra-clean
# 再从 package.json 的 dsh.profile.bundles 里删掉 "dsh-migra-clean"
```

> 卸载只影响插件本身：已经迁移过的会话留在新工作区，日志和 `cwd` 不回滚。

## 使用

### 右键菜单

在侧边栏任意会话行上点 `⋯`：

```text
📌 固定
✏️ 重命名
🌿 分叉
📦 归档
──────────────
📁 移动到工作区…
🗑️ 彻底删除会话
```

### 拖拽

```text
侧边栏
├── 工作区 A
│   └── 会话 a-1        ──┐  拖到工作区 B 的标题行
└── 工作区 B            ◀─┘  → 会话 a-1 迁移到 B，cwd 一并更新
    └── 会话 b-1
```

- 悬停目标工作区会高亮；落在当前工作区会提示「无需迁移」并跳过。
- 迁移期间左侧列表会立即反馈，不等刷新。

### 迁移弹窗

```text
┌──────────────────────────────────────────────┐
│ 📁 移动到其他工作区                       ✕  │
│ 会话：「Refactor auth middleware」            │
│ [当前目录 /home/dev/projects/acme-web]        │
│ [所在工作区 acme-web]                         │
│ ┌──────────────────────────────────────────┐ │
│ │ 🔍 搜索工作区名称或路径…                 │ │
│ ├──────────────────────────────────────────┤ │
│ │ acme-web   当前   1 会话                 │ │
│ │ /home/dev/projects/acme-web              │ │
│ │ design-system     3 会话                 │ │
│ │ /home/dev/projects/design-system         │ │
│ └──────────────────────────────────────────┘ │
│ ┌─ 迁移后 cwd → /home/dev/projects/design-…┐ │
│ │ 此后命令与产物都落在上面这个目录；        │ │
│ │ 旧产物留在原处，日志会搬入该工作区。      │ │
│ └──────────────────────────────────────────┘ │
│                          [ 取消 ] [ 确认移动 ]│
└──────────────────────────────────────────────┘
```

## 行为语义

### 迁移做了什么

| 步骤 | 具体动作 |
|---|---|
| 1. 静默 | 先停会话：取消运行中的 agent、`flush` 日志、关闭打开的文件句柄 |
| 2. 校验 | 目标工作区存在且目录真实存在；`header.cwd` 用目标实体自己的 `record.path` 严格比较 |
| 3. 搬目录 | 会话目录从旧项目分区物理移动到目标项目分区（含子会话，若原本同属一个工作区） |
| 4. 改头部 | 重写会话日志第一帧的 `header.cwd`（zstd 帧头原地改写 + 往返校验） |
| 5. 迁归属 | 经原生 `WorkspaceEntity.detachSession/attachSession` 迁移；重建头索引 |
| 6. 同步索引 | 更新会话索引表里的 `cwd`；丢弃旧的日志解析缓存 |
| 7. 广播 | 补发会话事件，让侧边栏立刻显示到新分组 |

### 迁移不做什么

- ❌ 不动目标工作区里已存在的文件，也不动旧工作区里已经产生的产物
- ❌ 不改动历史消息内容（只改 `cwd` 这一项元数据）
- ❌ 不迁移正在运行的子进程的工作目录（新起的命令才用新路径）
- ❌ 不允许把会话迁进「路径已不存在」的工作区（会直接拒绝）

### 删除做了什么

| 位置 | 动作 |
|---|---|
| `~/.dsh/sessions/<project>/<id>/` | 整目录删除（`.jsonl.zstd` + `.lock`） |
| `~/.dsh/storages/session_projcache/sessions/<id>.json` | 删除 |
| 投影缓存服务表 | 移除该 id 的条目 |
| `~/.dsh/storages/workspace.json` | 从各工作区 `sessionIds` 中剔除 |
| 内存工作区实体 | `detachSession` |
| 会话索引表 | 删除 `persisted_sessions` / `temp.live_sessions` 中的行 |
| 子会话（`origin=subagent`） | 级联删除 |

**不删**：`~/.dsh/attachments/**` 是内容寻址的共享对象（多个会话可能引用同一份），删会话不动对象；第三方插件自己的账本（例如成本统计）不在本插件职责内。

想自己核对？用内置核验工具：

```bash
npm run verify session-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# ✅ 未发现残留   /   ❌ 发现 N 处残留（逐条列出位置）
```

## HTTP 接口

所有接口走宿主本地 API，需要宿主会话鉴权。

| 方法 | 路径 | 参数 | 说明 |
|---|---|---|---|
| `POST` | `/api/dsh-migra-clean` | `{ "sessionId": "session-…" }` | 彻底删除会话 |
| `GET` | `/api/dsh-migra-clean/workspaces` | `?sessionId=`（可选） | 工作区列表；带 `sessionId` 时附带该会话归属 |
| `GET` | `/api/dsh-migra-clean/info` | `?sessionId=` | 会话概要（标题、`cwd`、所在工作区、候选目标） |
| `POST` | `/api/dsh-migra-clean/move` | `{ "sessionId": "…", "targetWorkspaceId": "…" }` | 迁移会话到目标工作区 |

## 实现要点

| 点 | 做法 |
|---|---|
| 会话日志是 zstd 分帧流 | 自己走帧（magic `0x4247762216`），只解压首帧拿 `header`，改写 `cwd` 后用同样的窗口参数重压，并做往返校验 |
| 归属不能直接改数组 | 必须走 `WorkspaceEntity.detachSession/attachSession`，否则原生实体与磁盘不一致 |
| 挂载会校验 `cwd` | `attachSession` 要求 `header.cwd` 与实体 `record.path` 严格相等且目录存在，所以**先搬迁再挂载** |
| 事件会自相矛盾 | 停会话会触发 `session/disposed` → 宿主广播 `api-session/removed`；迁移完成后需要**补发** `api-session/added`，并在短时间内监听 `disposed` 再补一次，保证顺序 |
| 原子写 | 临时文件 + `rename`，崩溃不会留下半个日志 |
| 失败可回滚 | 目录、`cwd`、归属三者一起回滚，避免孤儿会话 |
| 前端不碰宿主 DOM 结构 | 只通过 Slot 插入自己的 UI；样式只用主题 token，浅色/深色自适应 |

## 性能

索引扫描（`indexSessionDirs`）在 2000 条合成会话、20 个项目目录下的对比（`npm run bench` 默认夹具）：

| 场景 | 耗时 | 相对基线 |
|---|---|---|
| 全量遍历 + 逐会话读头（旧实现） | 约 30–130 ms（随磁盘缓存波动） | 1× |
| 冷路径（首次查询，建立 5s 缓存） | 约 2–11 ms | 15×–60× |
| 稳态（缓存命中） | 约 0.01 ms | 3000× 量级 |

实现：会话索引 5s TTL + header 按 `stat` 指纹缓存、归属查询 30s 缓存、拖拽高亮用 `requestAnimationFrame` 合帧。

> 数字来自本仓库 `npm run bench`（合成数据，不含真实磁盘 I/O 抖动），仅用于对比优化前后。

## 开发与测试

```bash
npm test        # 拖拽/迁移语义回归（无头 Chrome，10 条断言）
npm run bench   # 索引性能基准
npm run verify  # 删除残留核验（需传 sessionId）
```

- `test/drag.test.html` 是一个可独立打开的测试页，模拟宿主侧边栏结构，验证两条拖拽通道、点击吞噬、归属缓存命中。
- `test/run.mjs` 用无头浏览器跑断言，退出码非 0 即失败。
- `scripts/verify-clean.mjs` 检查指定会话在各存储位置的残留（附件按设计共享，不判定）。

## 已知限制

- **不上架 npm registry**：安装走 `github:` / Git URL / tarball / 本地目录规格（宿主插件需要 `cordis.patch.yml` 与 `dsh.client.inject` 声明才能被装配），因此包本身不发布到 npm。
- 迁移会**先停会话**，长任务跑到一半时会被中断（这是为了保证日志一致）。
- 归档会话、空白会话在原生拖拽里不可拖，本插件用指针通道兜底；但落在「当前工作区」依旧会拒绝。
- 删除不清理第三方插件自建的账本数据。
- 客户端改动的热更新依赖宿主 HMR；若加载失败过一次，浏览器会拒绝再次执行同一 bundle，需要刷新页面。

## FAQ

<details>
<summary>会话掉进「未分组」怎么办？</summary>

宿主在重启重扫时会校验会话 `header.cwd` 是否存在，不存在就把它从工作区名册里剔除（`invalidSessionPaths`），于是落到「未分组」。

修复：新增一个指向真实目录的工作区，然后用本插件把会话迁过去——`cwd` 会被重写成有效路径并重新挂载。
</details>

<details>
<summary>为什么有时候要重启、有时候只要刷新？</summary>

`client.js` 属于网页半边，HMR 能热替换；`lib/index.js` 属于 Node 半边，没有热替换，必须重启宿主。
</details>

<details>
<summary>迁移后新建的文件落在哪？</summary>

落在新工作区。工具解析工作目录用的是会话头的 `cwd`（例如 bash 工具读 `session.header.cwd`），迁移已经把这一项改成目标路径。旧工作区里已有的文件不会跟着搬。
</details>

<details>
<summary>为什么删了会话，附件目录还有东西？</summary>

`~/.dsh/attachments` 是按内容哈希寻址的共享对象库，同一张图可能被多个会话引用，删会话不能删对象。会话日志删除后，这些对象自然成为无引用垃圾，可按需自行清理。
</details>

## 变更日志

| 版本 | 变化 |
|---|---|
| **1.3.2** | 安装文档重写：AI 一条指令 / 命令行三条命令 / 手动拷目录三种方式，修正 bundle 登记路径为 `dsh.profile.bundles` |
| 1.3.1 | 内部命名收官：插件名、临时文件前缀、CSS 类名、`data-*`、插槽 id 全部统一；样式表版本化避免旧规则残留 |
| 1.3.0 | 更名 `dsh-migra-clean`，包名/路由/前缀/文档同步 |
| 1.2.9 | 去掉弹窗顶部色条 |
| 1.2.8 | 浅色主题下灰底块改为透明发丝边框 |
| 1.2.7 | 弹窗标题三级兜底，不再出现「未命名」 |
| 1.2.6 | 性能：索引/归属缓存、拖拽合帧；补齐测试与基准 |
| 1.2.4 | 迁移预览（cwd 目标路径）、修悬停抖动 |
| 1.2.3 | 客户端初始化异常自保，异常时降级为空壳而不是让宿主启动失败 |
| 1.2.2 | 拖拽直达（HTML5 通道 + 指针通道） |
| 1.2.1 | 修复「移动后会话从侧边栏消失」与「迁移弹窗无样式」 |
| 1.0.0 | 首个版本：彻底删除 + 跨工作区迁移 |

## 许可

[MIT](LICENSE)
