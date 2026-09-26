#!/bin/zsh
# [pilot · P2b 2026-07-05] X(트윗) 센티먼트 수집 (elanous-owned).
# openclaw run_asset_morning.sh + run_region_morning.sh 대체 (두 수집을 순차
# 실행하여 크론 라인 하나로 통합).
#
#   daily_dense_run.py   : 자산군 센티먼트 수집 (Apify tweet-scraper → 마크다운)
#   daily_region_run.py  : 지역/국가 센티먼트 + region 리포트 렌더
#   score_from_md.py     : 마크다운 → x_asset.db (source=tweets_md_score) 스코어링
#
# 파이프라인은 2단계다: (1) 수집→마크다운  (2) 마크다운→DB 스코어링. 과거엔
# (2) 스코어링 스텝이 스케줄에서 누락되어 수집(마크다운)은 매일 갱신되는데
# DB 신호(tweets_md_score)만 06-08 에 멈춰 있었다(2026-07-05 진단·수리). 이제
# 두 단계를 한 래퍼에서 순차 실행해 DB 신호가 매일 신선하게 유지된다.
#
# ⚠️ 센티먼트는 "color-only 보조" 신호(단독 검증 시 worse-than-random) — 1급
#    앵커는 backbone(collect-market-backbone.sh).
# Apify 토큰이 없으면 fail-fast (구 래퍼와 동일 계약).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# 파이썬 = 한 곳에서(scripts/lib/resolve-python.sh · ELANOUS_PYTHON > elanous venv > pyenv .python-version > PATH) — 옛 하드코딩 ~/.pyenv/versions/3.12.12 대체
PY="${PY:-$(sh "$(dirname "$0")/lib/resolve-python.sh")}"
SK="$HOME/.claude/skills/apify-x-asset-sentiment"
set -a; [ -f "$SK/.env" ] && source "$SK/.env"; set +a
LOGDIR="$HOME/.elanous/logs/collect"; mkdir -p "$LOGDIR"
D=$(TZ=Asia/Seoul date +%Y%m%d); LOG="$LOGDIR/sentiment-$D.log"
XBASE="$HOME/obsidian/ElanvitalAI/40. Project/EMBA_Field_Project/Crawling/X"
RBASE="$HOME/obsidian/ElanvitalAI/40. Project/EMBA_Field_Project/Crawling/X-regions"
if [ -z "${APIFY_TOKEN:-}" ]; then
  echo "[$(date '+%F %T')] ERROR: APIFY_TOKEN unset — sentiment skipped" >> "$LOG"; exit 1
fi
cd "$SK/scripts" || exit 1
echo "[$(date '+%F %T')] asset sentiment start" >> "$LOG"
"$PY" "$SK/scripts/daily_dense_run.py" \
  --base-dir "$XBASE" --date "$D" --min-favs 30 --max-items 120 \
  --render-markdown --archive-json-after-md >> "$LOG" 2>&1
echo "[$(date '+%F %T')] region sentiment start" >> "$LOG"
"$PY" "$SK/scripts/daily_region_run.py" \
  --base-dir "$RBASE" --date "$D" --min-favs 30 --max-items 120 \
  --render-markdown --render-region-report --archive-json-after-md >> "$LOG" 2>&1
# (2) 스코어링: 오늘 수집된 마크다운 → x_asset.db(tweets_md_score). 이 스텝이
#     과거 누락되어 DB 신호가 stale 했다. 92일 백필·INSERT OR REPLACE(멱등).
echo "[$(date '+%F %T')] scoring: markdown → tweets_md_score (DB)" >> "$LOG"
"$PY" "$SK/scripts/score_from_md.py" --obsidian-x "$XBASE" >> "$LOG" 2>&1
echo "[$(date '+%F %T')] sentiment done (rc=$?)" >> "$LOG"
