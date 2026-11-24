## dsh-migra-clean v1.5.0 发布说明

这个版本把插件对齐到 **DeepSeek Harness 0.2.2-rc.5**：逐条核对了宿主当前的插件装配契约、Client Slot 契约与磁盘布局，修掉两处在真实宿主上会直接失效的问题，其余保持零行为变化。

### 1. 会话日志改为「代际」发现（上游格式演进不再打断插件）

宿主的会话日志是**代际文件**：v0 保留最初的 `session.jsonl`，此后每一代是 `session.vN.jsonl`（N≥1），压缩版再加 `.zstd`；升级后同一个会话目录可能同时存在多代，运行时永远选代际号最高的那个。

旧实现把名字写死成 `session.v4.jsonl[.zstd]`，于是：

- 历史代会话被判成「未落盘」（`/info` 报 `persisted: false`）
- 迁移找不到日志，子会话跟着漏搬
- 宿主下次把格式升到 v5，整体复发

现在按宿主 `@deepseek-ai/dsh-session-format` 的规范名规则枚举目录、取代际最高者（同代压缩优先），非规范名（大写、前导零）忽略，未知的未来代自动识别。

### 2. Windows 上迁移恢复可用

`rewriteSessionCwd` 打开源日志后要等 `finally` 才关句柄，而原子替换（临时文件 → `rename` 覆盖源路径）发生在关闭之前。POSIX 允许 rename 已打开的文件，**Windows 不允许**，于是 Windows 上任何迁移都必然 `EPERM` 并回滚。

现在「读」与「写」分成两个阶段：读完首帧、`fs.closeSync` 释放句柄，再做原子替换（zstd 与纯文本两个分支都改）。

### 3. 清单、存储与 macOS 浮层对齐宿主

- `dsh.client.inject` 里的 `@deepseek-ai/dsh-client-ui-slots` 在 0.2.2-rc.5 已不存在（`slots` 服务改由 `@deepseek-ai/dsh-client-ui-renderer` 提供），换成实际提供方
- `workspace.json` 兜底写回模板的 `unit.version` 由 1 对齐到宿主的 2（存储域 `workspaceDomainSpec`）
- `projectKey` 空 cwd 由自造的 `--root--` 对齐宿主的 `_no-cwd`
- 从 0.2.2-rc.1 起，macOS Desktop 只自动排除 `data-window-drag` 行内的控件，此前"任意位置匹配都能 no-drag"的规则被取消。插件的三个浮层（右键菜单、全屏遮罩、Toast）现在各自声明 `data-window-drag-exclude`，浮在可拖动页头上时点击不会被当成拖窗口；非 macOS 环境该属性不生效
- 声明 `engines.dsh: ">=0.2.2-rc.5"`、`engines.node: ">=24.9.0"`

### 4. 验证

逐条核对过的宿主接口（全部仍成立，未改）：

| 面 | 结论 |
|---|---|
| `ctx.webServer.register({kind, path, handler})` + 原生 `(req, res)` | 契约不变，4 条路由实测正常 |
| Client Slot：`shell.overlay`、`sidebar.workspaces.session.menu.item`、`conversation.session.header.actions` | 全部存在；后两者的 `id`/`order` 选项、`sessionId`/`displayTitle`/`useMenuOpenState` props 与官方示例逐字一致 |
| 侧边栏行 DOM：`data-row-key="session:"`、`aria-selected`、`draggable`、标题类名含 `title` | 全部仍成立 |
| `sessions` / `agents` / `workspaceRegistry` / `sessionQuery` / `sessionPersistence` / `sessionProjectionCache` / `sessionProjections` / `sessionController` | 依赖的成员（含内部面）均未改名 |
| `api-session/added`、`api-session/removed`、`session/disposed`、`workspace/session-stop` | 事件名不变 |
| 会话头首行 JSON（`type`/`version`/`id`/`cwd`/`parentSession`/`origin`）、`storages/workspace.json`、`session_projcache/sessions/<id>.json` | 结构与字段不变 |

新增两个不依赖浏览器的回归套件：

- `test/compat-0.2.2-rc.5.mjs`：`projectKey` 与真实磁盘目录名逐字节一致、v0–v4 全代际识别、多代取最高、未来代 v9、非法名忽略、`_no-cwd`
- `test/host-smoke.mjs`：最小 ctx 复刻装配契约，起真 HTTP 服务跑通 4 条路由（含历史代会话），并验证卸载后路由注销

`npm run test:node` 一条命令跑完全部 Node 侧套件（98 条断言）。

### 5. 升级方式

```bash
dsh plugin --profile desktop add github:...#v1.5.0
```

> **必须重启宿主**：`lib/index.js` 属于 Node 半边，没有热替换；只刷新页面不够。纯网页半边（`client.js`）刷新页面即可。
