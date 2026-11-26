#!/usr/bin/env bash
# 安装 metalhdr-meter：编译二进制 + 注册 LaunchAgent（登录自动启动）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$HOME/.metalhdr/bin"
PLIST="$HOME/Library/LaunchAgents/com.metalhdr.meter.plist"
LABEL="com.metalhdr.meter"

mkdir -p "$BIN_DIR" "$HOME/Library/LaunchAgents"
echo "▸ 编译 metalhdr-meter…"
swiftc -O "$ROOT/native/metalhdr-meter.swift" -o "$BIN_DIR/metalhdr-meter"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$BIN_DIR/metalhdr-meter</string><string>--serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardErrorPath</key><string>$HOME/.metalhdr/meter.log</string>
  <key>StandardOutPath</key><string>$HOME/.metalhdr/meter.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
sleep 1
echo "▸ 自检："
curl -s --max-time 2 http://127.0.0.1:8765/headroom || { echo "启动失败，查看 $HOME/.metalhdr/meter.log"; exit 1; }
echo
echo "✓ 完成。MetalHDR 会自动读取屏幕亮度上限。"
