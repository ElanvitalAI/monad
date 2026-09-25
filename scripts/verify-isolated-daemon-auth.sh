#!/usr/bin/env bash
# 격리 데몬이 «격리 토큰»으로 인증하나 — #15780(OBS-T413) 의 실물 검증 한 줄.
#
# ⛔ 왜 있나(2026-09-07 · 🅣 142차):
#   #15780 이 readAcpToken() 을 인스턴스 뿌리로 옮겼는데, ***도는 데몬은 부팅 시점 코드***라
#   재시작 전에는 여전히 운영 토큰을 읽는다. 그 상태에서 앱이 401 을 받으면
#   ***「앱 결함」으로 오독하기 쉽다.*** 이 스크립트가 그 오독을 막는다.
#
# ⛔ 그리고 「0」과 「못 물었다」를 다른 값으로 낸다 — health 가 안 되면 인증을 «판정하지 않는다».
set -u
PORT="${1:-31421}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKF="$ROOT/.monad-test/acp-token"

echo "== 격리 데몬 인증 검증 (port $PORT)"

if [ ! -f "$TOKF" ]; then
  echo "⛔ 격리 토큰 파일이 «없다»: $TOKF"
  echo "   ⇒ 이 우주는 인증 없이(noAuth) 뜨는 설계다 — 401 이 나오면 그것은 «다른 원인»이다."
  exit 2
fi
TOK="$(tr -d '\n' < "$TOKF")"
echo "   격리 토큰 앞8: ${TOK:0:8}"

H="$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "http://127.0.0.1:$PORT/v1/health" 2>/dev/null)"
echo "   /v1/health   → $H"
if [ "$H" != "200" ]; then
  echo "⛔ 데몬이 «안 뜬다» ⇒ 인증은 «판정하지 않는다»(「실패」가 아니라 「못 물었다」)."
  exit 2
fi

S="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Authorization: Bearer $TOK" "http://127.0.0.1:$PORT/v1/sessions/store" 2>/dev/null)"
echo "   /v1/sessions/store (격리 토큰) → $S"

case "$S" in
  200) echo "✅ 격리 토큰이 «먹는다» — 이 데몬은 #15780 «이후» 코드다."
       echo "   ⇒ 앱이 401 을 받으면 그것은 «앱/설정» 쪽이다."
       exit 0 ;;
  401) echo "🚨 401 — 이 데몬은 #15780 «이전» 코드다(부팅 시점 코드를 쓴다)."
       echo "   ⇒ ⛔ 앱 결함으로 «오독하지 마라». 격리 데몬을 재시작하면 풀린다."
       echo "   ⚠️ 재시작 «전»에 monad config get global.nexus.pwa.shareTailnet 을 봐라 —"
       echo "      enabled 면 기동이 Tailscale Serve 를 «자동 발화»한다(끄는 플래그가 없다)."
       exit 1 ;;
  *)   echo "⚠️ 예상 밖 코드 $S — 「인증 실패」로 접지 마라. 그 코드 자체를 읽어라."
       exit 3 ;;
esac
