#!/usr/bin/env bash
# dsh-migra-clean 一键安装：装包 → 登记 bundle → 提示重启
# 用法:
#   ./install.sh                        # 装到 desktop profile
#   ./install.sh --profile work         # 指定 profile
#   ./install.sh --spec file:/path      # 自定义安装规格（默认 github:...）
#   ./install.sh --no-install           # 只登记 bundle，不跑 pnpm（调试用）
set -euo pipefail

PKG="dsh-migra-clean"
DEFAULT_SPEC="github:Cheney0819/dsh-migra-clean#v1.4.0"
PROFILE="desktop"
SPEC="$DEFAULT_SPEC"
DO_INSTALL=1
DSH_HOME_RESOLVED="${DSH_HOME:-$HOME/.dsh}"

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile 需要一个名字}"; shift 2 ;;
    --spec) SPEC="${2:?--spec 需要一个规格}"; shift 2 ;;
    --no-install) DO_INSTALL=0; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

PROFILE_DIR="$DSH_HOME_RESOLVED/profiles/$PROFILE"
MANIFEST="$PROFILE_DIR/package.json"

[ -d "$PROFILE_DIR" ] || { echo "✗ 找不到 profile 目录: $PROFILE_DIR" >&2; echo "  可用 profile: $(ls "$DSH_HOME_RESOLVED/profiles" 2>/dev/null | tr '\n' ' ')" >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "✗ 找不到 $MANIFEST" >&2; exit 1; }

echo "profile : $PROFILE_DIR"
echo "规格    : $SPEC"

if [ "$DO_INSTALL" = 1 ]; then
  echo "→ 安装包…"
  if command -v dsh >/dev/null 2>&1; then
    dsh plugin --profile "$PROFILE" add "$SPEC"
  elif command -v pnpm >/dev/null 2>&1; then
    ( cd "$PROFILE_DIR" && pnpm add "$SPEC" )
  else
    echo "✗ PATH 里既没有 dsh 也没有 pnpm，请先安装其一，或用 --no-install 手动放包" >&2; exit 1
  fi
else
  echo "→ 跳过安装（--no-install）"
fi

echo "→ 登记 bundle…"
cp "$MANIFEST" "$MANIFEST.bak-dsh-migra-$(date +%Y%m%d-%H%M%S)"
node -e '
const fs = require("fs");
const [manifest, pkg] = [process.argv[1], process.argv[2]];
const data = JSON.parse(fs.readFileSync(manifest, "utf8"));
data.dsh ??= {};
data.dsh.profile ??= {};
const list = data.dsh.profile.bundles ??= [];
const added = !list.includes(pkg);
if (added) list.push(pkg);
fs.writeFileSync(manifest, JSON.stringify(data, null, 2) + "\n");
console.log((added ? "  已加入 " : "  已存在 ") + pkg + "  →  dsh.profile.bundles（共 " + list.length + " 项）");
' "$MANIFEST" "$PKG"

echo
echo "✓ 完成。现在重启 DeepSeek Harness（Node 半边没有热替换）。"
echo "  验证: 侧边栏会话右键应出现「移动到其他工作区」「彻底删除会话」。"
