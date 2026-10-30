# BUG 档案（已修复 / 已知问题 / 防复发红线）

> 目的：把踩过的坑连根记下来，避免同一个坑踩第二次。
> 用法：改代码前先扫第三节「编码红线」；改完跑第四节对应的回归测试。
> 维护规则：
> 1. 每修一个 bug，必须在本文件加一条 `BUG-0xx`（哪怕只有一行）。
> 2. 「教训」必须写成可执行的红线（命令、检查项、禁止事项），不写空话。
> 3. 修复必须有回归用例；没有自动化用例的，写明手工复现步骤。
> 4. 条目只增不改；判断变化用「后续」标注，保留历史认知。

---

## 一、已修复

| 编号 | 版本 | 现象（用户视角） | 根因一句话 |
|---|---|---|---|
| BUG-001 | 1.3.5 / 1.3.7 | 改**别的插件**时，本插件弹窗/菜单突然全无样式（遮罩没了、按钮变原生） | 宿主 HMR 按 `data-plugin` 认领并回收 `<style>`，本插件样式表「无主」被别的插件认走、随其热更被删除 |
| BUG-002 | 1.3.7 | 鼠标停在迁移弹窗「翻译 X」与下一行之间，列表疯狂抽搐 | 悬停切换预览态导致弹窗高度变化，列表上下平移，指针在行交界处来回命中相邻行 |
| BUG-003 | 1.3.8 | 迁移一个会话，整个页面刷新，正在看的别的会话被抢走 | 迁移完成后走了整页 reload，而不是原地重挂被迁移会话的主视图 |
| BUG-004 | 1.3.8 | 大日志会话迁移时子会话漏搬；回滚拿不到原 `cwd` | 首帧 >64KB 时会话头解析失败（只读单帧），读不到 `cwd`/子会话关系 |
| BUG-005 | 1.3.8 | 迁移后会话里丢了一些事件/消息 | 改写首帧写 `cwd` 时整帧重写，吃掉了首帧里打包的其它事件 |
| BUG-006 | 1.3.8 | 迁移失败回滚后，子会话变孤儿 | 回滚只挂回父会话，未递归挂回子会话树 |
| BUG-007 | 1.3.8 | 偶发工作区索引错乱/会话丢失 | 迁移时手写整篇 `workspace.json`，与宿主重扫冲突（整篇重写竞态） |
| BUG-008 | 1.3.9 | 删掉的会话，宿主下次启动又「复活」 | 删除先扫盘后 quiesce：刚建/刚写过的目录不在索引里被静默漏删 |
| BUG-009 | 1.3.9 | 迁移刚聊过的会话报「未找到磁盘日志」 | 迁移走了 2s TTL 缓存，未落盘的活会话不在索引里；且未预落盘 |
| BUG-010 | 1.4.0 | 超大日志会话一打开就 OOM / 卡死 | Zstd 全量解压整帧扫描；无轻量探头、无单帧短路 |
| BUG-011 | 1.4.0 | 右键不弹菜单，或要连点多次才出 | 触控板惯性微滚动 + HoverCard 遮挡吞掉了右键事件 |
| BUG-012 | 1.4.0 | 迁移弹窗滑过「当前」行时边界抽搐（104px 死死锁住的变体） | 预览块绝对高度死锁 + 悬停态切换组合出的布局抖动 |
| BUG-013 | 1.4.0 | 删除当前正在看的会话后，主视图残留/报错 | 删除后未解绑主视图与相关缓存引用 |
| BUG-014 | 1.4.2 | 迁移失败后接口说「已自动回滚」，但会话 header 的 `cwd` 仍指向目标，会话打不开 | 先 `rewriteSessionCwd` 后 `safeMoveDir`，只有 move 成功才登记回滚，改写成功的条目漏回滚 |
| BUG-015 | 1.4.2 | 迁移失败后文件已回源目录，但工作区列表里会话消失/挂不回源工作区 | 回滚复用 `syncHeaderIndex` 的目标 cwd 闭包，registry header 索引被写成目标路径 |
| BUG-016 | 1.4.2 | 删除失败（目录权限、投影缓存、registry 操作失败）仍返回「彻底删除成功」 | `rmSync` 与各处清理错误只 `console.warn`，API handler 固定返回 200 |
| BUG-017 | 1.4.2 | 子会话仍在运行时，父会话删除/迁移把子会话日志一起删/搬 | 子会话 quiesce 异常被吞掉后继续进入物理文件操作 |
| BUG-018 | 1.4.2 | 迁移刚聊过的会话可能丢最后几条事件，或在 agent 仍在写时搬文件 | `sessions.flush`/`openHandles.close` 异常被吞，agent 等待超时后未再次检查状态 |
| BUG-019 | 1.4.2 | 自定义 sessionId（含 `~`、空格、Unicode）删除返回成功但目录还在 | 目录索引存的是宿主 `encodeSegment` 后的名字，查找却只用原始 id |
| BUG-020 | 1.4.2 | 拖过工作区 B 再滑到当前工作区/空白处松手，会话被错误迁移到 B | 落点优先使用上一次高亮的 `targetId`，移出目标时没有清空 |
| BUG-021 | 1.4.2 | `/info`、`/workspaces` 的 title 永远为空，迁移弹窗偶尔显示「未命名会话」 | `title` 在 DSH 中是 projection，不是 `SessionHeader` 字段 |
| BUG-022 | 1.4.2 | 正在看子智能体会话时迁移/删除父会话，子会话视图卡死/残留 | 只比较精确 sessionId，未沿 `subagentAddress` 父链判断当前视图 |
| BUG-023 | 1.4.2 | 多次迁移后 `session/disposed` 监听器累积，内存持续增长 | Cordis 的 `ctx.on` 返回 disposer，代码却调用不存在的 `ctx.off` |
| BUG-024 | 1.4.2 | 搜索工作区后立刻按 Enter，偶尔迁到另一个工作区 | `active` 是过滤后数组索引，`setActive` 异步生效，Enter 用了旧索引 |
| BUG-025 | 1.4.2 | 迁移后投影缓存可能被旧 write-behind 覆盖，文件权限从 0600 变 0644 | `table.update` 后再次直接 `fs.writeFileSync`，绕过宿主写链 |
| BUG-026 | 1.4.2 | 目标工作区目录被删后迁移「成功」，会话被挂到新建的空目录 | 代码 `mkdirSync(targetPath)` 与 README 的「目录不存在拒绝」冲突 |
| BUG-027 | 1.4.2 | 迁移几 GB 会话日志时内存暴涨/事件循环卡死 | `rewriteSessionCwd` 仍整文件读入并 `Buffer.concat`，只应流式复制首帧之后的尾部 |
| BUG-028 | 1.4.2 | 迁移遇到目标项目已有同名会话目录时，直接删掉目标目录，可能误删另一个会话 | 迁移前无条件 `rmSync(dest)`，没有把目录名冲突当作错误 |

