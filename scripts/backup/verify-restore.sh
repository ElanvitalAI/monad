#!/usr/bin/env bash
# 💾🔬 **「백업이 «있다»」가 아니라 「«복원된다»」를 잰다.**
#
#   bash scripts/backup/verify-restore.sh              가장 최근 회차
#   bash scripts/backup/verify-restore.sh --run 2026-08-30T19-20-00Z
#   bash scripts/backup/verify-restore.sh --keep       ⭐ 복원본을 안 지운다(들여다볼 때)
#
# ⛔⭐⭐ **왜 이 파일이 있나** (2026-08-31 · 🅕 40차 · 무인 리뷰 must-fix `#14607`)
#    40차가 복원 시험을 «손으로» 하고 그 수를 PR 본문에 적었다. 리뷰가 정확히 물었다 —
#    ***「재현할 수 있는 절차가 diff 에 없다」***. ⇒ 그 수는 늙고, 다음 창은 다시 손으로 한다.
#    🔑 이 저장소의 규율: ***수를 적지 말고 «재는 명령»을 둔다.***
#
# ⛔⭐⭐⭐ **1차 시도가 «거짓 초록»이었다 — 그 함정을 이 파일이 «구조로» 막는다**
#    📏 실측: `ELANOUS_STATE_DIR` 로 격리한 줄 알았는데 ***스토어 288개가 열렸고***
#       「최신 행」이 «살아 있는 운영 스토어»의 것이었다. 「복원됐다」로 쓸 뻔했다.
#    🔎 기전: ***`--config-dir` 이 `ELANOUS_STATE_DIR` 을 «이긴다»*** — 로그 스토어 경로는 config-dir 파생이다.
#    ✅ 그래서 이 파일은 복원본을 «반드시» `<config-dir>/logs/logs.db` 에 두고 `--config-dir` 로 연다.
#
# ⭐⭐ **판정은 «둘»이다 — 하나만으로는 못 가른다**:
#    ⓐ 양성 — 백업 «직전» 창에 복원본의 행이 «있나»      (없으면 빈 껍데기다)
#    ⓑ 음성 — 백업 «뒤» 창에 복원본의 행이 «없나»        (있으면 내가 «산 것»을 읽고 있다)
#    ⛔ ⓑ 가 «핵심»이다. ⓐ 만 보면 운영 db 를 읽고도 ✅ 가 난다.
#
# ⛔ 운영 db 와 «행 수가 같은가»는 판정에 «안 쓴다» — 로그 스토어는 상한에서 옛 행을 지우므로(🅣 OBS-T353)
#    시간이 지나면 두 수가 갈리는 것이 «정상»이다. 그것으로 판정하면 언젠가 반드시 거짓 빨강이 된다.
set -uo pipefail

BUCKET_GLOB='gs://monad-backup-*/'
RUN=""; KEEP=0
# 🔎 ⛔ 기본은 `unknown` 이다 — 「손」도 「크론」도 «아니다». 안 주면 «모른다»고 남는다.
SOURCE="${SOURCE:-unknown}"
while [ $# -gt 0 ]; do
  case "$1" in
    --run) RUN="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    # 🔎⛔⭐⭐ **「무인이었나」를 «원장이» 말하게 한다** (2026-08-31 · 40차).
    #    🚨 이 자의 목적이 ***「주 1회 무인 발화」***인데, 원장에 `source` 가 «없어서»
    #       다음 월요일에 크론이 떠도 ***내 손 실행과 «구분이 안 됐다».***
    #    📏 실물: 원장 두 줄이 둘 다 `source: ?` 였고 둘 다 «손»이었다.
    #    ⛔ 옆 자(카나리아)는 이미 `--source cron|manual` 을 쓴다 — 자끼리 짝이 안 맞았다.
    --source) SOURCE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "⛔ 모르는 인자 «$1»"; exit 2 ;;   # ⛔ 모르는 것을 «삼키지» 않는다
  esac
done

GCLOUD=""
for c in /opt/homebrew/bin/gcloud /usr/local/bin/gcloud "$HOME/google-cloud-sdk/bin/gcloud"; do
  [ -x "$c" ] && { GCLOUD="$c"; break; }
