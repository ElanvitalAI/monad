/**
 * ▶️ **재현 — 녹화한 궤적을 «같은 순서로» 다시 밟는다.**
 *
 * ⛔ **이것이 「같은 결과」를 보장하지 «않는다».** 웹은 변한다 —
 *    그래서 이 장치의 산출은 「성공/실패」가 아니라 ***「그때와 지금이 어디서 갈렸나」***다.
 *
 * 🔑 그러므로 걸음마다 «둘»을 남긴다: ***그때 무엇이었나*** ⊕ ***지금 무엇인가***.
 *    ⇒ 재현이 «틀렸다」고 말하는 것이 아니라 ***무엇이 달라졌는지***를 댄다.
 */

export type ReplayStepOutcome = 'same' | 'differs' | 'failed' | 'unobserved';

export interface ReplayStepResult {
  index: number;
  url: string;
  target: string;
  outcome: ReplayStepOutcome;
  /** 그때 · 지금 — ⛔ 하나만 내면 「무엇이 달라졌나」를 못 묻는다. */
  then: { landedUrl?: string | null; coordinates: { x: number; y: number } | null; captureOutcome: string | null; ok: boolean };
  now: {
    /** ⭐ 「실제로 간 곳」. ⛔ undefined = 「그 판이 이 값을 안 싣던 옛 행」 · null = 「이동이 아니었다」. */
    landedUrl?: string | null;
    coordinates: { x: number; y: number } | null;
    captureOutcome: string | null;
    ok: boolean;
    /**
     * ⛔⭐ 실패의 «이유». 라벨만 내면 그 실패는 «셀 수만» 있고 고칠 수 없다 —
     *    2026-08-28 실물에서 재현 2걸음이 「지금 이 조작이 «실패했다»」로만 끝나서
     *    ***무엇이 실패했는지(없는 페르소나였다)를 산출만 보고는 알 수 없었다.***
     */
    reason?: string | null;
  };
  detail: string;
}

export interface ReplayVerdict {
  steps: ReplayStepResult[];
  same: number;
  differs: number;
  failed: number;
  /** ⛔ 초록도 빨강도 아닌 제 칸 — 「못 봤다」. */
  unobserved: number;
  detail: string;
}

/** 두 좌표가 «사실상 같은가». ⛔ 픽셀 단위 동일을 요구하지 않는다 — 렌더는 미세하게 흔들린다. */
export function coordinatesMatch(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null,
  tolerancePx: number,
): boolean {
  if (a === null || b === null) return a === b;   // 둘 다 null 이면 같다
  return Math.abs(a.x - b.x) <= tolerancePx && Math.abs(a.y - b.y) <= tolerancePx;
}

