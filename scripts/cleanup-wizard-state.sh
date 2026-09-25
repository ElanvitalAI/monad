#!/usr/bin/env bash
# cleanup-wizard-state.sh
#
# Setup wizard 라이브 검증 진입 전 백업 + 상태 wipe 스크립트.
#
# 흐름:
#   1) 기존 config 백업 (timestamp suffix · 복원 가능)
#   2) cleanup — wizard re-run 강제 + control plane state wipe + launchd plist 제거
#   3) 검증 — wipe 결과 확인
#
# 사용:
#   bash scripts/cleanup-wizard-state.sh
#   또는 chmod +x 후
#   ./scripts/cleanup-wizard-state.sh
#
# 복원 (필요 시):
#   ls ~/.config/monad/config.json.backup-* | tail -1 → 가장 최근 백업
#   cp <그 파일> ~/.config/monad/config.json

set -e

TS=$(date +%Y%m%d-%H%M%S)
CONFIG_DIR="$HOME/.config/monad"
MONAD_DIR="$HOME/.monad"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

echo "── 1) 백업 ─────────────────────────────────────────────────"

if [ -f "$CONFIG_DIR/config.json" ]; then
  BACKUP_PATH="$CONFIG_DIR/config.json.backup-$TS"
  cp "$CONFIG_DIR/config.json" "$BACKUP_PATH"
  echo "  ✓ config.json → $BACKUP_PATH"
else
  echo "  · config.json 없음 (백업 skip)"
fi

if [ -f "$MONAD_DIR/control.json" ]; then
  cp "$MONAD_DIR/control.json" "$MONAD_DIR/control.json.backup-$TS"
  echo "  ✓ control.json → $MONAD_DIR/control.json.backup-$TS"
fi

if [ -f "$MONAD_DIR/acp-token.json" ]; then
  cp "$MONAD_DIR/acp-token.json" "$MONAD_DIR/acp-token.json.backup-$TS"
  echo "  ✓ acp-token.json → $MONAD_DIR/acp-token.json.backup-$TS"
fi

echo
echo "── 2) cleanup ──────────────────────────────────────────────"

# Wizard re-run 강제
rm -f "$CONFIG_DIR/config.json"
echo "  · removed config.json"

# Control plane state wipe
pkill -f 'monad ctl serve' 2>/dev/null && echo "  · killed: monad ctl serve" || true
pkill -f 'monad serve' 2>/dev/null && echo "  · killed: monad serve" || true
rm -f "$MONAD_DIR/control.db" "$MONAD_DIR"/control.db-{wal,shm}
rm -f "$MONAD_DIR/control.spawning" "$MONAD_DIR/control.json"
rm -f "$MONAD_DIR/acp-token" "$MONAD_DIR/acp-token.json"
rm -rf "$MONAD_DIR/registry/"
echo "  · wiped control plane state"

# launchd plist 제거 (macOS only)
if [ -f "$LAUNCH_AGENTS/com.monad.control.plist" ]; then
  launchctl unload "$LAUNCH_AGENTS/com.monad.control.plist" 2>/dev/null || true
  rm -f "$LAUNCH_AGENTS/com.monad.control.plist"
  echo "  · removed launchd plist"
else
  echo "  · launchd plist 없음 (skip)"
fi

echo
echo "── 3) 검증 ─────────────────────────────────────────────────"

CHECKS_OK=true

if [ -f "$CONFIG_DIR/config.json" ]; then
  echo "  ✗ config.json 가 아직 있음"
  CHECKS_OK=false
else
  echo "  ✓ config.json 제거됨"
fi

if ls "$MONAD_DIR"/control.* >/dev/null 2>&1; then
  REMAINING=$(ls "$MONAD_DIR"/control.* 2>/dev/null | grep -v backup | wc -l | tr -d ' ')
  if [ "$REMAINING" -gt 0 ]; then
    echo "  ✗ control.* 잔존: $REMAINING 개"
    CHECKS_OK=false
  else
    echo "  ✓ control.* 제거됨 (백업만 남음)"
  fi
else
  echo "  ✓ control.* 제거됨"
fi

if [ -d "$MONAD_DIR/registry/" ]; then
  echo "  ✗ registry/ 가 아직 있음"
  CHECKS_OK=false
else
  echo "  ✓ registry/ 제거됨"
fi

if [ -f "$LAUNCH_AGENTS/com.monad.control.plist" ]; then
  echo "  ✗ launchd plist 가 아직 있음"
  CHECKS_OK=false
else
  echo "  ✓ launchd plist 제거됨"
fi

echo
if $CHECKS_OK; then
  echo "✓ cleanup 완료. 다음 단계: bun run dev (또는 monad setup)"
  exit 0
else
  echo "✗ cleanup 부분 실패. 위 ✗ 항목 수동 처리 필요."
  exit 1
fi
