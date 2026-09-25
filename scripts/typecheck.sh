#!/usr/bin/env bash
# ⛔⭐⭐ 「타입 통과」를 말하기 «전에» ***tsc 가 실제로 돌았나***를 먼저 본다.
#
# 🩸 계기 2026-09-22: 워크트리에 `node_modules` 가 없어 tsc 가 «첫 줄에서» 멈췄다:
#      error TS2688: Cannot find type definition file for 'bun-types'
#    ⇒ 파일별 오류가 «한 줄도» 안 나왔고, 나는 그것을 ***스물몇 번 「타입 통과」로 읽었다.***
#    ⛔ 「0건」의 가장 흔한 뜻은 「깨끗하다」가 아니라 ***「검사를 안 했다」***다.
#
# 종료코드: 0 통과 · 1 타입 오류 · 2 ***검사를 못 했다***(실패와 «다른 값»이다)
set -u
OUT=$(mktemp)
npx tsc --noEmit -p tsconfig.json > "$OUT" 2>&1
RC=$?

# ⛔ 「못 쟀다」를 «먼저» 가른다 — 이것이 통과로 읽히면 관문이 사라진다.
if grep -qE 'error TS(2688|5083|6053)' "$OUT"; then
  echo "⛔ tsc 가 «검사를 시작도 못 했다» — 아래가 이유다:"
  grep -E 'error TS(2688|5083|6053)' "$OUT" | head -3
  echo "   ⇒ 이 트리에서 'bun install' 을 먼저 하라(워크트리는 node_modules 를 «안 물려받는다»)."
  echo "   ⛔ 이것은 「타입 오류 0」이 «아니다». 「못 쟀다」다."
  rm -f "$OUT"; exit 2
fi

N=$(grep -cE 'error TS' "$OUT" || true)
if [ "${1:-}" = "--all" ]; then
  [ "$N" -gt 0 ] && { grep -E 'error TS' "$OUT" | head -40; rm -f "$OUT"; exit 1; }
  echo "✅ 타입 오류 0 (전수)"; rm -f "$OUT"; exit 0
fi

# 기본은 «내가 만진 축»만 — 저장소에는 다른 트랙의 기존 오류가 있다.
#
# ⛔⭐⭐ 종전 기본값은 손으로 적은 `video-pipeline|video-free-line` 이었다. ***그것이 늙었다.***
#   🩸 2026-09-22 실측: 그 사이에 `scripts/video-full-line.ts` 가 생겼는데 이 패턴이 «안 물어서»,
#      그 파일을 고치고 돌린 게이트가 ***초록인데 그 파일을 한 줄도 안 봤다.***
#   ⇒ 🔑 ***범위를 손으로 적으면 새 파일이 생길 때마다 조용히 사각지대가 늘어난다.***
#      ⇒ 범위를 «변경 파일»에서 «그때» 만든다.
if [ $# -ge 1 ]; then
  SCOPE="$1"                                   # 명시가 있으면 그것이 이긴다
  SCOPE_SRC="인자"
else
  BASE=$(git merge-base origin/main HEAD 2>/dev/null)
  # ⛔ 기준점을 못 잡으면 «좁은 범위로 조용히 통과»시키지 않는다 — 그것이 가짜 초록의 정체다.
  if [ -z "$BASE" ]; then
    echo "⛔ 기준 커밋(merge-base origin/main HEAD)을 «못 잡았다» — 무엇이 내 변경인지 모른다."
    echo "   ⇒ 'git fetch origin main' 을 먼저 하거나, 범위를 인자로 명시하라."
    echo "   ⛔ 이것은 「타입 오류 0」이 «아니다». 「못 쟀다」다."
    rm -f "$OUT"; exit 2
  fi
  CHANGED=$(git diff --name-only "$BASE" HEAD -- '*.ts' '*.tsx'; git diff --name-only -- '*.ts' '*.tsx'; git ls-files -o --exclude-standard -- '*.ts' '*.tsx')
  CHANGED=$(printf '%s\n' "$CHANGED" | sort -u | grep -v '^$' || true)
  if [ -z "$CHANGED" ]; then
    echo "📏 tsc 총 오류 ${N} · 내 변경 .ts 파일 0개 ⇒ 볼 것이 «없다»"
    rm -f "$OUT"; exit 0
  fi
  # ⛔ 파일명을 정규식 특수문자 없이 «그대로» 잇는다.
  SCOPE=$(printf '%s\n' "$CHANGED" | sed 's/[.[\*^$()+?{}|]/\\&/g' | paste -sd'|' -)
  SCOPE_SRC="변경 파일 $(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ')개"
fi

MINE=$(grep -E 'error TS' "$OUT" | grep -cE "$SCOPE" || true)
echo "📏 tsc 총 오류 ${N} · 그중 «내 범위»(${SCOPE_SRC}) ${MINE}"

# ⛔⭐ ***게이트는 「자기가 못 본 것」을 말해야 한다*** — 안 말하면 초록이 「깨끗하다」로 읽힌다.
OTHER=$(grep -E 'error TS' "$OUT" | grep -vE "$SCOPE" | sed 's/(.*//' | sort -u || true)
OTHER_N=$(printf '%s\n' "$OTHER" | grep -cv '^$' || true)
if [ "$OTHER_N" -gt 0 ]; then
  echo "   ⚠️ 이 게이트가 «안 본» 파일 ${OTHER_N}개(다른 트랙의 기존 오류):"
  printf '%s\n' "$OTHER" | head -5 | sed 's/^/      /'
fi

if [ "$MINE" -gt 0 ]; then grep -E 'error TS' "$OUT" | grep -E "$SCOPE" | head -20; rm -f "$OUT"; exit 1; fi
rm -f "$OUT"; exit 0
