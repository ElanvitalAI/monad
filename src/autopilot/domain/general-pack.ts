// ── general 도메인팩 (fallback) — D0 ──────────────────────────────────────
//
// 분류되지 않은 미션의 안전망. 외부조사는 기본 생략(보수), 분해는 중립 어투.
// coding/investment/research 팩이 붙기 전까지 그릇이 항상 유효 팩을 반환하도록 보장.
// 순수(IO 없음) — research 는 no-op 기본값(실 소스는 각 도메인팩이 제공).

import type { DomainPack } from './types.js';

export const GENERAL_PACK: DomainPack = {
  domain: 'general',
  label: '일반',
  decompose: {
    goalKind: 'general',
    objectivePreamble: (goal: string) => `다음 목표를 달성한다: "${goal}"`,
  },
  research: {
    // general: 분야 특정 소스가 없으므로 외부조사 강제하지 않음(보수·비용 절약).
    assessNeed: async () => ({ needed: false, reason: 'general: 도메인 특정 리서치 소스 없음' }),
    invoke: async () => ({ ok: false, output: '' }),
  },
};
