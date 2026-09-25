/**
 * 📈⭐⭐ **봇 «회차 산출»을 카드 한 장으로** — 봇 축과 투자 축을 «잇는» 조각 (🅕 45차)
 *
 * ## 🚨 왜 있나 — ***두 축이 다 있는데 «서로를 모른다»***
 * ```
 * 📏 44차 실측: BotsPanel.tsx 에 investor|투자|chart|차트 문면 ***0건***
 *              FinanceDashboardPanel.tsx 는 매력도를 5건 물고 /v1/dashboard/* 를 부르는데
 *              ***investor «봇»과 0건*** 이어져 있다
 * ```
 * ⇒ 🔑 이 저장소의 그 형태다 — ***있는데 «안 닿는다»***(`F12`).
 *
 * ## ⛔ 그래서 이 파일이 «안 하는» 것
 * ```
 * ⛔ 새 데이터를 만들지 않는다   investor 회차의 `RESULT.json` 이 «이미» 전부 갖고 있다
 * ⛔ 새 수집·새 계산을 안 한다    이 자는 «읽고 줄이는» 것뿐이다(순수)
 * ⛔ ***차트를 되살리지 않는다*** 대표 이 그것을 뺐다(`#15326`) ⇒ 이 요약은 ***그림 경로를 «한 개도» 안 낸다***
 *                              (「글」만 낸다 — 그것이 그 지시의 «뜻»이다)
 * ⛔ 파일을 읽지 않는다          I/O 는 부르는 쪽(라우트)의 몫 ⇒ 이 자는 VM·데몬 없이 «전부» 시험된다
 * ```
 *
 * 📌 **라우트는 🅣 소유다.** 44차의 `P1` 이 그 꼴로 성공했다 —
 *    🅕 가 «순수 함수»를 세우고(`botCommandCatalog`) 🅣 가 라우트를 얹었다(`GET /v1/bots/commands`).
 *    ⇒ 이 파일이 그 «순수 함수» 자리다.
 */

/** 한 걸음의 요약. ⛔ 그림·파일 경로는 «싣지 않는다». */
export interface RoundStep {
  readonly label: string;
  readonly ok: boolean;
  readonly ms: number | null;
  readonly chars: number | null;
}

export interface BotRoundSummary {
  readonly personaId: string;
  /** ⛔ UTC 다 — 표시할 때 시간대를 «말해라»(이 저장소가 그것으로 여러 번 틀렸다). */
  readonly finishedAtUtc: string | null;
  /** ⛔ 「돌았다」와 「성공했다」는 다른 값이다. */
  readonly ok: boolean | null;
  readonly steps: number | null;
  readonly failed: number | null;
  /** `cron` 이면 «무인»이다. ⛔ 없으면 `unknown` — 「손」으로 가정하지 않는다. */
  readonly source: string;
  /** 사람에게 «닿았나». ⛔ 「보냈다」와 「보내졌다」는 다른 값이라 sent 를 그대로 옮긴다. */
  readonly delivered: boolean | null;
  readonly items: readonly RoundStep[];
  /** ⛔ 「못 읽은 칸」을 «이름으로» 남긴다 — 빈 카드와 「모양이 바뀌었다」를 가른다. */
  readonly unreadable: readonly string[];
}

function str(v: unknown): string | null { return typeof v === 'string' && v !== '' ? v : null; }
function num(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function bool(v: unknown): boolean | null { return typeof v === 'boolean' ? v : null; }

/**
 * `RESULT.json` 을 카드 한 장으로 줄인다.
 * ⛔ 모양이 달라도 «터지지 않는다» — 못 읽은 칸을 `unreadable` 에 «이름으로» 남기고 나머지를 낸다.
 *    🔑 그래야 「카드가 비었다」와 「회차가 비었다」가 갈린다.
 */
export function summarizeBotRound(raw: unknown, fallbackPersonaId = 'unknown'): BotRoundSummary {
  const unreadable: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      personaId: fallbackPersonaId, finishedAtUtc: null, ok: null, steps: null, failed: null,
      source: 'unknown', delivered: null, items: [], unreadable: ['RESULT.json 자체를 «못 읽었다»'],
    };
  }
  const o = raw as Record<string, unknown>;
  const personaId = str(o.personaId) ?? fallbackPersonaId;
  if (str(o.personaId) === null) unreadable.push('personaId');
  const finishedAtUtc = str(o.finishedAtUtc);
  if (finishedAtUtc === null) unreadable.push('finishedAtUtc');
  const ok = bool(o.ok);
  if (ok === null) unreadable.push('ok');
  const steps = num(o.steps);
  const failed = num(o.failed);

  // ⛔ 「손」으로 «가정하지 않는다» — bot-canary 가 배운 그 규율 그대로.
  const source = str(o.source) ?? 'unknown';

  let delivered: boolean | null = null;
  const d = o.delivery;
  if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
    delivered = bool((d as Record<string, unknown>).sent);
  }
  if (delivered === null) unreadable.push('delivery.sent');

  const items: RoundStep[] = [];
  if (Array.isArray(o.results)) {
    for (const r of o.results) {
      if (typeof r !== 'object' || r === null) { unreadable.push('results[] 한 칸'); continue; }
      const rr = r as Record<string, unknown>;
      const label = str(rr.label);
      if (label === null) { unreadable.push('results[].label'); continue; }
      items.push({ label, ok: bool(rr.ok) ?? false, ms: num(rr.ms), chars: num(rr.chars) });
    }
  } else {
    unreadable.push('results');
  }

  return { personaId, finishedAtUtc, ok, steps, failed, source, delivered, items, unreadable };
}

/**
 * ⛔⭐ **회차의 «걸음 수」와 «선언된 수»가 어긋나는지 말한다.**
 * 🩸 실물: 대표 이 investor 의 차트 단계를 뺀 «뒤»에도 옛 회차는 `steps=4`(선언 3)이었고,
 *    그 어긋남이 ***「그 회차가 제거 «전» 코드로 돌았다」***는 뜻이었다.
 * ⇒ 그것을 「고장」이 아니라 ***「코드가 그 회차보다 «새것»이다」***로 읽게 한다.
 */
export function describeStepDrift(summary: BotRoundSummary, declaredSteps: number | null): string | null {
  if (summary.steps === null || declaredSteps === null) return null;
  if (summary.steps === declaredSteps) return null;
  return summary.steps > declaredSteps
    ? `이 회차는 ${summary.steps}걸음인데 지금 선언은 ${declaredSteps}걸음이다 — 그 회차가 «지금 코드보다 옛 코드»로 돌았다`
    : `이 회차는 ${summary.steps}걸음인데 지금 선언은 ${declaredSteps}걸음이다 — 걸음이 «늘어난» 뒤 아직 안 돈 회차다`;
}
