#!/bin/zsh
# [pilot · 2026-07-06] Conatus 스크리너 백필 (elanous-owned, 일별 누적).
#
# 배경: 캡스톤/KORU 백테스트가 읽는 screener.db(prices/screen/investor)는
# `~/.elanous/conatus/`로 물리 이전됨(MIGRATION-capstone-leverage-2026-07-06 §7).
# 이관 시점 스냅샷은 17 거래일(2026-05-20~07-02)뿐이라 forward 윈도가 비어
# 있었다. 이 래퍼가 그 공백을 매일 채운다.
#
# 동작: Conatus 스킬사이드 report.py(파이썬 재사용, 대표 결정)를
# CONATUS_DATA_DIR=~/.elanous/conatus 로 호출 → EODHD eod-bulk-last-day 로
# KRX 전종목 최신 EOD 를 받아 elanous screener.db 에 최신 1거래일 append
# (db.record_daily · INSERT OR REPLACE 라 재실행 idempotent). report.py 는
# stdout 리포트만 출력하고 텔레그램 발송은 하지 않음(send.py 가 발송 담당) →
# 순수 데이터 적재. finance_backtest 가 이 누적분을 소비.
#
# ⚠️ 백테스트 로직/파이썬은 스킬사이드(git 밖) 재사용. 이 스크립트가 elanous
# 소유의 스케줄 진입점(수집 로직 자체는 skill Python 에 있음).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# 파이썬 = 한 곳에서(scripts/lib/resolve-python.sh · ELANOUS_PYTHON > elanous venv > pyenv .python-version > PATH) — 옛 하드코딩 ~/.pyenv/versions/3.12.12 대체
PY="${PY:-$(sh "$(dirname "$0")/lib/resolve-python.sh")}"
SK="$HOME/source/asset-attractiveness-results-20260527/screener"
export CONATUS_DATA_DIR="$HOME/.elanous/conatus"
LOGDIR="$HOME/.elanous/logs/collect"; mkdir -p "$LOGDIR"
D=$(TZ=Asia/Seoul date +%Y%m%d); LOG="$LOGDIR/conatus-screener-$D.log"

# EODHD_API_KEY 주입 (omni-market skill .env) + screener .env (있으면)
ENVFILE="$HOME/.claude/skills/omni-market/.env"
[ -f "$ENVFILE" ] && set -a && source "$ENVFILE" && set +a
[ -f "$SK/.env" ] && set -a && source "$SK/.env" && set +a

cd "$SK" || exit 1
echo "[$(date '+%F %T')] conatus-screener backfill start (CONATUS_DATA_DIR=$CONATUS_DATA_DIR)" >> "$LOG"
# report.py daily → DB.record_daily() 로 prices/screen/investor 적재, stdout 리포트는 로그로.
"$PY" "$SK/report.py" daily >> "$LOG" 2>&1
RC=$?
echo "[$(date '+%F %T')] conatus-screener backfill done (rc=$RC)" >> "$LOG"
# 적재 후 요약 (prices 기간·행수)
"$PY" - <<'PYEOF' >> "$LOG" 2>&1
import os, sqlite3
db = os.path.join(os.environ["CONATUS_DATA_DIR"], "screener.db")
c = sqlite3.connect(db)
r = c.execute("SELECT COUNT(*), COUNT(DISTINCT date), MIN(date), MAX(date) FROM prices").fetchone()
print(f"  prices: rows={r[0]} days={r[1]} range={r[2]}~{r[3]}")
c.close()
PYEOF
exit $RC
