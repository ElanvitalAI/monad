/**
 * 📉 **재현 회귀를 «다시 누르지 않고» 잰다** — C4 의 열린 칸.
 *
 * 🚨 **왜 이것이 필요한가**: 카나리아는 `harness replay --dry-run` 으로 ***「재현할 수 «있나»」***만 본다
 *    (클릭 0). ⛔ 「재현이 «맞나»」는 아무도 안 본다. 진짜로 다시 누르면 ***6시간마다 부작용***이다.
 *
 * > ### 🔑 ⇒ 그런데 카나리아는 «이미» 매 회차 같은 자리를 누른다.
 * > ***그 기록을 회차끼리 견주면 «새 클릭 없이» 회귀가 보인다.***
 *
 * ⛔⭐ **무엇을 견주는가 — 「값」이 아니라 «판정 부류»다.**
 * ```
 * 📏 실측 2026-08-28(24시간 · 같은 짝 41개):
 *    카나리아 표적        착지 호스트 1종 · landingVerdict 1종           ⇒ 안정
 *    HN 기사 링크         착지 호스트가 «지금은» 1종인데 첫 화면이 바뀌면 «달라진다»
 *                        그런데 landingVerdict 는 그때도 exact 다        ⇒ ***부류는 안정***
 * ```
 * ⇒ 그래서 ***착지 «호스트»·좌표로 회귀를 판정하지 않는다*** — 내용이 바뀌면 거짓 경보가 된다.
 *   ✅ 부류(`captureOutcome` · `landingVerdict`)는 내용과 «무관»하다.
 *
 * ⚖️ 그리고 이 자는 ***눈 회귀를 실제로 잡았을 것이다*** — 그 창의 기록에 `ok` 옆에 `timeout`·`error` 가 섞여 있다.
 */

export type DriftVerdict =
  /** 부류가 그대로다. */
  | 'stable'
  /** ⛔ 화면 포착이 «나빠졌다» — 되던 것이 안 된다. */
  | 'degraded'
  /** ⚠️ 착지 «부류»가 바뀌었다(예: exact → did-not-move). 내용 변화가 아니다. */
  | 'verdict-changed'
  /** ⛔ 견줄 것이 «없다» — 「안 갈렸다」가 아니라 판정 불가다. */
  | 'unmeasured';

export interface DriftStep {
  captureOutcome?: string | null;
  landingVerdict?: string | null;
}

export interface DriftAssessment {
  verdict: DriftVerdict;
  detail: string;
  /** 견준 표본 수(가장 최근 것 포함). ⛔ 「몇 개로 말하나」를 안 내면 그 판정은 못 믿는다. */
  samples: number;
}

/** 가장 흔한 값. 동률이면 «먼저 나온 것» — ⛔ 실행마다 답이 갈리지 않게 순서로 못 박는다. */
function mode(values: readonly string[]): string | null {
  const count = new Map<string, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const v of values) {
    const n = count.get(v) ?? 0;
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

/**
 * @param steps 같은 (봇·주소·선택자) 짝의 «성공한» 기록. ***오래된 것부터*** 준다.
 */
export function assessTrajectoryDrift(steps: readonly DriftStep[]): DriftAssessment {
  if (steps.length < 2) {
    return { verdict: 'unmeasured', samples: steps.length, detail: `견줄 회차가 «${steps.length}개»다 — 회귀를 말할 수 없다` };
  }
  const newest = steps[steps.length - 1]!;
  const baseline = steps.slice(0, -1);

  // ① 화면이 «나빠졌나» — 내용과 무관한 축이다.
  const baseOutcomes = baseline.map((s) => s.captureOutcome).filter((o): o is string => typeof o === 'string');
  const nowOutcome = typeof newest.captureOutcome === 'string' ? newest.captureOutcome : null;
  if (nowOutcome === null || baseOutcomes.length === 0) {
    return { verdict: 'unmeasured', samples: steps.length, detail: '화면 판정이 «없는» 회차가 있다 — 견줄 수 없다' };
  }
  if (nowOutcome !== 'ok' && baseOutcomes.includes('ok')) {
    return {
      verdict: 'degraded',
      samples: steps.length,
      detail: `화면이 «나빠졌다»: 예전엔 ok 였는데 지금 ***${nowOutcome}*** (표본 ${steps.length})`,
    };
  }

  // ② 착지 «부류»가 바뀌었나 — ⛔ 호스트·좌표가 아니라 «부류»다(내용이 바뀌면 그것들은 흔들린다).
  const baseVerdicts = baseline.map((s) => s.landingVerdict).filter((v): v is string => typeof v === 'string');
  const nowVerdict = typeof newest.landingVerdict === 'string' ? newest.landingVerdict : null;
  if (nowVerdict !== null && baseVerdicts.length > 0) {
    const usual = mode(baseVerdicts);
    if (usual !== null && usual !== nowVerdict) {
      return {
        verdict: 'verdict-changed',
        samples: steps.length,
        detail: `착지 부류가 바뀌었다: 보통 ***${usual}*** 였는데 지금 ***${nowVerdict}*** (표본 ${steps.length})`,
      };
    }
  }

  return {
    verdict: 'stable',
    samples: steps.length,
    detail: `부류가 그대로다(화면 ${nowOutcome}${nowVerdict === null ? '' : ` · 착지 ${nowVerdict}`} · 표본 ${steps.length})`,
  };
}

/**
 * 이 궤적이 ***「그 봇의 것」인가*** — 회귀 대조에 넣을 짝인지 가른다.
 *
 * ⛔⭐ 이것이 없으면 회귀 검사가 ***자기 시험을 자기 회귀로 읽는다***.
 *    📏 2026-08-28 실측: 카나리아의 `drift` 가 `?/#t` 를 「부류가 바뀌었다」로 계속 냈는데,
 *       그 궤적의 정체는 ***`instance: test:monad-agent` 의 시험 서버***(`127.0.0.1:PORT/newtab`)였다.
 *       ⇒ 판정기가 «봇이 한 적 없는 조작»을 봇의 회귀로 세고 있었다.
 *
 * ⚠️ `personaId` 가 «없는» 것을 「모르는 봇」이 아니라 ***「봇이 아니다」***로 읽는다 —
 *    봇의 조작은 언제나 `--persona` 를 달고 오기 때문이다.
 */
export function isBotOwnedTrajectory(
  personaId: string | null | undefined,
  knownPersonaIds: ReadonlySet<string>,
): boolean {
  if (typeof personaId !== 'string') return false;
  const id = personaId.trim();
  if (id === '') return false;
  return knownPersonaIds.has(id);
}
