#!/bin/zsh
# Higgsfield Bridge MCP 도구를 한 번 부른다 — 사람이 손으로 확인할 때 쓰는 최소 창구.
#
# 사용:  scripts/higgsfield-bridge-call.sh <tool> <json-args-file|->
# 예:    echo '{}' | scripts/higgsfield-bridge-call.sh bl_get_scene_summary -
#        jq -Rs '{code:.}' build.py | scripts/higgsfield-bridge-call.sh bl_execute -
#
# ⛔ 이것은 «진단용»이다. 운영 경로는 elanous 의 MCP 클라이언트다
#    (`elanous mcp diagnose|call`). 이 스크립트는 그 클라이언트가 붙기 «전»이나
#    붙은 뒤 사람이 한 번 눌러 볼 때만 쓴다.
# ⛔ 토큰은 auth.json 에서 읽는다 — 인자로 받지 않는다(셸 이력에 남지 않게).
set -u
ROOT="${ELANOUS_INSTANCE_ROOT:-$(cd "$(dirname "$0")/.." && pwd)/.elanous-test}"
AUTH="$ROOT/auth.json"
ISSUER="https://clerk.higgsfield.ai"
[ -f "$AUTH" ] || { echo "⛔ auth.json 없음: $AUTH — 'elanous mcp login higgsfield-bridge' 를 먼저" >&2; exit 2; }
TOK=$(jq -r --arg i "$ISSUER" '.providers[$i].tokens.accessToken // empty' "$AUTH")
[ -n "$TOK" ] || { echo "⛔ $ISSUER 자격증명 없음 — 'elanous mcp login higgsfield-bridge'" >&2; exit 2; }
TOOL="${1:?tool name required}"; SRC="${2:--}"
ARGS=$(cat "$SRC")
REQ=$(jq -nc --arg n "$TOOL" --argjson a "$ARGS" \
  '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$n,arguments:$a}}')
printf '%s' "$REQ" | curl -sS --max-time 180 -X POST https://bridge.higgsfield.ai/mcp \
  -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' --data-binary @- \
 | sed 's/^data: //' | jq -r '.result.content[]?.text // .error.message // "(no content)"'
