#!/usr/bin/env bash
# 把构建好的 Safari App 安装到 ~/Applications 并重新注册扩展
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dist/safari/build/Build/Products/Release/MetalHDR.app"
DST="$HOME/Applications/MetalHDR.app"

test -d "$SRC" || { echo "找不到构建产物，先跑：bash scripts/make-safari.sh && bash scripts/run-safari.sh"; exit 1; }
mkdir -p "$HOME/Applications"
rm -rf "$DST"
ditto "$SRC" "$DST"
xattr -dr com.apple.quarantine "$DST" 2>/dev/null || true
pluginkit -a "$DST/Contents/PlugIns/MetalHDR Extension.appex" || true
pluginkit -e use -i com.metalhdr.MetalHDR.Extension || true
open "$DST"
echo "✓ 已安装到 $DST，到 Safari › 设置 › 扩展 启用 MetalHDR"
