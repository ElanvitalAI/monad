#!/bin/zsh
# [pilot · P2a 2026-07-05] market backbone 수집 (elanous-owned).
# openclaw `.openclaw/workspace/scripts/run_market_backbone.sh` 대체.
#
# market_signal_generator.py 가 최근 180일 Yahoo 시세 → fact_signal_daily
# (signal_source=market_yahoo) 결정론 앵커를 x_asset.db 에 재적재한다. 이
# backbone 이 finance_* 도구·아침리포트·매력도의 1급 근거(X-lag-free). 수집
# 로직 자체는 skill(apify-x-asset-sentiment) Python 에 있고, 이 래퍼가 elanous
# 소유의 스케줄 진입점이다 (openclaw 워크스페이스 의존 제거).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# 파이썬 = 한 곳에서(scripts/lib/resolve-python.sh · ELANOUS_PYTHON > elanous venv > pyenv .python-version > PATH) — 옛 하드코딩 ~/.pyenv/versions/3.12.12 대체
PY="${PY:-$(sh "$(dirname "$0")/lib/resolve-python.sh")}"
SK="$HOME/.claude/skills/apify-x-asset-sentiment"
LOGDIR="$HOME/.elanous/logs/collect"; mkdir -p "$LOGDIR"
D=$(TZ=Asia/Seoul date +%Y%m%d); LOG="$LOGDIR/backbone-$D.log"
START=$(TZ=Asia/Seoul date -v-180d +%Y-%m-%d 2>/dev/null || date -d '180 days ago' +%Y-%m-%d)
cd "$SK/scripts" || exit 1
echo "[$(date '+%F %T')] backbone start (--start $START)" >> "$LOG"
"$PY" "$SK/scripts/market_signal_generator.py" --start "$START" >> "$LOG" 2>&1
echo "[$(date '+%F %T')] backbone done (rc=$?)" >> "$LOG"