done
[ -z "$GCLOUD" ] && GCLOUD="$(command -v gcloud 2>/dev/null || true)"
[ -z "$GCLOUD" ] && { echo "⛔ gcloud 를 «못 찾았다» — 「복원된다」를 잴 수 없다(⛔ 「된다」가 아니다)"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ELANOUS="$HERE/bin/elanous.mjs"
[ -f "$ELANOUS" ] || { echo "⛔ elanous 진입점을 «못 찾았다»: $ELANOUS"; exit 1; }

# ⛔⭐⭐ **크론 PATH 에는 `bun` 이 «없다»** — 이 저장소가 `gcloud` 로 «이미» 값을 치른 함정이다.
#    🚨 `elanous-backup.sh` 머리말: *「첫 무인 발화가 200M 을 다 만들어 놓고 마지막 줄에서 죽었다 —
#       gcloud: command not found」*. ⛔ 크론 기본 PATH 는 `/usr/bin:/bin` 이다.
#    📏 실측(2026-08-31 · `env -i … PATH=/usr/bin:/bin`): `bun` ***없다***.
#    🔑 ⇒ 이 파일은 «주 1회 무인»으로 돌 것이므로, PATH 에 기대면 ***영영 초록을 못 낸다.***
BUN=""
for c in "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
  [ -x "$c" ] && { BUN="$c"; break; }
done
# ⛔ PATH 폴백은 «의도»다 — 사람이 손으로 돌릴 때(다른 설치 경로) 막지 않기 위함이다.
#    ⚠️ 다만 «크론»에서는 이 줄이 «안 걸린다»(PATH 에 없다) — 위 절대 경로가 정본이다.
#    (무인 리뷰 should-fix `#14631`: 의도를 안 적으면 다음 창이 「재현성이 흐리다」로 읽는다.)
[ -z "$BUN" ] && BUN="$(command -v bun 2>/dev/null || true)"
[ -z "$BUN" ] && { echo "⛔ bun 을 «못 찾았다» — 「복원된다」를 잴 수 없다(⛔ 「된다」가 아니다)"; exit 1; }

# ── 어느 회차를 재나 ─────────────────────────────────────────────────────────
BASE="$("$GCLOUD" storage ls "$BUCKET_GLOB" 2>/dev/null | tail -1)"
[ -z "$BASE" ] && { echo "⛔ 백업 버킷을 «못 읽었다»"; exit 1; }
if [ -z "$RUN" ]; then
  DEST="$("$GCLOUD" storage ls "$BASE" 2>/dev/null | grep -E '/[0-9]{4}-[0-9]{2}-[0-9]{2}T' | tail -1)"
else
  DEST="${BASE}${RUN}/"
fi
[ -z "$DEST" ] && { echo "⛔ 회차를 «못 골랐다»"; exit 1; }
STAMP="$(basename "${DEST%/}")"
echo "🔬 복원 시험 — 회차 $STAMP"
echo "   ⛔ 이것은 「다른 «기기»에서의 복원」이 아니다 — «다른 상태 디렉터리»로 복원해 여는 것이다."

# 회차 이름(UTC)에서 «백업 시각»을 되살린다. ⚠️ 사람이 읽는 날짜표가 아니라 «창 경계»로만 쓴다.
ISO="$(echo "$STAMP" | sed -E 's/^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2})-([0-9]{2})-([0-9]{2})Z$/\1T\2:\3:\4Z/')"
case "$ISO" in
  *T*:*:*Z) : ;;
  *) echo "⛔ 회차 이름에서 시각을 «못 읽었다»: $STAMP"; exit 1 ;;
esac

TMP="$(mktemp -d "${TMPDIR:-/tmp}/elanous-restore-verify.XXXXXX")"
cleanup() { [ "$KEEP" = "1" ] && echo "   📁 복원본을 남겼다: $TMP" || rm -rf "$TMP"; }
trap cleanup EXIT
mkdir -p "$TMP/cfg/logs"

echo "   ⬇️  내려받는다…"
if ! "$GCLOUD" storage cp "${DEST}elanous-logs.db.gz" "$TMP/elanous-logs.db.gz" >/dev/null 2>&1; then
  echo "⛔ 내려받기 실패 — ${DEST}elanous-logs.db.gz"; exit 1
fi
if ! gunzip -c "$TMP/elanous-logs.db.gz" > "$TMP/cfg/logs/logs.db"; then
  echo "⛔ 압축을 «못 풀었다» — 회차가 손상됐다"; exit 1
fi
echo "   📦 풀었다 — $(ls -la "$TMP/cfg/logs/logs.db" | awk '{print $5}') bytes"

# ── 🕰️ 판정 «경계»를 회차 이름이 아니라 «업로드 시각»에서 파생한다 ────────────────
#    ⛔⭐ 첫 판은 `ISO + 5분` 이라는 ***임의 유예***를 뒀다(무인 리뷰 must-fix `#14609`).
#       회차 이름은 백업이 «시작된» 시각이고, 스냅샷은 그 «뒤»에 뜬다 — 그 사이 행은 정상이다.
#    ✅ 그래서 경계를 ***그 객체가 GCS 에 올라간 시각***으로 잡는다. 파생값이라 자의적이지 않다.
CUT="$("$GCLOUD" storage ls -l "${DEST}elanous-logs.db.gz" 2>/dev/null \
        | awk '/elanous-logs\.db\.gz$/ {print $2; exit}')"
