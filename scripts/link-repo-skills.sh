#!/usr/bin/env bash
# ⛔⭐ 「저장소에 SKILL.md 가 있다」는 「그 스킬을 «부를 수 있다»」가 아니다.
#   로더는 `defaultSkillDirs()` 가 주는 곳(기본 ~/.claude/skills)만 읽는다. 저장소의 skills/ 는
#   «정본»이고 읽히는 자리는 심링크다(skills/README.md). 그 심링크는 «내 기계에만» 있었다.
#   📏 계기 2026-09-22 4차 리뷰 ①: PR 이 /video-builder 를 「배선했다」고 말했지만 diff 에는
#      재현 가능한 배선이 «없었다» — 새로 체크아웃한 기계에서는 그 슬래시가 아예 없다.
#
# ⛔⭐⭐ 이 자가 «묻는 것»은 「그 이름이 로더에 닿나」이지 「이 체크아웃을 가리키나」가 «아니다».
#   📏 1판은 뒤쪽을 물었고 11개 중 11개를 ⛔ 로 찍었다 — 실제로는 전부 «닿고 있었다»
#      (실물 디렉터리이거나, 다른 클론 source/elan/monad-agent 를 가리키는 링크였다).
#   ⇒ 남이 세워 둔 정본을 이쪽으로 «돌려놓는» 것은 운영 설정 변경이라 사람 몫이다. 건드리지 않는다.
#
# 사용: bash scripts/link-repo-skills.sh [--check]
#   (인자 없음) 목적지에 «없는» 이름만 잇는다(멱등 · 있는 것은 절대 덮지 않는다)
#   --check     걸지 않고 «지금 닿나»만 재고, 하나라도 안 닿으면 exit 1
set -u
CHECK=0
# ⛔ 5차 리뷰 — 임의 인자를 «조용히 링크 모드»로 처리했다. 배선 도구가 모르는 말을 삼키면 안 된다.
# ⛔⭐⭐ 21차 리뷰 — 기본이 ***저장소의 «모든» 스킬을 사람 홈에 링크***했다.
#   그것은 「슬래시 하나 배선」보다 훨씬 넓은 ***운영 변경***이고, 이 저장소의 규율상
#   ***운영 설정 변경은 사람이 «명시»할 때만*** 한다. ⇒ 기본을 좁힌다.
#   사용: link-repo-skills.sh <이름> | --all | --check [이름]
ONLY=""
case "${1:-}" in
  '')       echo "⛔ 무엇을 이을지 대라 — 사용: $0 <이름> | --all | --check [이름]"; exit 2 ;;
  --all)    if [ "$#" -gt 1 ]; then echo "⛔ --all 에는 인자를 더 주지 않는다"; exit 2; fi ;;
  --check)  CHECK=1; ONLY="${2:-}"
            if [ "$#" -gt 2 ]; then echo "⛔ 사용: $0 --check [이름]"; exit 2; fi ;;
  --*)      echo "⛔ 모르는 인자 '$1' — 사용: $0 <이름> | --all | --check [이름]"; exit 2 ;;
  *)        ONLY="$1"
            if [ "$#" -gt 1 ]; then echo "⛔ 이름은 하나까지다 — 여러 개는 --all"; exit 2; fi ;;
esac

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ELANOUS_SKILLS_DIR:-$HOME/.claude/skills}"
rc=0
count=0
linked=0
elsewhere=0

for d in "$REPO"/skills/*/; do
  name="$(basename "$d")"
  [ -f "$d/SKILL.md" ] || continue
  # ⛔ 이름을 댔으면 그것만 본다 — 남의 스킬을 «덤으로» 건드리지 않는다.
  if [ -n "$ONLY" ] && [ "$name" != "$ONLY" ]; then continue; fi
  count=$((count + 1))
  link="$DEST/$name"

  if [ -f "$link/SKILL.md" ]; then
    tgt="$(cd "$link" 2>/dev/null && pwd -P || echo '?')"
    if [ "$tgt" = "$(cd "$d" && pwd -P)" ]; then
      echo "  ✅ $name — 닿는다(이 체크아웃)"
    else
      # ⛔ 다른 정본이 이미 그 이름을 쥐고 있다. 닿기는 «닿는다» — 실패가 아니다.
      echo "  ➖ $name — 닿는다(다른 정본: $tgt) · 손대지 않는다"
      elsewhere=$((elsewhere + 1))
    fi
    continue
  fi

  if [ -e "$link" ]; then
    echo "  ⛔ $name — $link 가 있는데 SKILL.md 가 «없다» — 사람이 볼 일이다"
    rc=1
    continue
  fi

  if [ "$CHECK" = "1" ]; then
    echo "  ⛔ $name — 안 닿는다(이 기계에서는 그 스킬이 «없다»)"
    rc=1
    continue
  fi

  # ⛔⭐ 5차 리뷰 — 이 스크립트가 «자기 소스 안»에 링크를 만들었다(skills/video-builder/video-builder).
  #   BSD `ln -sfn` 은 목적지가 «디렉터리를 가리키는 심링크»면 그 안으로 들어갈 수 있다.
  #   ⇒ ⑴ 심링크로 남아 있는 것은 «먼저 지우고» ⑵ 만든 뒤 «어디를 가리키나»를 되읽어 확인한다.
  mkdir -p "$DEST"
  if [ -L "$link" ]; then rm -f "$link"; fi
  if ln -s "${d%/}" "$link" && [ "$(readlink "$link")" = "${d%/}" ]; then
    echo "  🔗 ${name} — 이었다"; linked=$((linked + 1))
  else
    echo "  ⛔ ${name} — 링크 실패(또는 엉뚱한 곳): $(readlink "$link" 2>/dev/null || echo '(없음)')"
    rc=1
  fi
  # ⛔ 되읽기 관문 — 정본 «안»에 생겼으면 그 자리에서 잡는다(2026-09-22 에 실제로 생겼다).
  if [ -e "${d%/}/${name}" ]; then
    echo "  ⛔ ${name} — 정본 «안»에 ${name} 이 생겼다(재귀 링크) — 지운다"
    rm -f "${d%/}/${name}"; rc=1
  fi
done

if [ "$count" = "0" ]; then
  # ⛔ 「0건」을 「전부 통과」로 읽지 않는다.
  if [ -n "$ONLY" ]; then echo "⛔ '$ONLY' 라는 스킬이 $REPO/skills 에 없다"
  else echo "⛔ skills/*/SKILL.md 를 «하나도» 못 찾았다 — 경로가 틀렸거나 이 스크립트가 낡았다: $REPO/skills"; fi
  exit 2
fi

# ⛔ bash 3.2 는 «$var 뒤에 한글»이 오면 그 한글을 «변수 이름»으로 먹는다("$count개" ⇒ unbound).
#   📏 실측 2026-09-22: 이 줄이 `count\xef: unbound variable` 로 죽어 요약이 «통째로» 사라졌다.
#   ⇒ 한글이 붙는 자리는 반드시 ${var} 로 끊는다.
echo "📏 정본 ${count}개 · 새로 이음 $linked · 다른 정본 $elsewhere · 목적지 $DEST"
[ "$rc" = "0" ] && echo "✅ 전 이름이 로더에 닿는다"
exit $rc
