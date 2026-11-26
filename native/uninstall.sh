#!/usr/bin/env bash
set -euo pipefail
LABEL="com.metalhdr.meter"
PLIST="$HOME/Library/LaunchAgents/com.metalhdr.meter.plist"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$HOME/.metalhdr"
echo "✓ 已移除 metalhdr-meter"