/** ⛔ 한 걸음의 판정 — 「됐나」가 아니라 ***「그때와 갈렸나」***다. */
export function judgeReplayStep(params: {
  index: number;
  url: string;
  target: string;
  then: ReplayStepResult['then'];
  now: ReplayStepResult['now'];
  tolerancePx: number;
}): ReplayStepResult {
  const { index, url, target, then, now, tolerancePx } = params;
  const base = { index, url, target, then, now };

  // ⛔ 지금 조작 자체가 «안 됐다»면 그것은 「갈림」이 아니라 「실패」다 — 다른 값이다.
  if (!now.ok) {
    const why = (now.reason ?? '').trim();
    return {
      ...base,
      outcome: 'failed',
      detail: why === ''
        // ⛔ 「이유가 없다」를 «조용히» 두지 않는다 — 부르는 쪽이 안 넘긴 것도 사실이다.
        ? '지금 이 조작이 «실패했다» — 그때와의 갈림 이전의 문제다 (⚠️ 이유가 «안 넘어왔다»)'
        : `지금 이 조작이 «실패했다» — ${why}`,
    };
  }

  // ⛔⭐ **「관측을 못 찾았다」를 「갈렸다」로 읽지 않는다.**
  //    📏 실측 2026-08-28: 조작은 성공했는데 관측 조회가 그 행을 «못 잡아» 좌표가 null 로 왔고,
  //       그것이 「좌표 {…} → null · 화면 ok → null」이라는 ***거짓 갈림***으로 나왔다.
  //    🔑 이 축이 하루 종일 고쳐 온 병이 정확히 그것이다 — 「없다」와 「못 봤다」를 뭉치는 것.
  if (now.coordinates === null && now.captureOutcome === null) {
    return {
      ...base,
      outcome: 'unobserved',
      detail: '이 조작의 «관측을 못 찾았다» — 「갈렸다」가 아니라 ***판정 불가***다(조회 창·상한·플러시를 봐라)',
    };
  }

  const diffs: string[] = [];

  // ⛔⭐⭐ ***목적지가 «좌표보다» 센 증거다.*** 좌표는 배치가 바뀌면 흔들리지만
  //    「어디로 갔나」는 «의미»다 — 같은 자리를 눌러도 다른 곳에 가면 그것은 «갈린 것»이고,
  //    다른 자리를 눌러도 같은 곳에 가면 그것은 «안 갈린 것»에 가깝다.
  //    ⚠️ 그래도 좌표를 «버리지 않는다» — 옛 행에는 목적지가 «없다»(undefined).
  const bothLanded = typeof then.landedUrl === 'string' && typeof now.landedUrl === 'string';
  if (bothLanded && then.landedUrl !== now.landedUrl) {
    diffs.push(`목적지 ${then.landedUrl} → ${now.landedUrl}`);
  }
  // ⛔ 목적지가 «같으면» 좌표 차이는 「갈림」이 아니라 «배치 변화»다 — 그것으로 빨강을 만들지 않는다.
  //    ⇒ 그 사실을 «조용히» 넘기지 않고 아래 detail 에 적는다.
  const coordinatesDiffer = !coordinatesMatch(then.coordinates, now.coordinates, tolerancePx);
  const landedSame = bothLanded && then.landedUrl === now.landedUrl;
  if (coordinatesDiffer && !landedSame) {
    diffs.push(`좌표 ${JSON.stringify(then.coordinates)} → ${JSON.stringify(now.coordinates)}`);
  }
  if (then.captureOutcome !== now.captureOutcome) {
    diffs.push(`화면 ${then.captureOutcome} → ${now.captureOutcome}`);
  }
  if (then.ok !== now.ok) diffs.push(`그때는 ${then.ok ? '성공' : '실패'}였다`);

  if (diffs.length === 0) {
    // ⛔ 「무엇으로 같다고 했나」를 «말한다» — 자를 안 밝히면 다음 창이 그 초록을 못 믿는다.
    const how = landedSame
      ? (coordinatesDiffer
        ? `목적지가 같다(${now.landedUrl}) — 좌표는 움직였지만 «배치 변화»다`
        : `목적지·좌표 둘 다 같다(${now.landedUrl})`)
      : `좌표 오차 ≤${tolerancePx}px (⚠️ 목적지는 «못 쟀다» — 옛 행이거나 이동이 아니다)`;
    return { ...base, outcome: 'same', detail: `그때와 같다 — ${how}` };
  }
  return { ...base, outcome: 'differs', detail: diffs.join(' · ') };
}

/** ⛔ 「N/N 같다」로 끝내지 않는다 — 갈린 걸음을 «이름으로» 낸다. */
export function summarizeReplay(steps: readonly ReplayStepResult[]): ReplayVerdict {
  const same = steps.filter((s) => s.outcome === 'same').length;
  const differs = steps.filter((s) => s.outcome === 'differs').length;
  const failed = steps.filter((s) => s.outcome === 'failed').length;
  const unobserved = steps.filter((s) => s.outcome === 'unobserved').length;
  const named = steps
    .filter((s) => s.outcome !== 'same')
    .map((s) => `#${s.index} ${s.target}: ${s.detail}`);
  // ⛔ 「못 봤다」를 «분모에서 빼지 않는다» — 세지 않으면 재현율이 부풀려진다.
  const head = `걸음 ${steps.length}개 — 같다 ${same} · 갈렸다 ${differs} · 실패 ${failed} · ***못 봤다 ${unobserved}***`;
  // ⛔ 빈 궤적을 «전부 같다»로 읽지 않는다.
  if (steps.length === 0) {
    return { steps: [], same, differs, failed, unobserved, detail: '걸음이 «하나도» 없다 — 재현할 것이 없었다(궤적을 다시 봐라)' };
  }
  return { steps: [...steps], same, differs, failed, unobserved, detail: named.length === 0 ? head : `${head}\n  ${named.join('\n  ')}` };
}
