# 安装说明

插件分两半：**宿主半边**（`lib/index.js`，Node）与**客户端半边**（`client.js`，浏览器 bundle），
靠 `package.json` 里 `dsh.bundle.patch` 指向的 `cordis.patch.yml` 注册进 profile。

「装好了」= 两件事同时成立：

1. 包文件进了 `<profile>/node_modules/`
2. 包名出现在 `<profile>/package.json` 的 **`dsh.profile.bundles`** 数组里

> 第 2 步最容易漏。漏了不会报错，只是**插件完全不出现**。
> `DSH_HOME` 默认 `~/.dsh`，profile 目录是 `$DSH_HOME/profiles/<profile>`，桌面端通常叫 `desktop`。

---

## 方式 ①：桌面端插件页（零命令，推荐）

侧栏 **插件** → **添加插件** → 输入框粘贴 `github:Cheney0819/dsh-migra-clean` → **安装** → **立即启用** → 重启宿主。

宿主安装器替你完成两件事：把包装进 `<profile>/node_modules`、把包名写进 `dsh.profile.bundles`（手动做最容易漏的那步），失败时还会还原 `package.json`。输入框同样接受包名、Git 地址、压缩包链接、本地绝对路径。

## 方式 ②：一行脚本（终端）

```bash
curl -fsSL https://raw.githubusercontent.com/Cheney0819/dsh-migra-clean/main/install.sh | bash -s -- --profile desktop
```

脚本等价于「装包 + 登记 bundle + 提示重启」，幂等可重复执行：

| 参数 | 作用 |
|---|---|
| `--profile <名字>` | 目标 profile（默认 `desktop`） |
| `--spec <规格>` | 自定义安装规格，如 `file:/绝对路径` |
| `--no-install` | 只登记 bundle，不跑 pnpm（迁移/调试用） |

## 方式 ③：让 AI 装（一句话）

```text
帮我安装这个插件：https://github.com/Cheney0819/dsh-migra-clean
```

仓库根目录的 [AGENTS.md](AGENTS.md) 是写给 AI 的安装契约（定位 profile → 安装 → 登记 bundle → 重启 → 验证 → 失败回滚），AI 读完自行完成，无需你再解释。

## 方式 ④：命令行三条（无 UI 时）

```bash
# 1) 装包（pin tag 更稳，追新可用 main）
dsh plugin --profile desktop add github:Cheney0819/dsh-migra-clean#v1.3.4

# 2) 登记 bundle（漏了不挂载；已存在会跳过）
node -e 'const fs=require("fs"),p=process.env.HOME+"/.dsh/profiles/desktop/package.json";const d=JSON.parse(fs.readFileSync(p,"utf8"));d.dsh??={};d.dsh.profile??={};const b=d.dsh.profile.bundles??=[];if(!b.includes("dsh-migra-clean"))b.push("dsh-migra-clean");fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");console.log("bundles:",b.join(", "));'

# 3) 重启 DeepSeek Harness
```

`dsh plugin` 把参数原样转发给 pnpm，以下规格都能用：

| 规格 | 示例 |
|---|---|
| GitHub 简写 | `github:Cheney0819/dsh-migra-clean#v1.3.4` |
| Git URL | `git+https://github.com/Cheney0819/dsh-migra-clean.git` |
| 远程 tarball | `https://github.com/Cheney0819/dsh-migra-clean/archive/refs/tags/v1.3.4.tar.gz` |
| 本地目录（开发用，软链） | `file:/Users/me/code/dsh-migra-clean` |

---

## 方式 ⑤：手动拷目录（离线）

```bash
git clone https://github.com/Cheney0819/dsh-migra-clean.git
cp -r dsh-migra-clean "$DSH_HOME/profiles/desktop/node_modules/"
```

再手工改 `$DSH_HOME/profiles/desktop/package.json` 两处：

```jsonc
{
  "dependencies": { "dsh-migra-clean": "file:/absolute/path/to/dsh-migra-clean" },
  "dsh": { "profile": { "bundles": ["dsh-migra-clean"] } }
}
```

---

## 生效方式

| 改动涉及 | 生效方式 |
|---|---|
| `client.js`（菜单/拖拽/弹窗） | 刷新页面即可，HMR 通常直接推送 |
| `lib/index.js`（删除/迁移/接口） | **必须重启 DeepSeek Harness**（Node 半边无热替换） |

## 怎么确认装好了

```text
客户端半边 → 会话右键出现「移动到其他工作区」「彻底删除会话」
宿主半边   → $DSH_HOME/logs 里出现 [dsh-migra-clean] 前缀日志
都不出现   → 九成是 dsh.profile.bundles 里没登记
```

## 卸载

```bash
dsh plugin --profile desktop remove dsh-migra-clean
# 再从 package.json 的 dsh.profile.bundles 里删掉 "dsh-migra-clean"
```

> 卸载不影响数据：已迁移的会话留在新工作区，日志与 `cwd` 不回滚。

## 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 装完毫无反应 | `dsh.profile.bundles` 没登记 | 补登记后重启 |
| 启动报 `import failed` | 包文件不完整 / 与宿主版本不兼容 | 移除 bundles 条目重启，再按上面重装 |
| 移动后会话从侧边栏消失 | 目标工作区路径失效（目录被删/改名） | 修好目标目录或换工作区重试；必要时重启让宿主重扫 |
| 拖拽无反应 | 会话是空白会话或已归档 | 用右键菜单「移动到其他工作区」 |
