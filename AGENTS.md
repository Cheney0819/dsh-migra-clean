# AGENTS.md — 安装契约（给 AI 编程助手）

本仓库是 DeepSeek Harness（DSH）插件 `dsh-migra-clean`：**彻底删除会话** + **会话跨工作区迁移**（含 cwd 与日志搬迁）。

用户说「帮我安装这个插件」并给出本仓库地址时，按以下步骤执行，**不要动其他插件、不要删 `~/.dsh` 下任何文件**。

## 步骤

1. **定位 profile**：`$DSH_HOME`（默认 `~/.dsh`）下的 `profiles/<name>`；桌面端通常是 `profiles/desktop`。
   存在多个 profile 时，列出候选并询问用户装哪个。
2. **安装包**。优先用宿主自带的安装器（它会自动把包名登记进 `dsh.profile.bundles`）：
   - 有 Web「插件」页面：`添加插件` 里填 `github:Cheney0819/dsh-migra-clean#v1.3.8` → 安装 → 立即启用
   - 有 `plugin_manager` 工具：`install_bundle`，target 传 `github:Cheney0819/dsh-migra-clean#v1.3.8`
   - 都没有（纯终端）：按下面执行，然后务必完成第 3 步


   ```bash
   dsh plugin --profile <name> add github:Cheney0819/dsh-migra-clean#v1.3.8
   ```

   - `dsh` 不在 PATH：改用 `pnpm add github:Cheney0819/dsh-migra-clean#v1.3.8`
   - 无网络：`git clone` 后 `pnpm add file:/绝对路径/dsh-migra-clean`
3. **注册 bundle**（必做，漏了就是「装了不挂载」）：把 `"dsh-migra-clean"` 追加到
   `<profile>/package.json` 的 `dsh.profile.bundles` 数组；已存在则跳过。
   保持 JSON 合法，其他字段一个字节都不要改。
4. **重启宿主**：DSH 的 Node 半边没有热替换，必须重启进程（客户端半边刷新页面即可）。
5. **验证**：
   - 侧边栏任一会话右键 → 出现「移动到其他工作区」「彻底删除会话」
   - 把会话拖到另一个工作区 → 弹出确认框，确认后会话迁到目标工作区
6. **失败处理**：停止操作，贴出完整原始报错（命令 + stderr），不要自行删文件重装。

## 明确不要做

- 不要 `npm publish`（本插件不上架 npm registry）
- 不要修改用户其他插件的 bundle 条目或依赖
- 不要手改 `$DSH_HOME` 下 `sessions/`、`storages/` 里的文件来「修复」插件

## 参考

- 人类阅读版安装说明：[INSTALL.md](INSTALL.md)
- 行为语义、HTTP 接口、限制：[README.md](README.md)
