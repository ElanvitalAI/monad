#!/usr/bin/env bash
# 도는 하니스 워크트리들이 «같은 파일»을 만지고 있는지 세는 자.
#
# ⛔ 왜 있나 (2026-08-31 🅢 142차 실물):
#   R-BR4 의 2초 검사는 ask 의 «선언된 대상 경로»를 대조한다:
#     grep -h '^대상 경로:' <askA> <askB> | tr '·' '\n' | sort | uniq -d
#   📏 그 검사가 내 골 둘에 «0건»(=안 만난다)을 냈는데, 둘 다 `src/mission-capabilities/registry.ts` 를
#      만지고 있었다. ***자식이 «선언 밖»으로 나갔고, 충돌 지점이 바로 그 선언 안 된 파일이었다.***
#   ⇒ 🔑 선언을 대조하는 검사는 「자식이 선언대로 한다」를 «전제»한다. 이 자는 그 전제를 안 쓴다 —
#      ***도는 워크트리의 실제 `git status` 를 본다.***
#
# ⛔⭐ 그리고 이 자는 «두 축»을 본다 — 하나만 보면 조용히 위음성이 난다:
#   ⓐ 작업 트리(`git status --porcelain`)      — 자식이 «아직 커밋 안 한» 것
#   ⓑ 커밋분(`git diff --name-only <merge-base>`) — 자식이 «이미 커밋한» 것
#   📏 2026-08-31 실측: 1판은 ⓐ 만 봤고, 자식들이 커밋한 «직후» 같은 자를 치니 ***「충돌 0」***이 나왔다.
#      ⛔ 그때 나는 그 충돌을 «눈으로 보고 있었다». ⇒ 알려진 양성이 그 위음성을 잡았다.
#
# ⛔ 이 자가 «못» 하는 것(산출에도 낸다):
#   ⓐ 아직 «안 만진» 파일은 못 본다 — 자식이 앞으로 만질 것은 미래다
#   ⓑ 「살아 있나」는 파일 mtime 으로 «추정»한다 — 임계는 인자로 주고 산출에 적는다
#   ⓒ 죽은 워크트리도 파일을 남긴다 ⇒ 임계를 넓히면 «옛 충돌»이 섞인다
#
# ⚠️ 이 셸의 `find` 는 bfs 다 — `-newermt '-90 minutes'` 를 «거부»한다(2026-08-31 실측).
#    그래서 나이는 `stat` 으로 «직접» 잰다. ⛔ 그 에러를 파이프가 삼키면 「0건」으로 보인다.
#
# 사용:  bash scripts/worktree-collisions.sh [최근_분]     (기본 120)
set -u
MINS="${1:-120}"
NOW=$(date +%s)
ROOTS=("$HOME/.monad/worktrees")

echo "📍 자리:  워크트리 뿌리 ${ROOTS[*]}"
echo "📍 시점:  $(date -u '+%Y-%m-%dT%H:%M:%SZ')  ·  임계: 바뀐 파일이 최근 ${MINS}분 안"
TMP=$(mktemp); SCANNED=0; LIVE=0; UNREADABLE=0
for base in "${ROOTS[@]}"; do
  [ -d "$base" ] || continue
  for d in "$base"/*/monad-agent.worktrees/*/; do
    [ -d "$d" ] || continue
    SCANNED=$((SCANNED+1))
    st=$(git -C "$d" status --porcelain 2>/dev/null) || { UNREADABLE=$((UNREADABLE+1)); continue; }
    # ⭐ 축 ⓑ — 이미 «커밋된» 것까지 본다. 이것이 없으면 자식이 커밋한 순간 충돌이 «사라져 보인다».
    mb=$(git -C "$d" merge-base HEAD origin/main 2>/dev/null)
    committed=""
    [ -n "$mb" ] && committed=$(git -C "$d" diff --name-only "$mb" 2>/dev/null)
    files=$(printf '%s\n%s\n' "$(printf '%s\n' "$st" | awk 'NF{print $NF}')" "$committed" | awk 'NF' | sort -u)
    [ -n "$files" ] || continue
    fresh=0
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      [ -f "$d$f" ] || continue
      m=$(stat -f '%m' "$d$f" 2>/dev/null) || continue
      if [ $(( (NOW - m) / 60 )) -le "$MINS" ]; then
        wt=$(basename "$d")
        # ⭐ 같은 골의 «재시도»는 워크트리 이름 끝의 -<8자리 hex> 만 다르다.
        #   ⛔ 그것을 안 벗기면 「한 골이 자기 자신과 충돌한다」가 나온다(2026-08-31 실측: 3연발이 그렇게 보였다).
        slug=$(printf '%s' "$wt" | sed -E 's/-[0-9a-f]{8}$//')
        fresh=1; printf '%s\t%s\t%s\n' "$f" "$slug" "$wt" >> "$TMP"
      fi
    done <<< "$files"
    [ "$fresh" = 1 ] && LIVE=$((LIVE+1))
  done
done
PAIRS=$(wc -l < "$TMP" | tr -d ' ')
echo "📏 훑은 워크트리 ${SCANNED} · 그중 «최근» ${LIVE} · 상태를 못 읽은 것 ${UNREADABLE}"
echo "📏 (파일,워크트리) 쌍 ${PAIRS}"
if [ "$SCANNED" = 0 ]; then
  echo "⛔ 워크트리를 «하나도» 못 찾았다 — 뿌리 경로를 확인하라. 「충돌 0」이 아니다."; rm -f "$TMP"; exit 2
fi
if [ "$PAIRS" = 0 ]; then
  echo "✅ 최근 ${MINS}분에 바뀐 파일이 «없다» — ⛔ 「충돌 없음」이 아니라 「도는 것이 없다」로 읽어라."; rm -f "$TMP"; exit 0
fi
# ⭐ 「둘 이상」은 «워크트리»가 아니라 ***«골 슬러그»*** 로 센다.
DUP=$(cut -f1,2 "$TMP" | sort -u | cut -f1 | sort | uniq -d)
TWINS=$(cut -f2,3 "$TMP" | sort -u | cut -f1 | sort | uniq -d | wc -l | tr -d ' ')
if [ -z "$DUP" ]; then
  echo "✅ 충돌 0 — 최근 ${LIVE}개 워크트리(«골» 기준)의 대상 경로 교집합이 비었다"
  [ "${TWINS:-0}" -gt 0 ] && echo "   ⚠️ 그중 ${TWINS}개 골은 «재시도 쌍둥이»가 있어 한 골로 묶어 셌다"
else
  echo "⚠️ 둘 이상이 «지금» 만지는 파일:"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    printf '   %s\n' "$f"
    awk -F'\t' -v f="$f" '$1==f{print "      · "$2}' "$TMP" | sort -u
  done <<< "$DUP"
  echo "⛔ 위 파일은 «착지 순서»가 결과를 바꾼다 — 먼저 착지한 쪽에 rebase 해 게이트를 다시 돌려라(R-BR4)."
  [ "${TWINS:-0}" -gt 0 ] && echo "   ⚠️ 재시도 쌍둥이가 있는 골 ${TWINS}개는 한 골로 묶어 셌다(같은 골의 두 시도는 «충돌이 아니다»)."
fi
rm -f "$TMP"