### BUG-001 宿主 HMR 连坐删除本插件样式表

- 触发：安装多个插件，改任意**其它**插件的代码（其 client 被 HMR 重建）。
- 根因：`dsh-client-modules` 的 `claimStyles(id)` 会把页面上**所有没有 `data-plugin` 属性的 `<style>`** 认领给「下一个被 materialize 的模块」；`removeOwnedStyles(id)` 在该模块热更替换时删除 `style[data-plugin=<id>]`。本插件样式表只带 `data-dsh-migra-clean-css`、没有 `data-plugin`，于是被别的插件认走、随其热更被删；`OverlayHost` 的 `ensureStyles` 只在挂载时跑一次，没人补建 → 弹窗裸奔。
- 修复：① 1.3.5 每次求值用随机 uid 隔离样式表实例（防旧实例 cleanup 删新实例）；② 1.3.7 样式表创建时打 `data-plugin="dsh-migra-clean"` 归属，并在 `OverlayHost` 每次渲染时幂等 `ensureStyles()` 自愈。
- 回归：手工——改其它插件 2 次以上，打开迁移弹窗/右键菜单，样式须完好；刷新后仍正常。
- 教训：**任何注入的 `<style>` 必须打 `data-plugin=<包名>`；样式表创建/补建只能在插件自己名下，且要有「每个渲染周期幂等自愈」的兜底。**

