#!/usr/bin/env bash
#
# 3층(트리 파생) 판정의 뮤테이션 실증 — **머신 스위치 값과 무관함**을 재현한다.
#
# 왜: `test/instance-resolve.test.ts` 의 순수 리졸버 테스트는 `treeDerivedEnabled` 를 **주입**받으므로
#   머신 config 와 무관해야 한다. 그 주장을 말이 아니라 실행으로 증명한다 — 3층 판정을 무력화하면
#   스위치 ON/OFF **양쪽에서 동일한 수의 테스트가 실패**해야 한다.
#
# ⚠️ 이 스크립트가 조심하는 것 (실제로 내가 밟은 함정들):
#   1. 3층이 켜진 비-리더 트리에서 그냥 `elanous config set` 하면 `.elanous-test` 로 파생돼
#      **실효 스위치(~/.elanous/config.json)가 안 바뀐다.** → `--config-dir` 을 항상 명시한다.
#   2. 중단(Ctrl-C·실패)되면 소스가 변조된 채 남고 사용자 설정이 덮어씌워진다.
#      → 복원을 **멱등**으로 만들고 INT/TERM 은 복원 후 **즉시 종료**한다.
#   3. 복원이 실제로 됐는지 **검증**한다 — 안 보고 "복원 완료"를 찍으면 그게 더 위험하다.
#
# 사용:
#   bash scripts/verify-tree-derived-mutation.sh              # ON=OFF>0 만 단정(테스트 수 변화에 유연)
#   bash scripts/verify-tree-derived-mutation.sh 4            # 정확히 4 fail 이어야 함(엄격)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

EXPECT="${1:-}"                     # 비면 유연 모드
T=test/instance-resolve.test.ts
R=src/instance/resolve.ts
PROD_CFG="$HOME/.elanous"
BAK="$(mktemp "${TMPDIR:-/tmp}/resolve-ts.XXXXXX")"
ELANOUS=(bun bin/elanous.mjs)
RESTORED=0
RESTORE_FAILED=0

fails() { bun test "$T" 2>&1 | grep -Eo '^ *[0-9]+ fail' | grep -Eo '[0-9]+' | head -1; }
switch_now() { python3 -c "import json;print(json.load(open('$PROD_CFG/config.json')).get('instance',{}).get('treeDerivedTest'))" 2>/dev/null || echo None; }
set_switch() { "${ELANOUS[@]}" --config-dir "$PROD_CFG" config set instance.treeDerivedTest "$1" >/dev/null 2>&1; }
unset_switch() { "${ELANOUS[@]}" --config-dir "$PROD_CFG" config unset instance.treeDerivedTest >/dev/null 2>&1; }

# ⚠️ 전환은 **실효값으로 확인**한다(리뷰 must-fix 8R) — set 이 조용히 실패하면 ON/OFF 가 둘 다
#    안 바뀌어 "ON=OFF" 가 성립해버려 **거짓 성공**이 난다. 실제로 3층 파생 때문에 겪은 사고다.
set_switch_verified() {
  local want="$1" want_py
  set_switch "$want"
  case "$want" in true) want_py=True ;; *) want_py=False ;; esac
  local now; now="$(switch_now)"
  [ "$now" = "$want_py" ] || { echo "❌ 스위치 전환 실패 — 원한 값=$want_py · 실제=$now (config-dir=$PROD_CFG)"; return 1; }
}

ORIG="$(switch_now)"
cp "$R" "$BAK"

# ⚠️ **멱등** — EXIT 와 INT/TERM 이 겹쳐 두 번 불려도 안전해야 한다(백업을 지운 뒤 재호출되는 사고 방지).
restore() {
  [ "$RESTORED" = "1" ] && return 0
  RESTORED=1
  local ok=1
  # cp 가 실패하면 **백업을 지우지 않는다**(마지막 복구 수단을 잃지 않기 위해).
  if [ -f "$BAK" ]; then
    if cp "$BAK" "$R"; then
      cmp -s "$BAK" "$R" && rm -f "$BAK" || ok=0     # 백업과 **직접 비교**(git index 아님)
    else
      ok=0; echo "❌ 소스 복원 실패 — 백업 보존: $BAK"
    fi
  fi
  case "$ORIG" in
    True)  set_switch true  ;;
    False) set_switch false ;;
    *)     unset_switch ;;
  esac
  local now; now="$(switch_now)"
  [ "$now" = "$ORIG" ] || ok=0              # 스위치가 원상인지 **검증**
  if [ "$ok" = "1" ]; then
    echo "· 복원 확인 — 소스 원상 · 스위치=$now (원래 $ORIG)"
  else
    RESTORE_FAILED=1                        # ← 최종 exit code 에 **반영**된다
    echo "❌ 복원 불완전 — 소스 또는 스위치 불일치(현재=$now · 원래=$ORIG). 수동 확인 필요:"
    echo "   git diff -- $R ; ${ELANOUS[*]} --config-dir $PROD_CFG config get instance.treeDerivedTest"
  fi
}

# 복원 실패를 종료 코드로 전파 — 훼손된 채 exit 0 이 나오면 안 된다(must-fix 8R).
final_exit() { local rc="$1"; restore; [ "${RESTORE_FAILED:-0}" = "1" ] && rc=1; exit "$rc"; }
on_signal() { echo; echo "⚠️ 중단됨 — 복원 후 종료합니다"; restore; exit 130; }
trap restore EXIT
trap on_signal INT TERM

echo "원래 실효 스위치 = $ORIG"

# 기준선은 **명시로** ON 을 만든 뒤 잰다 — 머신 상태에 의존하지 않기 위해.
set_switch_verified true || final_exit 1
BASE="$(fails)"; BASE="${BASE:-0}"
echo "기준선(ON·뮤테이션 없음)          fail=$BASE"
[ "$BASE" = "0" ] || { echo "❌ 기준선이 0 이 아니다(=$BASE) — 뮤테이션 실증 불가"; final_exit 1; }

# 3층 판정 무력화. 치환이 실제로 먹었는지 **단정**한다(소스가 바뀌면 조용히 무효화되는 것을 막는다).
perl -0pi -e 's/if \(deps\.treeDerivedEnabled && derived\)/if (false \&\& derived)/' "$R"
grep -q 'if (false && derived)' "$R" || { echo "❌ 뮤테이션 치환 실패 — 대상 조건이 바뀌었다. 스크립트를 갱신하라"; final_exit 1; }

ON="$(fails)";  ON="${ON:-0}";  echo "뮤테이션 · 스위치 ON               fail=$ON"
set_switch_verified false || final_exit 1
OFF="$(fails)"; OFF="${OFF:-0}"; echo "뮤테이션 · 스위치 OFF(실효=$(switch_now))   fail=$OFF"

echo
rc=0
[ "$ON" != "0" ]     || { echo "❌ 뮤테이션이 아무것도 깨뜨리지 못했다(ON=0) — 가드가 실효 없음"; rc=1; }
[ "$ON" = "$OFF" ]   || { echo "❌ 머신 의존 — ON=$ON · OFF=$OFF 가 다르다"; rc=1; }
if [ -n "$EXPECT" ]; then
  [ "$ON" = "$EXPECT" ] || { echo "❌ 기대와 불일치 — expect=$EXPECT · 실제=$ON"; rc=1; }
fi
[ "$rc" = "0" ] && echo "✅ 머신 무관 실증 — 기준선 0 · ON/OFF 양쪽에서 동일하게 $ON fail"
final_exit "$rc"
