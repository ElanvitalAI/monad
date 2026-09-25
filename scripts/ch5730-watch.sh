#!/bin/zsh
# ⛔ 이 파일은 «심(shim)» 이다 — 실체는 scripts/coord-channel-watch.sh 다.
#   이름의 「5730」은 «역사»다(그 채널은 2026-08-12 에 코멘트 2500 상한으로 «차단»됐다).
#   과거 HANDOFF·ROADMAP 문서가 이 경로를 명령으로 적어 두었으므로 «지우지 않는다».
#   ⇒ 새 창은 `scripts/coord-channel-watch.sh` 를 쓴다.
#
# ⛔⭐⭐ PATH 에 «아무것도» 기대지 않는다 (2026-08-26 실측 결함).
#   옛 판은 `$(dirname "$0")` 였다 — `dirname` 은 «외부 명령»이라 PATH 에 없으면 심이 죽는다.
#   📏 그 상태에서 test/ch5730-watch-delivery.test.ts 의 「lsof 가 없으면」 시험이
#      ***lsof 얘기를 꺼내기도 전에*** `dirname: command not found` 로 끝났다.
#   🔑 그런데 그 최소 PATH 야말로 이 도구가 «옳게 말해야 하는» 바로 그 환경이다 —
#      배달 판정기는 lsof 가 없을 때 「정상」이 아니라 「못 쟀다」고 말해야 한다.
#   ⇒ 디렉토리는 «셸 파라미터 확장»으로만 구한다(외부 프로세스 0개).
#   ⚠️ `$0` 에 슬래시가 없으면(PATH 로 불렸을 때) 잘라 낼 것이 없으므로 현재 디렉토리로 둔다.
if [[ "$0" == */* ]]; then
  exec "${0%/*}/coord-channel-watch.sh" "$@"
fi
exec "./coord-channel-watch.sh" "$@"