### BUG-002 / BUG-012 弹窗 hover 边界抽搐

- 触发：鼠标停在列表两行交界处（尤其「可选行 vs 当前行」之间）。
- 根因：`onMouseEnter → setActive` 使预览块在「就绪态（cwd 行 + 说明）」与「当前态（仅一句说明）」之间换内容，两态高度差约 20px；弹窗垂直居中 → 整个列表上下平移 → 指针落点跳到相邻行 → 再触发 `setActive` → 死循环。
- 修复：① 预览块 `box-sizing:border-box; height:100px; min-height:100px; max-height:100px` 锁死三态同高；② 悬停不切到「当前」行（`if (!isCurrent) setActive(index)`）；③ 键盘导航才 `scrollIntoView`（1.4.0 又出现 104px 死锁变体，改为锁高度 + 居中布局并排修）。
- 回归：手工——指针在两行交界、当前行上下往复滑动，列表不得位移；键盘 ↑↓ 仍能选中并滚动到视口。
- 教训：**任何 hover/选中态不得改变其后内容的布局尺寸；相邻可交互行之间禁止出现「高度交换」；滚动只允许键盘导航触发。**

### BUG-003 迁移后整页刷新

- 根因：迁移完成后直接 `location.reload()`，把用户其它会话视图一起冲掉。
- 修复：改为原地重挂被迁移会话的主视图（仅当该会话正在被查看时），其它会话不动。
- 回归：`test/run.mjs`「主视图原地重挂」断言。
- 教训：**刷新是最后手段；UI 状态变更优先原地 reconcile。**

### BUG-004 / BUG-005 首帧读写

- 根因：会话日志是 Zstd 多帧格式，首帧可能 >64KB 且打包了多条事件；旧实现只读单帧、写 `cwd` 时整帧覆盖重写。
- 修复：多帧扫描 + 首帧独立解析；改 `cwd` 只做字段级就地改写，保留其它事件。
- 回归：`test/header.mjs`（Zstd 多帧 / >64KB 超大首帧 / 纯文本 jsonl 改首行 / `projectKey` 路径编码，26 条断言）。
- 教训：**读写会话头必须假定「多帧 + 大首帧 + 打包事件」；任何改写都要保真其余字段。**

### BUG-006 / BUG-007 回滚与 workspace.json

- 根因：回滚只挂父会话；迁移手写整篇 `workspace.json` 与宿主重扫竞态。
- 修复：回滚递归覆盖子会话树；不再手写 `workspace.json`，仅在拿不到 registry 时兜底写。
- 回归：`test/delete.mjs` + `test/header.mjs` 相关断言；手工迁移含子代理的会话后断开目标目录验证回滚。
- 教训：**回滚必须覆盖整棵会话树；`workspace.json` 不是我们的写入目标。**

### BUG-008 / BUG-009 磁盘状态新鲜度

- 根因：删除/迁移都用了带 TTL 的索引缓存，而刚建/刚写的目录还没进索引；删除还先扫盘后 quiesce。
- 修复：先 quiesce 落盘 → 强制重扫（绕过 TTL）→ 再执行；迁移对未落盘的活会话预落盘一次。
- 回归：`test/delete.mjs`（磁盘清空、空目录回收、投影缓存销毁、索引剔除、幂等删除，15 条断言）。
- 教训：**凡涉及磁盘真实状态的操作，禁止信任 TTL 缓存；顺序永远是「先落盘、再重扫、后动手」。**

### BUG-010 大日志 OOM

- 根因：Zstd 全量解压整帧扫描。
- 修复：单帧短路扫描 + 纯文本 jsonl 窗口轻量探头 + 原生单会话 O(1) `indexHeader`。
- 回归：`npm run bench` + 超大日志手工样例。
- 教训：**大文件禁止全量解压；先探针、再短路、最后才全量。**

### BUG-011 右键菜单被吞

- 根因：触控板惯性微滚动 + HoverCard 遮挡，右键事件落到浮层上。
- 修复：捕获阶段接管 + 惯性滚动判定 + 遮挡穿透处理。
- 回归：`test/drag.test.html` 中「点击吞噬防误触」相关断言 + 手工触控板滑动。
- 教训：**捕获阶段处理指针事件；任何浮层都要考虑它会不会挡住下层命中。**

