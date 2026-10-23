## 换工作区不再整页刷新了

这个版本解决了一个长期存在的体验问题：把会话拖到另一个工作区后，页面会自己刷新一次。

**根因**：迁移必须先改磁盘上的 `cwd`，所以后端要把会话从宿主内存里摘掉（quiesce）→ 宿主广播 `session/disposed` → 网页端把该会话实例标记成 `removed = true` 且**永不清除** → 输入框从此永久禁用。旧代码只能靠整页刷新换个实例来救。

**现在的做法**：只对「你正在看的那个会话」放掉主视图引用再重新打开（`clearMain()` → `retireScope` → `manager.drop()` → `openSession()`），拿到一个干净实例并从新 `cwd` 重读历史。输入框立刻可用，其它会话的迁移完全不碰主视图。

顺带修掉一个误伤：旧逻辑用宿主侧的 `wasLive`（内存里有没有这个会话）来决定要不要刷新，导致后台跑着的会话被搬一下、也会把你正在看的页面刷掉。

## 修了什么

| 问题 | 后果 |
|---|---|
| 首帧超过 64KB 时会话头读不出 | 子会话漏搬、回滚拿不到原 `cwd` |
| 改写 `cwd` 时重建首帧 | 首帧里打包的其它事件被静默吃掉 |
| 迁移目标目录用 raw `id` 拼接 | 特殊 id 会拼出不存在的路径 |
| 回滚只挂回父会话 | 子会话变孤儿 |
| `moveSession` 手写 `workspace.json` | 与 `dsh-storage-json` 整篇重写竞态，可能丢更新 |
| 弹窗迁移不失效归属缓存 | 20 秒内再拖同一会话会误判「已在这个工作区」 |
| 非活会话迁移后 `setTimeout(row.click(), 250)` | 抢走你当前视图 |

## 性能

索引基准（2000 会话 / 20 项目）：全量遍历 `30.88ms` → 冷 `1.98ms` / 热 `0.01ms`。
`cachedHeader` 命中路径少 2~3 次系统调用；子会话反查改 `Set`；拖拽起手不再连扫两遍整棵 DOM。

## 升级须知

- **必须重启宿主**：`lib/index.js` 属于 Node 半边，没有热替换；只刷新页面不够。
- 纯网页半边（`client.js`）刷新页面即可。

```bash
dsh plugin --profile desktop add github:Cheney0819/dsh-migra-clean#v1.3.8
```

## 验证

```bash
npm test   # 浏览器拖拽 12 条断言 + zstd/会话头 16 条断言
npm run bench
```

新增 `test/header.mjs`：zstd 多帧改写、超大首帧、纯文本日志、`projectKey` 与宿主规则逐字节对齐。

**完整变更**：https://github.com/Cheney0819/dsh-migra-clean/compare/v1.3.7...v1.3.8
