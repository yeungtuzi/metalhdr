#!/usr/bin/env bash
# 一键：打扩展 → 生成 Xcode 工程 → 用本机证书签名构建 → 安装到 ~/Applications
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEAM="${METALHDR_TEAM:-JUWT86SYTS}"
cd "$ROOT"

node scripts/build.mjs
rm -rf dist/safari
xcrun safari-web-extension-converter dist/metalhdr-extension \
  --project-location dist/safari --app-name MetalHDR \
  --bundle-identifier com.metalhdr.MetalHDR --swift --macos-only \
  --copy-resources --no-prompt --no-open --force >/dev/null

cd dist/safari/MetalHDR
xcodebuild -project MetalHDR.xcodeproj -scheme MetalHDR -configuration Release \
  -derivedDataPath "$ROOT/dist/safari/build" \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY="Apple Development" \
  build 2>&1 | grep -E "BUILD SUCCEEDED|BUILD FAILED|error:" | tail -3

APP="$ROOT/dist/safari/build/Build/Products/Release/MetalHDR.app"
DST="$HOME/Applications/MetalHDR.app"
osascript -e 'tell application "MetalHDR" to quit' 2>/dev/null || true
rm -rf "$DST"; ditto "$APP" "$DST"
pluginkit -a "$DST/Contents/PlugIns/MetalHDR Extension.appex" || true
pluginkit -e use -i com.metalhdr.MetalHDR.Extension || true
echo "✓ 已安装到 $DST"