### BUG-013 删除后引用未释放

- 根因：删除会话后主视图仍持有该会话引用与派生缓存。
- 修复：删除成功后解绑主视图、清理缓存。
- 回归：`test/delete.mjs` 断言 + 手工删除当前会话。
- 教训：**删除/迁移是「资源释放」事件，必须同步清理所有引用与缓存。**

### BUG-014 / BUG-015 迁移失败回滚不完整

- 根因：① `rewriteSessionCwd` 成功后只有 `safeMoveDir` 成功才登记回滚，rename 失败时当前条目漏回滚；② attach 失败回滚复用 `syncHeaderIndex` 的目标 cwd 闭包，文件回源但 registry header 仍指向目标。
- 修复：每条迁移先登记事务（`cwdChanged/moved/previousCwd`），失败逆序恢复所有已处理条目；`syncHeaderIndex(dirOf, cwdOf)` 支持回滚时按源目录与 `originalCwd` 重建，并在回滚后重新挂回源实体。
- 回归：`test/move.mjs` 覆盖正常迁移、rename 失败、attach 失败、目标目录缺失。
- 教训：**跨文件/元数据的迁移必须有显式事务；回滚索引必须从真实回滚后的磁盘状态重建，不能复用目标路径常量。**

### BUG-016 / BUG-017 删除部分失败被吞

- 根因：`rmSync`、投影缓存、registry、sessionQuery 的错误只 warn；子会话 quiesce 失败后仍进入物理删除。
- 修复：删除流程收集 `failures`，任一失败返回 `ok:false`；子会话 quiesce 失败立即中止且不删除任何目录。
- 回归：`test/delete.mjs` 新增自定义 ID、不可写目录用例；`test/move.mjs` 覆盖子会话失败路径。
- 教训：**「彻底删除」必须以磁盘实际结果为准；失败不能伪装成功，子会话未停稳前禁止动父/子目录。**

### BUG-018 quiesce 没有真正保证落盘与停止

- 根因：`sessions.flush`、`openHandles.close` 异常被吞；agent 等待 1.5s 后未再次检查状态。
- 修复：flush/句柄关闭失败直接抛错；等待结束仍 `running` 直接中止迁移/删除。
- 回归：`test/move.mjs` 的迁移失败路径；后续可补 fake flush 抛错用例。
- 教训：**迁移前必须证明「日志已落盘、写入句柄已关闭、agent 已停」，三者缺一不可。**

### BUG-019 sessionId 路径编码

- 根因：`indexSessionDirs` 的 key 是宿主 `encodeSegment(id)` 后的目录名，后续却用 raw id 查。
- 修复：插件内实现与宿主一致的 `encodeSegment`（含 `.`/`..` 特判），所有目录查找走 `sessionDirs()`（raw + encoded 双查）。
- 回归：`test/delete.mjs` 的 `a~b` 用例；`verify-clean.mjs` 同步修正特殊编码。
- 教训：**sessionId 不是路径安全的，宿主怎么编码目录，插件就必须用同一套规则查找。**

### BUG-020 拖拽过期落点

- 根因：`setDropTarget` 在当前工作区/空目标时不清 `targetId`，`onDropCapture` 优先用旧 `targetId`。
- 修复：新增 `clearDropTarget()`；移出工作区、移到当前工作区都清空；drop/pointerup 只信实际 `event.target` 命中的工作区。
- 回归：`test/drag.test.html` 新增「悬停 B → 移 A/空白 → drop 不迁移」断言。
- 教训：**高亮状态可以缓存，落点判定绝对不能缓存。**

### BUG-021 标题字段取错来源

- 根因：DSH `SessionHeader` 没有 `title`，标题是 `sessionProjections` 的 `title` 投影。
- 修复：`sessionTitleOf()` 优先读 `sessionProjections.snapshot(live, ["title"])`，冷会话读 `sessionProjectionCache.cachedSnapshot/cachedPredecessorTitle`，保留旧 header 字段兜底。
- 回归：`test/move.mjs` 的 `sessionTitleOf` projection 断言；真实会话再手工核对 `/info`。
- 教训：**DSH 的 header 是存储元数据，标题/列表字段是 projection，不能混用。**

