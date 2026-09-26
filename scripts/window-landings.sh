#!/usr/bin/env bash
# 창 착지를 «세는 자» — ⛔ 매번 손으로 타자하지 마라.
#
# 📏 2026-08-31 실측(이 스크립트가 있는 이유):
#   🅢 가 같은 물음에 「18 → 13 → 15」 세 값을 냈고, 🅣 도 「97 · 114 · 106」 세 값을 냈다.
#   ⛔ 자가 흔들린 게 아니라 «매번 다시 타자»해서 축이 조금씩 달라졌다.
#   ⇒ 🔑 R-OBS14: 수는 「자 ⊕ 자리」를 달고 다녀야 하고, 그 자는 «저장»돼야 한다.
#
# 사용:  bash scripts/window-landings.sh <창시작 UTC ISO>
#   예:  bash scripts/window-landings.sh 2026-08-31T03:23:00Z
#
# 산출:  접두별 분해 ⊕ 합 ⊕ 「합 == 전체」 확인 (⭐ 이 확인이 오늘 마지막 오류를 잡았다)
set -u
SINCE="${1:?창 시작 UTC ISO 를 주십시오 (예: 2026-08-31T03:23:00Z)}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_BIN="$REPO_ROOT/bin/elanous.mjs"

# ⛔⭐ 「자리 셋」을 «산출이 스스로» 말한다 — 어디서 · 무엇으로 · ***언제***.
#   📏 2026-08-31: 이 스크립트를 만든 날, ***자기 규칙(R-OBS14)의 «3분의 1»만 지키고 있었다***
#     — 자(무엇으로)는 냈지만 «어디서(트리·우주)»와 «언제(시점)»를 안 냈다.
#   🔎 계기: 🅕 가 낸 부류 「초록인데 «왜»를 안 말하는 검사」를 내 자에 대 보니 걸렸다.
echo "📍 자리:  트리 $REPO_ROOT"
UNIVERSE="$(bun "$REPO_BIN" where 2>/dev/null | grep '인스턴스' | sed 's/.*: *//' | head -1)"
echo "📍 우주:  ${UNIVERSE:-⛔ 미상(where 실패) — 「운영이겠지」로 읽지 마라}"
echo "📍 시점:  $(date -u '+%Y-%m-%dT%H:%M:%SZ')  (이 값은 «이 순간」의 것이다)"

# ⛔⭐ 상한을 «세고 말한다» — preflight 의 금본위 형태(🅣 2026-08-31):
#   「N건 조회 · M건 판독 불가 · ***상한에 «닿았다»*** · 결과」를 «한 줄»에.
#   📏 2026-08-31 실측: 이 스크립트는 --limit 200 을 쓰는데 ***이미 200 을 채우고 있었다***
#     ⇒ 「창 밖」이 아니라 ***「상한 밖」에서 잘린 것***을 한 번도 «안 말했다».
# ⭐ 상한을 «창 크기에서» 정한다 — 고정 상한은 「끝없는 경주」다(2026-08-31 실측: 400·600·900 «전부» 닿음).
#   search API 가 「그날 이후 병합 총 수」를 «조건»으로 답하므로, 그 수 + 여유로 limit 를 «한 번에» 맞춘다.
#   ⛔ search 자체는 headRefName 을 «안 준다» — 그래서 조회는 여전히 pr list 로 하고, search 는 «크기만» 답한다.
DAY="${SINCE%%T*}"
TOTAL="$(bun "$REPO_BIN" gh api "search/issues?q=repo:ElanvitalAI/monad+is:pr+is:merged+merged:>=$DAY&per_page=1" --jq '.total_count' 2>/dev/null | tail -1)"
if [ -n "${TOTAL:-}" ] && [ "$TOTAL" -gt 0 ] 2>/dev/null; then
  LIMIT=$(( TOTAL * 2 + 100 ))
  echo "📏 창 크기: search API ⇒ merged:>=$DAY 총 ${TOTAL}건 ⇒ 상한을 ${LIMIT} 로 «맞춘다»"
else
  LIMIT=400
  echo "⚠️ 창 크기를 못 쟀다(search 실패) — 상한 400 으로 «떨어진다». ⛔ 「잘림 판정」을 «반드시» 읽어라"
fi
# ⛔ 「못 읽었다」를 「읽었다」로 «접지 않는다» — 이 자리가 두 번 틀렸다:
#   ⓐ 옛 판은 `2>/dev/null | tail -1` 뒤 `-z` «만» 봤다. 그러면 gh 가 진단 줄을
#      «stdout 으로» 내는 판에서 그 줄이 「브랜치 이름」이 되고, «비어 있지 않으니»
#      관문을 통과한다 ⇒ 모든 병합이 「다른 base」로 세어져 ***조용히 틀린다***.
#   ⓑ 종료 코드도 안 봤다 — 실패했는데 뭔가 찍었으면 그것을 썼다.
#   ⇒ 그래서 셋을 «다» 본다: 종료 코드 · 진단 줄 제거 · 이름 모양.
if ! DEFAULT_BRANCH_OUTPUT="$(bun "$REPO_BIN" gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>&1)"; then
  echo "⛔ 기본 브랜치 조회가 실패했다 — 원인: gh 가 exit≠0 로 죽었다. 병합 대상을 추측하지 마라" >&2
  exit 1