case "$CUT" in
  *T*:*:*Z) : ;;
  *) echo "⛔ 업로드 시각을 «못 읽었다» — 판정 «불가»(⛔ 「복원된다」가 아니다)"; exit 1 ;;
esac
echo "   🕰️ 판정 경계 = 업로드 시각 $CUT  (⛔ 회차 이름 $ISO 이 아니다)"

win() { python3 -c "
import datetime as dt, sys
t = dt.datetime.strptime(sys.argv[1], '%Y-%m-%dT%H:%M:%SZ') + dt.timedelta(hours=float(sys.argv[2]))
print(t.strftime('%Y-%m-%dT%H:%M:%SZ'))" "$CUT" "$1"; }

# ── 재는 함수 — ⛔ 「조회 실패」와 「행 0」을 «다른 값»으로 낸다 ─────────────────────
#    🚨 무인 리뷰 must-fix(`#14609`): 첫 판은 CLI 실패·비JSON 을 파서가 삼키고 «0» 을 냈다.
#       ⇒ ***조회가 죽은 것이 「행이 없다」로 통과***했다 — 이 저장소의 대죄다.
#    ⛔ 그리고 «상한 절단»도 「0」으로 읽지 않는다 — 절단된 0 은 「전수」가 아니다.
#    ⇒ 산출은 `<복원본 행>|<전체 행>|<상한>` 이고, 실패면 «빈 문자열»이다.
LIMIT=2000
measure() { # $1=since $2=until
  local out rc
  out="$("$BUN" "$ELANOUS" logs --config-dir "$TMP/cfg" --limit "$LIMIT" --json \
           --since "$1" --until "$2" 2>/dev/null)"; rc=$?
  [ "$rc" -ne 0 ] && return 1
  printf '%s' "$out" | python3 -c '
import sys, json
mine = total = 0
bad = False
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try: d = json.loads(line)
    except Exception:
        bad = True; continue          # ⛔ 비JSON 을 «조용히» 버리지 않는다
    if d.get("_meta"): continue
    total += 1
    if d.get("store") == "test:cfg": mine += 1
if bad: sys.exit(3)                    # ⛔ 파싱이 깨졌으면 «수»를 내지 않는다
print(f"{mine}|{total}")
' || return 1
  return 0
}

read_pair() { # $1=since $2=until  → MINE/TOTAL 을 채운다. 실패면 rc≠0
  local r
  r="$(measure "$1" "$2")" || return 1
  MINE="${r%%|*}"; TOTAL="${r##*|}"
  return 0
}

# ⓐ 양성 — 복원본에 «내용»이 있나. ⛔ 창을 좁게 잡아 놓고 「빈 껍데기」라 말하지 않는다:
#    좁은 창(1시간)에서 0 이면 ***넓혀서 다시*** 묻고, 그래도 0 일 때만 「빈 껍데기」다.
POS=0; POS_NOTE=""; POS_TRUNC=0
if ! read_pair "$(win -1)" "$CUT"; then
  echo "⛔ 양성 조회가 «실패»했다 — 판정 «불가»(⛔ 「행이 없다」가 아니다)"; exit 1
fi
POS="$MINE"; [ "$TOTAL" -ge "$LIMIT" ] && POS_TRUNC=1
if [ "$POS" = "0" ]; then
  # ⛔⭐ **재조회 «실패»를 「행 0」으로 읽지 않는다** (무인 리뷰 must-fix `#14614`)
  #    🪞 첫 판은 `if read_pair …; then …; fi` 라 ***실패하면 조용히 POS=0 인 채 지나가***
  #       「빈 껍데기다」라고 «단정»했다 — 이 PR 이 고치려던 형태 그 자체다.
  if ! read_pair "$(win -168)" "$CUT"; then
    echo "⛔ 양성 «재»조회가 실패했다 — 판정 «불가»(⛔ 「빈 껍데기」가 아니다)"; exit 1
  fi
  POS="$MINE"; POS_TRUNC=0; [ "$TOTAL" -ge "$LIMIT" ] && POS_TRUNC=1
  POS_NOTE=" (⚠️ 좁은 창엔 0 — 7일로 «넓혀서» 다시 쟀다)"
fi

# ⓑ 음성 — 복원본에 «업로드 뒤» 행이 있나. ⛔ 상한에 닿은 「0」은 «전수»가 아니다.
#    ⚠️ 창(1시간)은 ***질의를 작게 유지하기 위한 것***이지 «허용 오차»가 아니다 —
#       복원본이 «산 것»이면 그 한 시간에도 수백 행이 있다(실측: 20분에 88행).
if ! read_pair "$CUT" "$(win 1)"; then
  echo "⛔ 음성 조회가 «실패»했다 — 판정 «불가»(⛔ 「행이 없다」가 아니다)"; exit 1
fi
NEG="$MINE"; NEG_TOTAL="$TOTAL"
NEG_TRUNC=0
[ "$NEG_TOTAL" -ge "$LIMIT" ] && NEG_TRUNC=1

echo ""
# ⛔⭐ **절단된 「0」은 «전수»가 아니다** — 양성 쪽에도 같은 규율을 댄다(무인 리뷰 must-fix `#14614`).
printf "  ⓐ 양성 — 복원본의 행:  %s%s  %s\n" "$POS" "$POS_NOTE" \
  "$([ "${POS:-0}" -gt 0 ] && echo '✅ 내용이 있다' \
     || { [ "$POS_TRUNC" = "1" ] && echo '⚪ 상한에 닿았다 — 이 「0」은 «전수»가 아니다' || echo '⛔ «빈 껍데기»다'; })"
printf "  ⓑ 음성 — 업로드(%s) «뒤» 창의 복원본 행:  %s  %s\n" "$CUT" "$NEG" \
  "$([ "${NEG:-0}" = "0" ] && { [ "$NEG_TRUNC" = "0" ] && echo '✅ 업로드 시점에서 «멈췄다»' || echo '⚪ 상한에 닿았다 — 이 「0」은 «전수»가 아니다'; } || echo '⛔ ***살아 있는 스토어를 읽고 있다*** — 이 판정은 무효다')"

# 🧾⛔⭐⭐ **판정을 «남긴다»** (2026-08-31 · 40차)
#    🚨 이 도구가 «주 1회 무인»으로 돌 것인데, 남기지 않으면 ***산출이 로그 파일 한 줄로 사라진다***
#       — 이 창이 종일 만난 형태(***「만들어져 있는데 안 닿는다」***)를 내 손으로 하나 더 만드는 셈이다.
#    ⇒ 자기감사(`bot-selfaudit.sh`)가 이 파일을 읽어 ***「마지막 복원 검증이 언제·무엇이었나」***를 낸다.
#    ⛔ 「못 쟀다」도 남긴다 — 초록으로도 빨강으로도 읽히면 안 된다.
VERDICT="ok"
[ "${POS:-0}" -gt 0 ] || VERDICT="empty"
[ "${NEG:-0}" = "0" ] || VERDICT="contaminated"
[ "$NEG_TRUNC" = "0" ] || VERDICT="unmeasured"
LEDGER="${ELANOUS_STATE_DIR:-$HOME/.elanous}/botlab/restore-verifications.jsonl"
mkdir -p "$(dirname "$LEDGER")" 2>/dev/null
# ⛔ `%s` 만 쓴다 — `%` 를 담은 값이 들어오면 `printf` 가 «잘라 먹는다»(`GIT-T75`).
printf '{"at":"%s","run":"%s","cutoff":"%s","positive":%s,"negative":%s,"truncated":%s,"verdict":"%s","source":"%s"}\n' \
  "$(date -u +%FT%TZ)" "$STAMP" "$CUT" "${POS:-0}" "${NEG:-0}" "$NEG_TRUNC" "$VERDICT" "${SOURCE:-unknown}" >> "$LEDGER" 2>/dev/null \
  && echo "   🧾 판정 기록 — $LEDGER" \
  || echo "   ⚠️⛔ 판정을 «못 남겼다» — 자기감사가 이 회차를 «못 본다»"

echo ""
if [ "${POS:-0}" -gt 0 ] && [ "${NEG:-0}" = "0" ] && [ "$NEG_TRUNC" = "0" ]; then
  echo "✅ 복원된다 — 회차 $STAMP 의 logs.db 를 «1급 CLI»로 열었고, 그 내용이 업로드 시점의 것이다."
  exit 0
fi
# ⛔⭐ 「못 쟀다」를 «초록»으로 끝내지 않는다 — 이 저장소가 반복해 밟은 형태다.
[ "$NEG_TRUNC" = "1" ] && echo "⚪ 음성 판정을 «못 했다» — 상한 $LIMIT 에 닿았다. --limit 를 올리거나 창을 좁혀라."
[ "${POS:-0}" = "0" ] && [ "$POS_TRUNC" = "1" ] && echo "⚪ 양성 판정을 «못 했다» — 상한 $LIMIT 에 닿았다(⛔ 「빈 껍데기」가 아니다)."
echo "⛔ 복원 판정 «실패» — 위 두 줄을 읽어라. ⛔ 「백업 파일이 있다」로 대신 읽지 마라."
exit 1
