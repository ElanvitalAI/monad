#!/usr/bin/env python3
"""🅢 빨강을 «원인 좌표»로 접는다 — fail «수»는 원인 «수»가 아니다.

⛔ 왜 있나(2026-08-26 실측): 이 저장소의 빨강 인벤토리는 「파일 · fail 수」로 나온다.
   그런데 «한 소스 줄»이 여러 시험을 문다. 실측: `test/` 를 110초 돌린 산출에서
   좌표가 잡힌 8 fail 이 ***두 원인***이었다(`turn-preamble.ts:102` 5 · `daemon-runtime.ts:768` 3).
   ⇒ 🔑 ***385 fail 이 385 「할 일」이 아니다.***

⚠️ 한계 — 이 자가 답하지 «않는» 것:
   · 스택에 `src/` 프레임이 «없는» 실패는 못 접는다(단언 실패만 있고 프로덕션 프레임이 안 뜨는 경우)
     📏 실측: 43 fail 중 좌표가 잡힌 것은 «8»뿐이었다
   · 접힌 것이 「같은 원인」이라는 보장은 «없다» — 같은 줄이 다른 이유로 터질 수 있다
   ⇒ 그러므로 이 자는 「우선순위 후보」를 내지 「할 일 목록」을 내지 않는다.

사용:  bun test <경로> > /tmp/out.txt 2>&1 ;  python3 scripts/red-cause-rollup.py /tmp/out.txt
"""
import re, sys, collections

def main() -> int:
    if len(sys.argv) < 2:
        print("사용: python3 scripts/red-cause-rollup.py <bun test 산출 파일>", file=sys.stderr)
        return 2
    try:
        lines = open(sys.argv[1], encoding='utf-8', errors='ignore').read().split('\n')
    except OSError as e:
        print(f"⛔ 산출을 못 읽었다(「0」이 아니라 «못 셌음»이다): {e}", file=sys.stderr)
        return 3
    total = sum(1 for l in lines if l.startswith('(fail)'))
    rolled = collections.Counter()
    examples = collections.defaultdict(list)
    cur = None
    for l in lines:
        m = re.search(r'\((?:/\S*?)(src/[^:)]+):(\d+)', l)
        if m:
            cur = f"{m.group(1)}:{m.group(2)}"
        if l.startswith('(fail)'):
            if cur:
                rolled[cur] += 1
                examples[cur].append(l[7:100].strip())
            cur = None
    got = sum(rolled.values())
    print(f"  전체 fail {total} · 원인 좌표가 «잡힌» 것 {got} · 못 잡은 것 {total - got}")
    if not rolled:
        print("  ⇒ 접을 것이 없다(스택에 src/ 프레임이 안 떴다)")
        return 0
    print(f"  ⇒ ***{got} fail 이 {len(rolled)} 원인***\n")
    for coord, n in rolled.most_common():
        print(f"  {n:>3}  {coord}")
        for e in examples[coord][:2]:
            print(f"       · {e}")
    return 0

if __name__ == '__main__':
    sys.exit(main())
