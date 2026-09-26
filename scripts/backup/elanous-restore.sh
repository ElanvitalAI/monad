#!/usr/bin/env bash
# elanous 운영 백업의 «자격 묶음»(secrets.tar.age)을 되돌린다 — elanous-backup.sh 의 짝.
#
#   bash scripts/backup/elanous-restore.sh --list                      묶음 안 항목 «이름»만 본다
#   bash scripts/backup/elanous-restore.sh --to ~/restore-check        폴더에 풀기만 한다(기본 · 홈을 안 덮는다)
#   bash scripts/backup/elanous-restore.sh --in-place                  원래 자리로 되돌린다(덮기 전 사본을 남긴다)
#   옵션: --from <s3://…/secrets.tar.age | 로컬 파일>   (기본: 이 호스트의 가장 최근 묶음)
#         --identity <identity.age>                    (기본: ~/.elanous/backup-key/identity.age · 없으면 S3 keys/ 에서 받는다)
#
# 🔑 여는 법: identity.age 는 passphrase 로 잠겨 있다 — age 가 tty 로 묻는다.
#    passphrase 는 macOS 키체인 `elanous-backup-passphrase` · AWS Secrets Manager `elanous/ops-backup/age-key` 에 있다.
#    ⚠️ 시험·무인 복원은 ELANOUS_BACKUP_IDENTITY_PLAIN=<평문 identity 파일> 로 passphrase 없이 연다(그 파일은 호출자가 지킨다).
# ⛔ 불변식: 평문 묶음은 mktemp -d(700) 안에서만 풀고 끝나면 지운다 · 출력에는 «이름과 바이트»만 — 내용은 안 낸다.
set -uo pipefail

SECRETS_BUCKET="${ELANOUS_BACKUP_SECRETS_BUCKET:-s3://elanvital-ops-backup}"
IDENTITY="${ELANOUS_BACKUP_IDENTITY:-$HOME/.elanous/backup-key/identity.age}"
IDENTITY_PLAIN="${ELANOUS_BACKUP_IDENTITY_PLAIN:-}"
FROM=""; TO=""; MODE=""
_prev=""
for a in "$@"; do
  case "$_prev" in
    --from) FROM="$a" ;;
    --to) TO="$a"; MODE=to ;;
    --identity) IDENTITY="$a" ;;
  esac
  case "$a" in
    --list) MODE=list ;;
    --in-place) MODE=inplace ;;
  esac
  _prev="$a"
done
[ -n "$MODE" ] || { echo "⛔ --list · --to <폴더> · --in-place 중 하나를 준다"; exit 2; }

AGE=""; for c in /opt/homebrew/bin/age /usr/local/bin/age "$(command -v age 2>/dev/null || true)"; do [ -n "$c" ] && [ -x "$c" ] && { AGE="$c"; break; }; done
[ -n "$AGE" ] || { echo "⛔ age 를 못 찾았다 (brew install age)"; exit 1; }
AWS=""; for c in "$(command -v aws 2>/dev/null || true)" /opt/homebrew/bin/aws /usr/local/bin/aws; do [ -n "$c" ] && [ -x "$c" ] && { AWS="$c"; break; }; done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/elanous-restore-XXXXXX")"; chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# ── 묶음 가져오기 ────────────────────────────────────────────────────────────
HOST="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
BUNDLE="$WORK/secrets.tar.age"
if [ -z "$FROM" ]; then
  [ -n "$AWS" ] || { echo "⛔ aws CLI 가 없다 — --from <로컬 파일> 을 준다"; exit 1; }
  LATEST="$("$AWS" s3 ls "$SECRETS_BUCKET/$HOST/" 2>/dev/null | awk '/PRE/{print $2}' | sort | tail -1)"
  [ -n "$LATEST" ] || { echo "⛔ $SECRETS_BUCKET/$HOST/ 에 회차가 없다"; exit 1; }
  FROM="$SECRETS_BUCKET/$HOST/${LATEST%/}/secrets.tar.age"
fi
case "$FROM" in
  s3://*) "$AWS" s3 cp "$FROM" "$BUNDLE" --only-show-errors || { echo "⛔ 받기 실패: $FROM"; exit 1; } ;;
  *) [ -f "$FROM" ] || { echo "⛔ 파일이 없다: $FROM"; exit 1; }; cp "$FROM" "$BUNDLE" ;;
esac
echo "📦 묶음: $FROM ($(wc -c < "$BUNDLE" | tr -d ' ') bytes)"

# ── 여는 열쇠 ────────────────────────────────────────────────────────────────
ID_ARGS=()
if [ -n "$IDENTITY_PLAIN" ]; then
  [ -f "$IDENTITY_PLAIN" ] || { echo "⛔ 평문 identity 가 없다: $IDENTITY_PLAIN"; exit 1; }
  ID_ARGS=(-i "$IDENTITY_PLAIN")
