#!/usr/bin/env bash
# 从 dist/metalhdr-extension 生成 Safari Web Extension 的 Xcode 工程
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
test -d dist/metalhdr-extension || { echo "先运行 node scripts/build.mjs"; exit 1; }
rm -rf dist/safari
xcrun safari-web-extension-converter dist/metalhdr-extension \
  --project-location dist/safari \
  --app-name MetalHDR \
  --bundle-identifier com.metalhdr.MetalHDR \
  --swift --macos-only --copy-resources --no-prompt --no-open --force
cat <<'TXT'

下一步：
  1. 打开 dist/safari/MetalHDR/MetalHDR.xcodeproj
  2. 两个 target 都选你的个人 Team（免费账号即可）
  3. Run 一次，然后 Safari › 设置 › 扩展 里启用 MetalHDR

或直接用命令行构建并运行：
  bash scripts/run-safari.sh
TXT
