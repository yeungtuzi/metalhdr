#!/usr/bin/env bash
# 无开发者账号时的本地构建 + 注册 + 启动
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/dist/safari/MetalHDR"
xcodebuild -project MetalHDR.xcodeproj -scheme MetalHDR -configuration Release \
  -derivedDataPath "$ROOT/dist/safari/build" \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_ALLOWED=YES build >/dev/null
APP="$ROOT/dist/safari/build/Build/Products/Release/MetalHDR.app"
pluginkit -a "$APP/Contents/PlugIns/MetalHDR Extension.appex" || true
pluginkit -e use -i com.metalhdr.MetalHDR.Extension || true
open "$APP"
echo "✓ 已构建并注册。到 Safari › 设置 › 扩展 里勾选 MetalHDR。"
