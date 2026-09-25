#!/bin/bash
# coord-post.sh — 조율 채널 발신 «한 자리». 시각과 명시적 값을 본문에 안전하게 넣는다.
# 사용: scripts/coord-post.sh [--set KEY=VALUE]... <본문파일>
set -u
CANON="docs/manual/MANUAL-multi-agent-coordination-channel-2026-07-28.md"

resolve_pr() {
  [ -f "$CANON" ] || return 0
  head -40 "$CANON" | grep -oE '현재 채널 = \[PR #[0-9]+\]' | grep -oE '[0-9]+' | head -1
}

SETS=()
while [ "${1:-}" = "--set" ]; do
  [ "$#" -ge 2 ] || { echo "⛔ --set 은 KEY=VALUE 값이 필요하다" >&2; exit 2; }
  case "$2" in
    *=*) ;;
    *) echo "⛔ --set 값은 KEY=VALUE 형태여야 한다(받은 값: $2)" >&2; exit 2 ;;
  esac
  KEY=${2%%=*}
  case "$KEY" in
    [A-Za-z_]*) ;;
    *) echo "⛔ --set KEY 는 영문자 또는 밑줄로 시작하고 영문자·숫자·밑줄만 쓸 수 있다(받은 값: $KEY)" >&2; exit 2 ;;
  esac
  case "$KEY" in
    *[!A-Za-z0-9_]*) echo "⛔ --set KEY 는 영문자 또는 밑줄로 시작하고 영문자·숫자·밑줄만 쓸 수 있다(받은 값: $KEY)" >&2; exit 2 ;;
  esac
  [ "$KEY" != "TS" ] || { echo "⛔ {{TS}} 는 자동 시각 자리표시다 — --set TS 는 쓸 수 없다" >&2; exit 2; }
  SETS+=("$2")
  shift 2
done

PR="${CH_PR:-$(resolve_pr)}"
if [ -z "$PR" ]; then
  echo "⛔ 채널 번호를 못 읽었다 — $CANON 머리말의 «현재 채널 = [PR #NNNNN]» 줄을 확인하거나 CH_PR 로 준다" >&2
  exit 3
fi

BODY="${1:-}"
[ -n "$BODY" ] && [ -f "$BODY" ] || { echo "⛔ 본문 파일이 필요하다: $0 <파일>" >&2; exit 2; }
grep -q '{{TS}}' "$BODY" || echo "⚠️ 본문에 {{TS}} 자리표시가 «없다» — 시각을 손으로 적지 않았는지 확인하라" >&2

# 트랙 신원은 «정본 한 곳»에서 읽는다 — scripts/coord-tracks.json. 못 읽으면 추측하지 않고 선다.
TRACKS_FILE="$(dirname "$0")/coord-tracks.json"
TRACKS=$(grep -o '"id": *"[A-Z]"' "$TRACKS_FILE" 2>/dev/null | grep -o '[A-Z]"$' | tr -d '"\n')
[ -n "$TRACKS" ] || { echo "⛔ 트랙 정본을 읽지 못했다: $TRACKS_FILE — 발신하지 않는다" >&2; exit 4; }
ID="${COORD_ID:-S}"
if [ "${#ID}" -ne 1 ] || [ "${TRACKS#*"$ID"}" = "$TRACKS" ]; then
  echo "⛔ COORD_ID 는 트랙 정본($TRACKS_FILE)의 신원 [$TRACKS] 중 하나여야 한다(받은 값: $ID)" >&2; exit 4
fi
FIRST=$(head -1 "$BODY")
case "$FIRST" in
  "**[$ID]**"*) ;;
  \*\*\[[$TRACKS]\]\*\**)
    echo "⛔ 신원 접두가 «내 것이 아니다» — 첫 줄이 ${FIRST%%\*\* *}** 로 시작한다(내 신원 = [$ID])." >&2
    echo "   ⛔ 감시자는 startswith 로 고른다 ⇒ 상대는 이 글을 «자기 글»로 보고 건너뛴다. 발신하지 않는다." >&2
    echo "   ✅ 수신자는 본문에 적어라: **[$ID]** … [T] 님께 …" >&2
    exit 5 ;;
  *)
    echo "⛔ 첫 줄이 «**[$ID]**» 신원 접두로 시작하지 않는다 — 상대 감시자가 이 글을 못 고른다. 발신하지 않는다." >&2
    exit 5 ;;