### BUG-022 子智能体主视图未处理

- 根因：`currentMainSessionId() !== sessionId` 只比较精确 ID，正在看子会话时父会话迁移/删除不会重挂或清空。
- 修复：新增 `currentMainDescendsFrom()` 沿 `subagentAddress` 父链判断；迁移重挂当前子会话，删除时清理子树视图。
- 回归：手工「打开子会话 → 删除/迁移父会话」；后续补客户端用例。
- 教训：**会话树操作必须考虑当前视图是子孙节点的情形。**

### BUG-023 `ctx.off` 监听器泄漏

- 根因：Cordis 4 的 `ctx.on` 返回 disposer，没有 `ctx.off`；`ctx.off?.()` 永远不执行。
- 修复：捕获 `ctx.on` 返回的 disposer，`stopWatching` 调用它。
- 回归：`test/move.mjs` 覆盖多次迁移不抛异常；后续可加 listener 计数断言。
- 教训：**事件监听的生命周期以 `ctx.on` 返回值为准，不能假设有 `off`。**

### BUG-024 MoveDialog Enter 使用旧索引

- 根因：`filtered` 变化后 `setActive` 异步生效，Enter 直接 `move()` 读取旧 `filtered[active]`。
- 修复：Enter 时优先使用当前有效选中项，否则取过滤后的第一个非当前工作区；按键操作不再依赖可能滞后的索引。
- 回归：`test/drag.test.html` 可扩展搜索后 Enter 场景；当前以代码审查和手工验证为主。
- 教训：**列表过滤后的索引不是稳定身份，用户动作必须按当前数据重新求目标。**

### BUG-025 投影缓存绕过宿主写链

- 根因：`table.update` 后又 `fs.writeFileSync` 直接改 per-record 文件，绕过写链且默认权限 0644。
- 修复：有 `sessionProjectionCache.table` 时只走 table.update；无 table 的旧宿主才用 `writeFileAtomic` 兜底并保留 mode/换行。
- 回归：`test/move.mjs` 正常迁移；真实宿主手工迁移后检查投影缓存 mtime/权限。
- 教训：**derived cache 也必须走宿主写入口；直接改文件会和 write-behind/权限策略打架。**

### BUG-026 目标目录缺失自动创建

- 根因：代码 `mkdirSync(targetPath, {recursive:true})` 与 README「目录不存在拒绝」相反。
- 修复：迁移前 `statSync(targetPath).isDirectory()`，不存在/不是目录直接拒绝，不创建用户工作区目录。
- 回归：`test/move.mjs`「目标目录缺失」用例。
- 教训：**用户工作区路径是外部事实，插件只能校验，不能替用户创建一个空项目目录。**

### BUG-027 大日志改写仍是整文件内存操作

- 根因：`rewriteSessionCwd` 对压缩日志 `readFileSync` + 全帧扫描 + `Buffer.concat`；纯文本也整文件读。
- 修复：新增 `scanZstdFramesFromFile` 只读帧头定位；`writeFileAtomicFromFile` 写新首帧后按 1MiB 块复制尾部；纯文本只读首行再复制尾部。
- 回归：`test/header.mjs` 覆盖多帧/大首帧/纯文本；后续补数 GB 稀疏文件内存峰值测试。
- 教训：**大日志的「写」也必须和「读」一样先定位边界、流式复制，禁止把整个文件作为内存中转。**

### BUG-028 同名目标目录误覆盖

- 根因：迁移前 `if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })`，把重复 ID / 上次中断残留直接删掉。
- 修复：目标目录已存在时直接中止并保留现场，不再删除目标目录；`safeMoveDir` 的 EXDEV 分支也先复制到 staging 再原子 rename，避免半截目标。
- 回归：`test/move.mjs` 的正常/失败路径；重复 ID 场景由目标目录检查拒绝。
- 教训：**迁移只允许写自己的目标；目标已存在先报错，绝不 rm -rf 另一个会话目录。**

---

## 二、已知问题（尚未修复 / 明确不修）