else
  if [ ! -f "$IDENTITY" ]; then
    [ -n "$AWS" ] || { echo "⛔ identity 도 aws 도 없다: $IDENTITY"; exit 1; }
    IDENTITY="$WORK/identity.age"
    "$AWS" s3 cp "$SECRETS_BUCKET/keys/identity.age" "$IDENTITY" --only-show-errors || { echo "⛔ identity 받기 실패"; exit 1; }
  fi
  ID_ARGS=(-i "$IDENTITY")
  echo "🔑 passphrase 를 묻는다(키체인 elanous-backup-passphrase · Secrets Manager elanous/ops-backup/age-key)"
fi

# ── 풀기: 평문은 $WORK 안에서만 ─────────────────────────────────────────────
PLAIN="$WORK/plain"; mkdir -p "$PLAIN"; chmod 700 "$PLAIN"
if ! "$AGE" -d "${ID_ARGS[@]}" "$BUNDLE" | tar -xf - -C "$PLAIN"; then
  echo "⛔ 복호화/풀기 실패 — passphrase·identity 를 확인한다"; exit 1
fi
N=0
while IFS= read -r f; do
  N=$((N+1)); printf "  %-64s %8s bytes\n" "${f#"$PLAIN"/}" "$(wc -c < "$f" | tr -d ' ')"
done < <(find "$PLAIN" -type f | sort)
echo "  (파일 $N 개)"

case "$MODE" in
  list) exit 0 ;;
  to)
    mkdir -p "$TO" || { echo "⛔ 폴더를 못 만든다: $TO"; exit 1; }
    # ⛔ `--to` 는 «홈을 안 덮는다» — 홈(또는 홈을 품은 상위)을 주면 거부한다(리뷰 must-fix · 2026-09-26).
    TO_REAL="$(cd "$TO" && pwd -P)"; HOME_REAL="$(cd "$HOME" && pwd -P)"
    case "$HOME_REAL/" in
      "$TO_REAL"/*) echo "⛔ --to 가 홈이거나 홈을 품는다($TO_REAL) — 홈에 되돌리려면 --in-place 를 쓴다"; exit 2 ;;
    esac
    chmod 700 "$TO" || { echo "⛔ 권한을 못 바꾼다: $TO"; exit 1; }
    ( cd "$PLAIN" && tar -cf - . ) | ( cd "$TO" && tar -xpf - ) || { echo "⛔ 옮기기 실패"; exit 1; }
    echo "✅ $TO 에 풀었다 — 홈은 건드리지 않았다. 확인 뒤 필요한 파일만 옮기거나 --in-place 를 쓴다."
    ;;
  inplace)
    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; KEPT=0; DONE=0; SKIPPED=0
    while IFS= read -r f; do
      rel="${f#"$PLAIN"/}"
      [ "$rel" = "machine-crontab.raw" ] && continue   # 크론은 사람이 보고 `crontab <파일>` 로 되돌린다
      dst="$HOME/$rel"
      # ⛔ 대상이 심볼릭 링크면(깨진 링크 포함) 건드리지 않는다 — cp 가 링크 «너머»를 사본 없이 덮을 수 있다(리뷰 must-fix).
      if [ -L "$dst" ]; then echo "  ⛔ 대상이 심볼릭 링크라 건너뛴다(손으로 확인): $rel"; SKIPPED=$((SKIPPED+1)); continue; fi
      if [ -e "$dst" ]; then
        # ⛔ 사본을 못 만들면 «덮지 않는다» — 되돌릴 길 없이 덮는 것이 이 모드의 유일한 위험이다(리뷰 must-fix).
        if cp -p "$dst" "$dst.pre-restore-$STAMP"; then KEPT=$((KEPT+1)); else
          echo "  ⛔ 사본 실패 — 건너뛴다: $rel"; SKIPPED=$((SKIPPED+1)); continue
        fi
      fi
      if mkdir -p "$(dirname "$dst")" && cp -p "$f" "$dst"; then DONE=$((DONE+1)); else
        echo "  ⛔ 되돌리기 실패: $rel"; SKIPPED=$((SKIPPED+1))
      fi
    done < <(find "$PLAIN" -type f)
    echo "원래 자리로 $DONE 개 되돌림 · 덮기 전 사본 $KEPT 개(*.pre-restore-$STAMP) · 실패 $SKIPPED 개"
    [ "$SKIPPED" -eq 0 ] || { echo "⛔ 일부를 못 되돌렸다 — 위를 읽어라"; exit 1; }
    echo "✅ 되돌렸다"
    if [ -f "$PLAIN/machine-crontab.raw" ]; then
      echo "  ⚠️ 크론 원문은 자동으로 안 되돌린다 — --to 로 풀어 보고 crontab <파일> 로 되돌린다"
    fi
    ;;
esac
exit 0