fi
DEFAULT_BRANCH="$(printf '%s\n' "$DEFAULT_BRANCH_OUTPUT" | python3 -c "
import sys
lines = [l.strip() for l in sys.stdin if l.strip() and not l.lstrip().startswith('[gh]')]
branch = lines[0] if len(lines) == 1 else ''
bad = branch.startswith(('-', '.')) or branch.endswith(('.', '/')) or '..' in branch or any(c in branch for c in ' ~^:?*[\\\\')
if branch and not bad:
    print(branch)
")"
if [ -z "${DEFAULT_BRANCH:-}" ]; then
  echo "⛔ 기본 브랜치 조회가 실패했다 — 원인: 진단 줄만 왔거나 이름 모양이 아니다. 병합 대상을 추측하지 마라" >&2
  exit 1
fi
RAW_COUNT="$(bun "$REPO_BIN" gh pr list --state merged --limit "$LIMIT" --json number --jq 'length' 2>/dev/null | tail -1)"
# ⭐ 상한에 닿아도 «창 안이 잘렸나»는 «추측하지 않고 잰다»:
#   반환분의 «가장 오래된» mergedAt 이 창 시작보다 «앞」이면 창 안은 온전하다.
OLDEST="$(bun "$REPO_BIN" gh pr list --state merged --limit "$LIMIT" --json mergedAt --jq '[.[]|.mergedAt]|min' 2>/dev/null | tail -1)"
if [ "${RAW_COUNT:-0}" = "$LIMIT" ]; then
  if [ -n "${OLDEST:-}" ] && [ "$OLDEST" \< "$SINCE" ]; then
    echo "📏 조회: 상한 $LIMIT 에 «닿았다» · 반환 최고참 $OLDEST < 창시작 $SINCE ⇒ ✅ ***창 안은 온전***"
  else
    echo "⛔ 조회: 상한 $LIMIT 에 «닿았고» 반환 최고참 ${OLDEST:-미상} 이 창시작 이후다 ⇒ ***창 안이 잘렸다. 상한을 올려라***"
  fi
else
  echo "📏 조회: 병합 PR ${RAW_COUNT:-?}건 (상한 $LIMIT · ✅ 안 닿음)"
fi

bun "$REPO_BIN" gh pr list --state merged --limit "$LIMIT" \
  --json number,mergedAt,headRefName,baseRefName \
  --jq ".[]|select(.mergedAt > \"$SINCE\")|[.number,.baseRefName,.headRefName]|@tsv" 2>/dev/null \
| grep -v '^\[gh\]' \
| python3 -c "
import sys
from collections import Counter
rows=[tuple(l.rstrip('\\n').split('\\t', 2)) for l in sys.stdin if l.strip()]
if not rows:
    print('⛔ 0행 — 창 시작 시각이 미래이거나 gh 조회가 실패했다. 「0건」으로 읽지 마라.'); raise SystemExit(1)
default_branch=sys.argv[2]
default_rows=[row for row in rows if row[1] == default_branch]
other_rows=[row for row in rows if row[1] != default_branch]
PREFIXES = ('s141-','s140-','f40-','f39-','t134-','t133-')
def cls(b):
    for p in PREFIXES:
        if b.startswith(p): return p.rstrip('-')
    # ⭐ 하니스가 «만든» 브랜치(self-impl/*)는 브랜치에 주인 표식이 «없다»(🅣 MEAS-T117 지적 · 2026-08-31).
    #   ⛔⭐ 2026-08-31 🅢 142차 — 이 칸의 옛 이름은 «무인(주인 미상)» 이었고, ***그 첫 낱말이 저자 자신을 속였다***:
    #     📏 실물: #14764 이 이 칸에 잡혔는데, 실제로는 리뷰 2라운드(fail must-fix 2 → pass 0) ⊕
    #        반증 2회 ⊕ must-fix 2건을 «사람이 손으로» 수리한 판이었다. 저자는 자기 산출을 읽고
    #        「내 손이 무인으로 세어졌다」고 채널에 썼다 — 괄호는 이미 «주인 미상»이라 말하고 있었는데도.
    #     🔑 ⇒ ***괄호에 적은 한계는 첫 낱말을 이기지 못한다.*** 그래서 이름에서 「무인」을 «뺀다».
    #   ⚠️ 그리고 이 자는 ***「하니스가 짓고 사람이 구조한 판」을 「무인 완주」와 «못 가른다»*** —
    #      브랜치 이름에 그 정보가 «없기» 때문이다. 그 갈림이 필요하면 이 자가 아니라 PR 의 리뷰·커밋 이력을 봐라.
    if b.startswith('self-impl/'):
        return '하니스 브랜치(주인 미상)'
    return 'OTHER(기타)'
c=Counter(cls(head) for _,_,head in default_rows)
print(f'📏 자:   gh pr list --state merged · mergedAt > {sys.argv[1] if len(sys.argv)>1 else \"<창시작>\"} · baseRefName = {default_branch} · headRefName 접두')
if other_rows:
    print(f'⚠️  기본 브랜치({default_branch}) 아닌 base 병합 {len(other_rows)}건: ' + ' '.join(f'#{number}' for number,_,_ in other_rows))
for k,v in sorted(c.items(), key=lambda x:-x[1]): print(f'   {k:<18} {v}')
print(f'   ─────────────────────────')
print(f'   합 {sum(c.values())} = 전체 {len(default_rows)}   {\"✅\" if sum(c.values())==len(default_rows) else \"⛔ 불일치\"}')
print('⚠️  이 수를 «인용»하지 말고 다음 창에서 다시 치십시오.')
" "$SINCE" "$DEFAULT_BRANCH"
