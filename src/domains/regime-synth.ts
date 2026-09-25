// ── 국면 벡터 종합기 (C1 · M1.1 · 2026-07-07) ──────────────────────────
//
// 국면종합 방법론(PLAN-regime-synthesis §2)의 심장. 파편 신호(자산·지정학·섹터·
// 수급/외국인)를 REGIME_AXES 순서로 받아 **하나의 국면 벡터**로 합성한다. 두 자율
// 루프(분석·매매)의 공유 통화이자, 큰 국면 전환(다축 동시 방향전환)의 감지기.
//
// ★ 순수 함수 — I/O(축 fetcher·시각)는 전부 주입(테스트 결정론). 실 fetcher 배선은
//   M1.2, 저장은 M1.3, 아침 heartbeat는 M1.4. 여기선 "합성"만.

import { REGIME_AXES, axisByKey, compositeAxes, type RegimeAxis } from './regime-axes.js';

/** 한 축의 신호 — fetcher가 낸다. direction=방향·strength=크기·confidence=신뢰도. */
export interface AxisSignal {
  axis: RegimeAxis['key'];
  /** -1 risk-off / 0 중립 / +1 risk-on. */
  direction: -1 | 0 | 1;
  /** 신호 크기(0~1·정규화). 라벨 판정 보조. */
  strength: number;
  /** 신뢰도(0~1). composite 합성 가중. 데이터 부재 시 0(=기여 없음·fail-soft). */
  confidence: number;
  note: string;
}

export interface RegimeVector {
  axes: AxisSignal[];
  /** 가중 합성(-1 risk-off ~ +1 risk-on) = Σ(weight × direction × confidence). */
  composite: number;
  /** 방향 라벨. */
  regimeLabel: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
  /** 큰 국면 전환(다축 동시 방향전환) — 매매 urgentDeviation 후보. */
  transition: boolean;
  /** 전환에 기여한 축(직전 대비 부호전환). */
  transitionAxes: string[];
  asOf: string;
}

export interface RegimeDeps {
  /** 각 축 신호(M1.2 실배선·테스트 mock). composite/transition 축 모두. */
  axes: () => Promise<AxisSignal[]>;
  /** 직전 국면 벡터(transition 판정용). 없으면 전환 판정 스킵. */
  prev?: RegimeVector | null;
  /** asOf 타임스탬프(주입·결정론). */
  now: string;
  /** 라벨 임계(기본 0.25). |composite| 이 이상이면 방향 라벨. */
  labelThreshold?: number;
  /** 전환 |composite| 최소(기본 0.2). */
  transitionMinComposite?: number;
}

/** 국면 벡터 합성. composite = Σ(weight × direction × confidence) over composite 축.
 *  transition = 직전 대비 ≥2 축 부호전환 AND |composite| ≥ 임계, 또는 dislocation(transition
 *  축) 강신호. Never throws — 축 fetcher 실패는 상위(M1.2)가 fail-soft로 빈 배열/저confidence. */
export async function synthesizeRegime(deps: RegimeDeps): Promise<RegimeVector> {
  const signals = await deps.axes();
  const byKey = new Map(signals.map(s => [s.axis, s]));

  // composite = Σ(weight × dir × conf) — composite 축만(transition 축 weight 0이라 자동 제외).
  let composite = 0;
  for (const ax of compositeAxes()) {
    const s = byKey.get(ax.key);
    if (!s) continue; // 축 부재 = 기여 0(fail-soft)
    composite += ax.weight * s.direction * clamp01(s.confidence);
  }
  composite = round3(composite);

  const th = deps.labelThreshold ?? 0.25;
  const regimeLabel: RegimeVector['regimeLabel'] =
    composite >= th ? 'RISK_ON' : composite <= -th ? 'RISK_OFF' : 'NEUTRAL';

  // transition: 직전 대비 부호전환한 축들.
  const transitionAxes: string[] = [];
  if (deps.prev) {
    const prevByKey = new Map(deps.prev.axes.map(s => [s.axis, s]));
    for (const s of signals) {
      const p = prevByKey.get(s.axis);
      if (p && p.direction !== 0 && s.direction !== 0 && Math.sign(p.direction) !== Math.sign(s.direction)) {
        transitionAxes.push(s.axis);
      }
    }
  }
  // dislocation(전환 축) 강신호도 전환 조기신호로 포함(strength 높고 방향 뚜렷).
  const disloc = byKey.get('dislocation');
  if (disloc && disloc.direction !== 0 && disloc.strength >= 0.6 && !transitionAxes.includes('dislocation')) {
    transitionAxes.push('dislocation');
  }

  const minC = deps.transitionMinComposite ?? 0.2;
  // 큰 국면 전환 = ≥2 축 부호전환(방향) OR (부호전환 1축 + dislocation 강신호). |composite| 게이트.
  const flipCount = transitionAxes.filter(a => a !== 'dislocation').length;
  const transition = (flipCount >= 2 || (flipCount >= 1 && transitionAxes.includes('dislocation')))
    && Math.abs(composite) >= minC;

  return { axes: signals, composite, regimeLabel, transition, transitionAxes, asOf: deps.now };
}

/** 국면 벡터 → 사람용 한 줄(아침 heartbeat·알림). */
export function summarizeRegime(v: RegimeVector): string {
  const dir = v.regimeLabel === 'RISK_ON' ? '🟢위험선호' : v.regimeLabel === 'RISK_OFF' ? '🔴위험회피' : '⚪중립';
  const top = [...v.axes].filter(a => a.confidence > 0)
    .sort((a, b) => Math.abs(b.direction * b.confidence) - Math.abs(a.direction * a.confidence))
    .slice(0, 3)
    .map(a => `${axisByKey(a.axis)?.name ?? a.axis}${a.direction > 0 ? '↑' : a.direction < 0 ? '↓' : '·'}`)
    .join(' · ');
  const trans = v.transition ? ` ⚠️큰 국면전환(${v.transitionAxes.join('·')})` : '';
  return `[국면] ${dir} ${v.composite >= 0 ? '+' : ''}${v.composite} · ${top}${trans}`;
}

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
function round3(x: number): number { return Math.round(x * 1000) / 1000; }

/** ★ 국면 읽기의 데이터 건강도(0~1) = composite 축 가중평균 confidence.
 *  freshness 프록시(stale/부재 축 = confidence 0 → 건강도↓). 매매 checker(Stage 2)가
 *  이 값으로 "낡은 국면 위에서 자율 집행"(실수 화로)을 차단한다. 축 부재=0(보수). */
export function regimeDataHealth(v: RegimeVector): number {
  const byKey = new Map(v.axes.map(a => [a.axis, a]));
  let sum = 0, wsum = 0;
  for (const ax of compositeAxes()) {
    const s = byKey.get(ax.key);
    sum += ax.weight * (s ? clamp01(s.confidence) : 0);
    wsum += ax.weight;
  }
  return wsum > 0 ? round3(sum / wsum) : 0;
}

/** 축 개수 정합(레지스트리와 동기) — 테스트/디버그 보조. */
export const REGIME_AXIS_COUNT = REGIME_AXES.length;