esac

TS=$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M KST')
TMP=$(mktemp "${TMPDIR:-/tmp}/coord-post.XXXXXX") || { echo "⛔ mktemp 실패 — 발신하지 않는다" >&2; exit 7; }
DATA=$(mktemp "${TMPDIR:-/tmp}/coord-post-data.XXXXXX") || { rm -f "$TMP"; echo "⛔ mktemp 실패 — 발신하지 않는다" >&2; exit 7; }
OUT_FILE=$(mktemp "${TMPDIR:-/tmp}/coord-post-out.XXXXXX") || { rm -f "$TMP" "$DATA"; echo "⛔ mktemp 실패 — 발신하지 않는다" >&2; exit 7; }
cleanup() { rm -f "$TMP" "$DATA" "$OUT_FILE"; }
trap cleanup EXIT

# Values travel as NUL-delimited data, never as interpreter environment variables.
printf '%s\0%s\0' TS "$TS" > "$DATA"
for SET in "${SETS[@]-}"; do
  KEY=${SET%%=*}
  VALUE=${SET#*=}
  printf '%s\0%s\0' "$KEY" "$VALUE" >> "$DATA"
done

# Substitute placeholders from the original template once. A value containing {{OTHER}}
# remains literal and is caught by the final unresolved-placeholder guard.
if ! perl -0 -e '
  my ($data_path, $template_path) = @ARGV;
  open my $data, "<:raw", $data_path or die "cannot read substitution data: $!\n";
  local $/;
  my @parts = split /\0/, <$data>, -1;
  pop @parts;
  die "invalid substitution data\n" if @parts % 2;
  my %values;
  while (@parts) {
    my $key = shift @parts;
    my $value = shift @parts;
    $values{$key} = $value;
  }
  open my $template, "<:raw", $template_path or die "cannot read template: $!\n";
  my $body = <$template>;
  $body =~ s/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/exists $values{$1} ? $values{$1} : $&/ge;
  print $body;
' "$DATA" "$BODY" > "$OUT_FILE"; then
  echo "⛔ 본문 치환 실패 — 발신하지 않는다" >&2
  exit 1
fi
mv "$OUT_FILE" "$TMP" || { echo "⛔ 본문 치환 실패 — 발신하지 않는다" >&2; exit 1; }

# Read the whole body: placeholders spanning a newline or containing braces are unresolved too.
UNRESOLVED=$(perl -0 -ne 'while (/\{\{.*?\}\}/gs) { print "$&\n" }' "$TMP") || {
  echo "⛔ 자리표시자 검사 실패 — 발신하지 않는다" >&2
  exit 1
}
if [ -n "$UNRESOLVED" ]; then
  printf '⛔ 치환되지 않은 자리표시가 남았다: %s — 발신하지 않는다\n' "$UNRESOLVED" >&2
  exit 1
fi

[ -n "${COORD_POST_SELFTEST_EMPTY:-}" ] && : > "$TMP"
if [ ! -s "$TMP" ]; then
  echo "⛔ 본문이 «비었다»(0바이트) — 발신하지 않는다. 원본: $BODY ($(wc -c < "$BODY" 2>/dev/null || echo '?')바이트)" >&2
  exit 6
fi

echo "[coord-post] 채널 #$PR · 신원 [$ID] · 시각 $TS" >&2
if [ "${COORD_DRY_RUN:-}" = "1" ]; then
  cat "$TMP"
  exit 0
fi

POST_OUTPUT=$(bun bin/monad.mjs gh pr comment "$PR" --body-file "$TMP" 2>&1)
RC=$?
printf '%s\n' "$POST_OUTPUT" | tail -2
if [ "$RC" -ne 0 ]; then
  echo "⛔ 발신 실패 rc=$RC — «보냈다고 읽지 마라»" >&2
  exit "$RC"
fi
echo "[coord-post] 발신 성공 · 채널 #$PR · 신원 [$ID] · 시각 $TS" >&2
