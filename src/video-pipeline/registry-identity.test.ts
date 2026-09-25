// 레지스트리의 «이름»이 유일한가 — cap id · impl id · provider id.
//
// 🩸 왜 있는가 — 2026-09-23 실측: `voice-clone` cap 이 «이미 있는데» 못 보고 같은 id 로 ***두 번째 블록을 넣었다.***
//   그런데 ***아무것도 말하지 않았다*** — tsc 통과 · 62개 시험 전부 초록 · `probe` 산출도 조용했다.
//   증상은 엉뚱한 데서 나왔다: 무료 impl 을 «분명히 넣었는데» 산출이 계속
//   「무료가 하나도 없어 과금이 강제되는 능력: voice-clone」 이라고 말했다(뒤 블록이 앞 것을 가린다).
//   ⇒ ***id 중복은 「틀렸다」고 말하지 않고 「조용히 하나를 지운다».*** 그래서 이 자가 필요하다.
import { describe, expect, it } from 'bun:test';
import { CAPABILITIES, PROVIDERS } from './capabilities.js';

/** 중복만 골라 낸다 — 「몇 개인가」가 아니라 ***「무엇이」 겹쳤나***를 산출에 담는다(고치려면 이름이 필요하다). */
function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup].sort();
}

describe('레지스트리 이름의 유일성 — 겹치면 «조용히» 하나가 사라진다', () => {
  it('⛔ cap id 는 유일하다', () => {
    expect(duplicates(CAPABILITIES.map((c) => c.id))).toEqual([]);
  });

  it('⛔ impl id 는 «레지스트리 전체에서» 유일하다 — 능력이 달라도 이름이 겹치면 추적이 끊긴다', () => {
    expect(duplicates(CAPABILITIES.flatMap((c) => c.impls.map((i) => i.id)))).toEqual([]);
  });

  it('⛔ provider id 는 유일하다', () => {
    expect(duplicates(PROVIDERS.map((p) => p.id))).toEqual([]);
  });

  it('⛔ 자가 «무는지» — 지어낸 중복을 넣으면 그 이름을 «대면서» 걸린다', () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(3);            // 모집단이 비면 위 셋은 공허하게 참이다
    expect(duplicates([...ids, ids[0]!])).toEqual([ids[0]!]);
  });

  it('⭐ impl 이 «하나도 없는» 능력은 없다 — 빈 칸은 「유료뿐」과 구분이 안 된다', () => {
    expect(CAPABILITIES.filter((c) => c.impls.length === 0).map((c) => c.id)).toEqual([]);
  });
});
