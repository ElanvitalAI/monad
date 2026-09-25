#!/bin/zsh
# [pilot · P2 2026-07-05] 매력도 refresh (monad-owned).
# openclaw run_attractiveness_refresh.sh 대체.
#
# scores.db 의 전 preset·symbol 을 재점수하고, cross-rank 3 preset
# (cross-asset-global 자산군 / country-global 국가 / sector-global 섹터)을
# 오늘자로 갱신한다. finance_attractiveness·finance_trend(rotation/country/
# sector)·finance_monitor 가 이 scores.db 를 읽는다. 점수 로직은 skill
# (asset-attractiveness) 에 있고, 이 래퍼가 monad 소유 스케줄 진입점.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# npx 는 nvm 설치라 크론 최소 PATH 에 없음 (2026-07-06~ 매일 '0 symbol' 침묵 실패
# — 크립토 스코어 07-05 동결의 근본원인). 최신 nvm node bin 동적 추가(버전 내성).
NVM_NODE_BIN=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
[ -n "$NVM_NODE_BIN" ] && export PATH="$NVM_NODE_BIN:$PATH"
SK="$HOME/.claude/skills/asset-attractiveness"
DB="$HOME/.cache/asset-attractiveness/scores.db"
LOGDIR="$HOME/.monad/logs/collect"; mkdir -p "$LOGDIR"
D=$(TZ=Asia/Seoul date +%Y%m%d); LOG="$LOGDIR/attractiveness-$D.log"
cd "$SK" || exit 1
echo "[$(date '+%F %T')] attractiveness refresh start" >> "$LOG"
# 개별 종목 재점수 (cross-asset-global 은 아래 cross-rank 로 별도 산출).
sqlite3 "$DB" "SELECT DISTINCT preset||'|'||symbol FROM scores WHERE preset != 'cross-asset-global';" 2>/dev/null | while IFS='|' read preset symbol; do
  [ -n "$symbol" ] && npx tsx scripts/main.ts score "$symbol" --preset "$preset" >> "$LOG" 2>&1
done
# 3 preset cross-rank (자산군 / 국가 / 섹터 로테이션).
npx tsx scripts/main.ts cross-rank --preset cross-asset-global --date today >> "$LOG" 2>&1
npx tsx scripts/main.ts cross-rank --preset country-global --date today >> "$LOG" 2>&1
npx tsx scripts/main.ts cross-rank --preset sector-global --date today >> "$LOG" 2>&1
# done 카운트는 최신 as_of 기준.
# 2026-07-24 — 종전 주석은 "as_of 는 마지막 완료 거래일 스탬프라 KST 오늘로 세면 아침
# 크론이 항상 0 으로 보인다"고 적혀 있었다. 그건 **사후 합리화**였다 — 실제 구현은
# `new Date().toISOString()`(UTC)이라 07:00 KST 크론이 쓰면 as_of 가 전날이 됐을 뿐이고,
# "거래일 스탬프" 같은 의미는 어디에도 없었다. 스킬이 로컬 달력 날짜를 쓰도록 고쳤으므로
# (asset-attractiveness/src/date-key.ts) 이제 as_of == KST 오늘이고 카운트가 정직해진다.
echo "[$(date '+%F %T')] attractiveness refresh done ($(sqlite3 "$DB" "select count(distinct symbol||preset)||' @ '||max(as_of) from scores where as_of=(select max(as_of) from scores);" 2>/dev/null) symbol-preset)" >> "$LOG"
