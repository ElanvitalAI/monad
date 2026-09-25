/**
 * 📈 **봇 회차 → 화면이 그릴 수 있는 «뷰모델»** (2026-09-04 · 🅕 45차)
 *
 * ## 🚨 왜 이 파일이 «따로» 있나
 * PWA 는 ***정적 export*** 라 파일을 못 읽는다 — 데이터는 데몬 라우트로만 온다.
 * 그런데 라우트(`/v1/bots/rounds`)는 ***🅣 소유***라 아직 «없다».
 * ⇒ 대표 이 고른 **ⓐ 안**: ***순수 층·화면을 «먼저» 세우고 라우트가 서면 fetch 한 줄만 갈아끼운다.***
 *
 * ## ⛔ 이 파일이 지키는 것
 * ```
 * ① ***파싱은 여기서 안 한다*** — `src/bots/investor-round.ts` 가 그 자리다(재발명 금지).
 *    이 자는 「받은 것을 화면 모양으로」만 바꾼다.
 * ② ***「없다」와 「못 받았다」를 가른다*** — `rounds: []` 와 `error` 는 다른 상태다.
 * ③ ***시각을 «여기서» 바꾸지 않는다*** — UTC 를 그대로 들고 다니고, 표시할 때 «시간대를 말한다».
 * ④ ⛔ 라우트 «모양»에 단단히 묶지 않는다 — 🅣 가 다른 필드명을 주면 여기 한 곳만 고친다.
 * ```
 */
import { readArtifact, type Artifact } from '../../../../src/bots/investor-round';

/** 🅣 라우트가 줄 «한 회차» — ⛔ 없는 필드는 «옵셔널»이다(모양이 달라도 안 터진다). */
export interface RoundWire {
  personaId?: string;
  runId?: string;
  atUtc?: string;
  ok?: boolean;
  steps?: number;
  failed?: number;
  source?: string;
  delivery?: { sent?: boolean; photosSent?: number; chars?: number };
  artifacts?: readonly { name?: string; chars?: number; text?: string }[];
}

export interface RoundsWire {
  rounds?: readonly RoundWire[];
  /** ⛔ 「0건」과 「못 읽었다」를 가르는 값 — 라우트가 스스로 낸다. */
  unreadable?: number;
  /** 🩺 못 읽은 «까닭»별 수 — ⛔ 「45」 하나로는 «경보인지 옛것인지» 못 가른다. */
  unreadableBy?: Readonly<Record<string, number>>;
}

/** 화면이 그리는 한 회차. */
export interface RoundView {
  readonly personaId: string;
  readonly runId: string | null;
  readonly atUtc: string | null;
  readonly ok: boolean | null;
  readonly steps: number | null;
  readonly failed: number | null;
  /** `cron` 이면 «무인». ⛔ 없으면 `unknown` — 「손」으로 가정하지 않는다. */
  readonly source: string;
  readonly delivered: boolean | null;
  readonly artifacts: readonly Artifact[];
  /** 본문이 «안 온» 산출의 이름 — `?withText=0` 이면 여기 쌓인다(빈 카드와 «다르다»). */
  readonly textless: readonly string[];
}

export type RoundsState =
  | { kind: 'loading' }
  | { kind: 'ready'; rounds: readonly RoundView[]; unreadable: number; unreadableNow: number }
  | { kind: 'error'; reason: string };

const s = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const b = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** ⛔ 모양이 어긋나도 «터지지 않는다» — 못 읽은 칸은 null 로 두고 나머지를 낸다. */
export function toRoundView(w: RoundWire): RoundView {
  const arts: Artifact[] = [];
  const textless: string[] = [];
  for (const a of w.artifacts ?? []) {
    const name = s(a?.name) ?? '(이름 없음)';
    const text = s(a?.text);
    if (text === null) { textless.push(name); continue; }   // ⛔ 「본문 없음」을 «조용히» 버리지 않는다
    arts.push(readArtifact(name, text));
  }
  return {
    personaId: s(w.personaId) ?? 'unknown',
    runId: s(w.runId),
    atUtc: s(w.atUtc),
    ok: b(w.ok),
    steps: n(w.steps),
    failed: n(w.failed),
    source: s(w.source) ?? 'unknown',
    delivered: b(w.delivery?.sent),
    artifacts: arts,
    textless,
  };
}

/** 라우트 응답 전체를 상태로. ⛔ `rounds` 가 배열이 아니면 «오류»지 「0건」이 아니다. */
export function toRoundsState(raw: unknown): RoundsState {
  if (typeof raw !== 'object' || raw === null) {
    return { kind: 'error', reason: '라우트 응답을 «못 읽었다»(객체가 아니다)' };
  }
  const o = raw as RoundsWire;
  if (!Array.isArray(o.rounds)) {
    return { kind: 'error', reason: '`rounds` 가 «배열이 아니다» — 「0건」과 «다른 값»이다' };
  }
  // 🩺 ⛔ 「지금 깨진 것」만 골라 낸다 — `result-missing` 은 «도입 전 옛 회차»라 경보가 «아니다».
  //    🩸 45차 실물: 45곳이 전부 result-missing 이었고, 화면은 그것을 경보처럼 보이게 했다.
  const by = o.unreadableBy;
  const nowBroken = by === undefined ? null
    : Object.entries(by).filter(([k]) => k !== 'result-missing').reduce((a, [, v]) => a + (n(v) ?? 0), 0);
  return {
    kind: 'ready',
    rounds: o.rounds.map(toRoundView),
    unreadable: n(o.unreadable) ?? 0,
    // ⛔ 까닭을 «안 받았으면» 전부를 「지금 깨진 것」으로 본다 — 조용한 초록보다 시끄러운 게 낫다.
    unreadableNow: nowBroken ?? (n(o.unreadable) ?? 0),
  };
}

/** ⏱️ UTC 문자열을 «시간대를 말하며» 보여 준다. ⛔ 조용히 변환하지 않는다. */
export function formatWhen(atUtc: string | null, tz = 'Asia/Seoul'): string {
  if (atUtc === null) return '시각 «모름»';
  const d = new Date(atUtc);
  if (Number.isNaN(d.getTime())) return `시각을 «못 읽었다»(${atUtc.slice(0, 24)})`;
  const f = new Intl.DateTimeFormat('ko-KR', {
    timeZone: tz, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${f.format(d)} KST`;
}

/** 숫자를 사람이 읽게. ⛔ `null` 은 «0 이 아니다» — 그렇게 «보이게» 쓴다. */
export function fmtNum(v: number | null, opts: { sign?: boolean } = {}): string {
  if (v === null) return '—';
  const t = Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(v);
  return opts.sign === true && v > 0 ? `+${t}` : t;
}
