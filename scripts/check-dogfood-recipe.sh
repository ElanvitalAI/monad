#!/usr/bin/env bash
# ⛔⭐⭐ 레벨 측정 시험지(§2-7)의 **판정 레시피가 그대로 복사해 실행 가능한지** 검사한다.
#
# 왜 필요한가: `bash -n`(문법 검사)은 **정의 전 호출**을 못 잡는다. 실제로 이 문서의 레시피가
# `plog` 를 정의보다 먼저 불렀고, 나는 `bash -n` 통과를 근거로 *"복사 실행 가능"* 을 주장했다
# (무인 리뷰 10R 이 잡았다). ⇒ **새 셸에서 순서대로 실행**해야 그 결함이 드러난다.
#
# 사용:  bash scripts/check-dogfood-recipe.sh            # 검사
#        bash scripts/check-dogfood-recipe.sh --self-test # ⭐ 음성 대조까지(검사기가 유효한지)
set -uo pipefail
DOC="${DOC:-docs/system/DOGFOOD-capability-level-scenarios-l2-l3-2026-07-28.md}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# 문서의 마지막 ```bash 블록(=판정 레시피)을 뽑는다.
python3 - "$DOC" "$WORK/recipe.sh" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
blocks = re.findall(r'```bash\n(.*?)```', src, re.S)
if not blocks:
    sys.exit('레시피 블록을 못 찾았다')
body = blocks[-1]
body = '\n'.join(l[3:] if l.startswith('   ') else l for l in body.split('\n'))
open(sys.argv[2], 'w').write(body)
PY

# `monad`·`bun`·`jq` 는 스텁으로 둔다 — 재는 것은 **정의-호출 순서**이지 데이터가 아니다.
mkdir -p "$WORK/stub"
# ⛔ 스텁은 **stdin 을 읽지 않는다** — `cat` 을 쓰면 파이프에서 입력을 기다려 **검사가 멈춘다**(실측).
for c in monad bun jq; do printf '#!/bin/sh\nexit 0\n' > "$WORK/stub/$c"; chmod +x "$WORK/stub/$c"; done

run_recipe() {
  # ⛔ 시간 상한 — 레시피가 무언가를 기다리면 검사가 영영 안 끝난다(멈춤도 결함이다).
  PATH="$WORK/stub:/usr/bin:/bin" bash "$1" </dev/null 2>&1 &
  local pid=$!
  ( sleep 20; kill -9 "$pid" 2>/dev/null ) & local killer=$!
  wait "$pid" 2>/dev/null
  kill "$killer" 2>/dev/null
}

fail=0
if out=$(run_recipe "$WORK/recipe.sh" | grep -iE "command not found|unbound variable|syntax error"); [ -n "$out" ]; then
  echo "⛔ 레시피가 새 셸에서 깨진다:"; printf '%s\n' "$out"; fail=1
else
  echo "✅ 레시피가 새 셸에서 순서대로 실행된다(정의 전 호출 없음)"
fi

if [ "${1:-}" = "--self-test" ]; then
  # ⭐ 음성 대조 — `plog` 정의를 첫 호출 뒤로 옮기면 검사가 **잡아야** 한다.
  python3 - "$WORK/recipe.sh" "$WORK/broken.sh" <<'PY'
import sys
lines = open(sys.argv[1]).read().split('\n')
d = [i for i, l in enumerate(lines) if l.startswith('plog()')]
u = [i for i, l in enumerate(lines) if 'plog ' in l or 'plog\n' in l or l.strip().startswith('RUN_ID=')]
if not d or not u:
    sys.exit('음성 대조를 만들 수 없다 — plog 정의나 호출을 못 찾았다')
defn = lines.pop(d[0])
lines.append(defn)                      # 정의를 맨 뒤로
open(sys.argv[2], 'w').write('\n'.join(lines))
PY
  if out=$(run_recipe "$WORK/broken.sh" | grep -iE "command not found|unbound variable|syntax error"); [ -n "$out" ]; then
    echo "✅ 음성 대조 통과 — 정의를 뒤로 옮기니 검사가 잡는다:"; printf '%s\n' "$out" | head -2
  else
    echo "⛔ 음성 대조 실패 — 이 검사기는 무효다(결함을 만들어도 0을 낸다)"; fail=1
  fi
fi
exit $fail
