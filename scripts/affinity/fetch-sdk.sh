#!/usr/bin/env bash
# 📚 Affinity SDK 원문을 «통째로» 로컬에 받는다 — 대표 제안 2026-09-22.
#
# ⛔⭐ ***저장소에 넣지 않는다.*** 서드파티 문서이고 이 저장소는 공개 배포를 향한다.
#   ⇒ 기본 목적지 = **`~/docs/ref/affinity-sdk`** (대표 지시 2026-09-22).
#     *"~/source/ref 에 repo 를 놔두는 것처럼 ~/docs 아래 ref 에 문서들을 받아두는게 어떨까요"*
#     📌 짝: `~/source/ref/<레포>` = 외부 «코드» · `~/docs/ref/<이름>` = 외부 «문서»
#   ⛔ 종전 기본값은 드라이버(`aff.py`) 옆이었다 — 그러면 «자리»가 아니라 «부속»이 되어
#      그 도구를 쓰는 사람만 찾는다. 규율은 `~/내부 문서 `README``.
#
# 🔑 왜 통째로 받나 — 이름을 «다섯 번» 틀린 날 얻은 결론:
#   /selection.js(복수형) · /filesystem.js(/fs.js) · getChildNodes()(children)
#   · getBoundsInSpread()(getSpreadBaseBox) · createSetGaussianBlurLayerEffect(…Radius)
#   ⚠️ 마지막 하나는 ***SDK 힌트가 준 이름***이었다 — 힌트도 틀린다.
#   ⇒ ***이름을 세 번 틀리면 「묻는 비용」보다 「전부 받는 비용」이 싸다.***
#
# 종료코드: 0 받았다 · 1 실패 · 2 ***못 쟀다***(Affinity 가 안 떠 있다 — 실패가 «아니다»)
set -u
AFF="${AFF_PY:-$HOME/obsidian/ElanvitalAI/30. Permanent Notes/35. Creator/Tools/affinity/aff.py}"
OUT="${1:-$HOME/docs/ref/affinity-sdk}"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:6767/sse 2>/dev/null || true)
if [ "$code" != "200" ]; then
  echo "⚠️ Affinity MCP 에 «못 붙었다»(http_code='${code:-없음}') — 앱이 떠 있고 EnableMCPServer 가 켜져야 한다" >&2
  exit 2
fi
mkdir -p "$OUT" || exit 1
topics=$(python3 "$AFF" docs 2>/dev/null | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$')
[ -n "$topics" ] || { echo "⛔ 문서 목록이 «비었다» — 받을 것이 없다" >&2; exit 1; }
n=0; ok=0
for t in $topics; do
  n=$((n + 1))
  # ⛔ 이름에 '/' 가 든다(examples/… · tests/…) — 그대로 쓰면 없는 디렉토리를 찾는다
  python3 "$AFF" doc "$t" > "$OUT/$(printf '%s' "$t" | tr '/' '_')" 2>/dev/null && ok=$((ok + 1))
done
# ⛔ 「몇 편 시도했고 몇 편 받았나」를 «둘 다» 낸다 — 성공 수만 내면 빠진 것이 안 보인다
# ⛔ 규율 ③ — «판»을 적는다. 문서는 코드보다 빨리 늙고, 늙은 줄 모르고 인용하면 조용히 틀린다.
VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  /Applications/Affinity.app/Contents/Info.plist 2>/dev/null || echo unknown)
printf 'source: Affinity 내장 MCP (read_sdk_documentation_topic)\napp_version: %s\nfetched: %s\ntopics: %s/%s\nrefetch: bash <monad>/scripts/affinity/fetch-sdk.sh\n' \
  "$VER" "$(date '+%Y-%m-%d %H:%M %Z')" "$ok" "$n" > "$OUT/MANIFEST.txt"
echo "📚 시도 $n · 받음 $ok · 못 받음 $((n - ok))  ·  판 $VER  →  $OUT"
[ "$ok" -gt 0 ] || exit 1
exit 0
