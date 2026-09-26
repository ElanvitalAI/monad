#!/bin/zsh
# [pilot · P2a 2026-09-02] daily market 수집 (elanous-owned).
# yahoo_fetch_daily.py 가 Yahoo 시세 → fact_market_daily를 적재한다. 수집 로직은
# skill(apify-x-asset-sentiment)에 있고, 이 래퍼가 elanous 소유의 실행 진입점이다.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# 파이썬 = 한 곳에서(scripts/lib/resolve-python.sh · ELANOUS_PYTHON > elanous venv > pyenv .python-version > PATH) — 옛 하드코딩 ~/.pyenv/versions/3.12.12 대체
PY="${PY:-$(sh "$(dirname "$0")/lib/resolve-python.sh")}"
SK="$HOME/.claude/skills/apify-x-asset-sentiment"
DB="$SK/data/x_asset.db"
LOGDIR="$HOME/.elanous/logs/collect"; mkdir -p "$LOGDIR"
D=$(TZ=Asia/Seoul date +%Y%m%d); LOG="$LOGDIR/daily-$D.log"
if [[ ! -f "$DB" ]]; then
  message="daily collection failed: target database missing: $DB"
  echo "[$(date '+%F %T')] $message" | tee -a "$LOG" >&2
  exit 1
fi
cd "$SK/scripts" || exit 1
echo "[$(date '+%F %T')] daily start" >> "$LOG"
"$PY" "$SK/scripts/yahoo_fetch_daily.py" --db "$DB" >> "$LOG" 2>&1
rc=$?
if [[ "$rc" -ne 0 ]]; then
  message="daily collection failed: collector exited rc=$rc"
  echo "[$(date '+%F %T')] $message" | tee -a "$LOG" >&2
fi
echo "[$(date '+%F %T')] daily done (rc=$rc)" >> "$LOG"
exit "$rc"