| 项 | 性质 | 说明 |
|---|---|---|
| 迁移会先停会话 | 设计取舍 | 长任务跑到一半会被中断，为保证日志一致；不打算改。 |
| HMR 失败一次后同 bundle 不再执行 | 宿主行为 | 浏览器拒绝重复执行同一 bundle，需刷新页面；我们只能提示，不能绕过。 |
| 删除不清理第三方插件自建账本 | 边界 | 只清本插件与宿主标准存储；第三方账本归第三方。 |
| 不上架 npm registry | 发布限制 | 需 `cordis.patch.yml` 与 `dsh.client.inject` 装配，走 `github:` / tarball / 本地目录。 |
| 归档/空白会话拖到「当前工作区」被拒 | 设计 | 同名工作区迁移无意义，直接拒绝。 |
| 预览块固定 100px 高度 | 已知代价 | 三态同高的代价是当前态底部有留白；换取零抖动，接受。 |

> 判断口径：**「设计取舍/宿主行为」不进 bug 列表**，只登记在案避免被误当缺陷反复排查。

---

## 三、编码红线（改代码前逐条对）

1. 注入的 `<style>` 必须 `data-plugin="dsh-migra-clean"`，并保留「每渲染周期幂等 ensureStyles」自愈。→ BUG-001
2. hover / 选中态不得改变布局尺寸；相邻行之间禁止高度交换。→ BUG-002/012
3. `scrollIntoView` 只允许键盘导航触发，hover 一律禁止。→ BUG-002/012
4. 磁盘状态操作顺序固定：quiesce 落盘 → 强制重扫（绕过 TTL）→ 执行。→ BUG-008/009
5. 会话头读写必须支持 Zstd 多帧、>64KB 首帧、纯文本 jsonl；改字段不得覆盖整帧其它事件。→ BUG-004/005
6. 不写 `workspace.json`；registry 不可用才兜底。→ BUG-007
7. 迁移/删除必须有显式事务回滚，覆盖 cwd、目录、registry header 索引和整棵子会话树。→ BUG-006/014/015
8. 目录搬运跨盘要处理 `EXDEV`：先写后删、fsync/校验，失败逆序回滚。→ 1.4.0
9. 删除/迁移后必须解绑主视图与缓存引用；当前视图是子智能体时要沿父链判断。→ BUG-013/022
10. 大文件先探针/短路，禁止全量解压；读写两条路径都要流式。→ BUG-010/027
11. 删除/迁移前必须证明 flush 成功、写句柄关闭、agent 已停止；子会话 quiesce 失败必须中止。→ BUG-017/018
12. 删除/迁移的清理失败必须向上返回，不能把 partial failure 伪装成成功。→ BUG-016
13. sessionId 目录查找必须使用宿主 `encodeSegment` 规则（含 `.`/`..` 特判）。→ BUG-019
14. 拖拽落点只能信 drop 事件实际命中的工作区，不能复用旧 `targetId`。→ BUG-020
15. 标题/列表字段必须从 DSH projection 读取，不能假设 `SessionHeader.title`。→ BUG-021
16. 视觉改动不得触碰核心逻辑路径（1.4.1 实践）。
17. 每次改动跑第四节对应测试；新增 bug 修复必须补一条 BUG 记录。

---

## 四、回归测试索引

| 改动区域 | 必跑 | 断言数 |
|---|---|---|
| 拖拽 / 点击吞噬 / 过期落点 / 主视图重挂 | `npm test`（含 `test/run.mjs` + `test/drag.test.html`） | 16 |
| 会话头读写（zstd / >8MB 大首帧 / 纯文本 / projectKey） | `test/header.mjs` | 26 |
| 彻底删除 / 索引新鲜度 / 投影缓存 / 自定义 ID / 失败上报 | `test/delete.mjs` | 15 |
| 迁移事务 / 回滚 / 目标目录校验 | `test/move.mjs` | 20 |
| 索引性能 | `npm run bench` | 冷热对比 |
| 删除残留离线核验 | `npm run verify -- <sessionId>` | 逐位置核对 |
| 样式 / HMR 归属 | 手工：改其它插件 ≥2 次 + 打开弹窗/菜单 | — |
| 弹窗 hover 边界 | 手工：两行交界 + 当前行上下滑动 | — |
