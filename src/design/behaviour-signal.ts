// ── 판정 신호가 «행동»을 보는지 검사한다 — 사다리 ⑤ 를 재는 자 (2026-09-08) ────
//
// ⛔⭐⭐ 계기: 이 창의 첫 하니스 골에서 ***①②③④ 가 전부 초록인데 ⑤ 에서만 죽는*** 사례가 났다.
//    자식이 `--full-page` 를 Chrome CLI 플래그로 넘겼고 Chrome 은 그것을 «조용히 무시»했다.
//    ⇒ `captureScope:'full-page'` 는 값이 «흐르는데» 캡처는 뷰포트였다(1280×900 ↔ 전체 4651).
//    🚨 그리고 ***내 판정 신호가 바로 그 필드를 보고 있어서*** 초록으로 통과했다.
//
// 🪜 세 트랙이 모은 사다리(🅢 종합 · 2026-09-08):
//    ① 호출부 0  ② 배선했나  ③ 활성이 될 수 있나  ④ 읽는 실행 코드  ⑤ ***수신자가 무시하나***
//    ⛔ ①~④ 는 정적으로 잡히고 ⑤ 는 «안 잡힌다». 이 파일은 ⑤ 를 «쓰기 전에» 막는 쪽을 맡는다.
//
// ⭐ 무엇을 하나: 판정 신호 문면을 읽고 ***「관측 칸이 구현이 스스로 채우는 값인가」***를 본다.
// ⛔ 무엇을 «안» 하나: 실제로 그 도구를 돌려 보지 않는다. 그건 ⑤ 의 «실측» 쪽이고 이 층 밖이다.
//    ⇒ 그래서 이 검사가 통과해도 「⑤ 를 지났다」가 «아니다». 그 한계를 값으로 낸다.

/** 판정 신호 한 줄에서 뽑은 세 칸. 못 뽑으면 null — ⛔ 빈 문자열로 채우지 않는다. */
export interface SignalParts {
  readonly condition: string | null;
  readonly observation: string | null;
  readonly expectation: string | null;
}

/** `판정 신호: 조건 = …; 관측 = …; 기대 = …` 를 가른다. 라벨은 한글·영문 둘 다 문다. */
export function parseSignal(line: string): SignalParts {
  const grab = (ko: string, en: string): string | null => {
    const re = new RegExp(`(?:${ko}|${en})\\s*=\\s*([^;]+)`, 'i');
    return re.exec(line)?.[1]?.trim() ?? null;
  };
  return {
    condition: grab('조건', 'condition'),
    observation: grab('관측', 'observation'),
    expectation: grab('기대', 'expectation'),
  };
}

export type ObservationKind =
  /** 구현이 «스스로 채우는» 값 — 필드·플래그·상수 */
  | 'self-reported'
  /** 구현이 «거짓으로 못 내는» 결과 — 크기·개수·종료 코드·화면 */
  | 'external-result'
  /** 가를 수 없다 */
  | 'unknown';

/** ⛔ 「필드」를 가리키는 말. 이런 관측은 구현이 «값만 채워» 통과할 수 있다. */
const SELF_REPORTED = [
  '필드', '값이', '속성', 'field', 'property', 'flag', '플래그',
  '반환값', '리턴', 'returns', '상수', 'enum', '타입',
];

/** ⭐ 「결과」를 가리키는 말. 구현이 거짓으로 낼 수 없다. */
const EXTERNAL_RESULT = [
  '픽셀', '높이', '너비', '크기', '바이트', '줄 수', '행 수', '개수', '건수',
  '종료 코드', 'exit', '화면', '스크린샷', '파일', '로그', '원장', '시간',
  'height', 'width', 'size', 'bytes', 'count', 'screenshot', 'pixels',
];

/** ⭐ 존재·지속 기대. 저작 도구가 그 부재를 `all-negative-signals` 로 경고한다. */
const PRESENCE_WORDS = ['있다', '여전히', '유지', '크다', '작다', '남는다', '이상', '초과', '미만', '넘는다'];

export function classifyObservation(observation: string | null): ObservationKind {
  if (observation === null || observation.trim() === '') return 'unknown';
  const o = observation.toLowerCase();
  const external = EXTERNAL_RESULT.some((w) => o.includes(w.toLowerCase()));
  const self = SELF_REPORTED.some((w) => o.includes(w.toLowerCase()));
  // ⛔ 둘 다 걸리면 «외부 결과» 쪽으로 본다 — 「스크린샷의 높이 필드」 같은 문면이 있다.
  if (external) return 'external-result';
  if (self) return 'self-reported';
  return 'unknown';
}

export interface SignalFinding {
  readonly line: number;
  readonly rule: 'observation-is-self-reported' | 'no-presence-expectation' | 'signal-unparsed';
  readonly evidence: string;
  readonly why: string;
}

export interface SignalAudit {
  readonly signals: number;
  readonly findings: readonly SignalFinding[];
  /** ⛔ 이 검사가 «답하지 못하는» 것 — 통과가 「⑤ 를 지났다」를 뜻하지 않는다 */
  readonly limitation: string;
}

/**
 * 골 문서(또는 ask 전문)의 판정 신호를 훑어 ⑤ 로 죽을 수 있는 것을 낸다.
 *
 * ⛔ **이 검사는 「쓰기 전」의 것이다.** 실제로 도구를 돌려 결과가 바뀌는지는 «안 본다».
 *    그래서 통과가 「행동을 검증했다」가 아니다 — `limitation` 에 그 문장을 싣는다.
 */
export function auditSignals(document: string): SignalAudit {
  const findings: SignalFinding[] = [];
  let signals = 0;
  const lines = document.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/판정\s*신호|decision\s*signal/i.test(line)) continue;
    signals += 1;
    const p = parseSignal(line);
    if (p.observation === null || p.expectation === null) {
      findings.push({
        line: i + 1, rule: 'signal-unparsed', evidence: line.trim().slice(0, 110),
        why: '「관측 = …; 기대 = …」 세 칸이 안 잡힌다 — 파서가 못 읽으면 판정도 못 한다',
      });
      continue;
    }
    if (classifyObservation(p.observation) === 'self-reported') {
      findings.push({
        line: i + 1, rule: 'observation-is-self-reported', evidence: p.observation.slice(0, 110),
        why: '구현이 «스스로 채우는» 값이라 값만 넣고 통과할 수 있다 — 크기·개수·종료 코드처럼 «거짓으로 못 내는» 결과를 봐라',
      });
    }
    if (!PRESENCE_WORDS.some((w) => p.expectation!.includes(w))) {
      findings.push({
        line: i + 1, rule: 'no-presence-expectation', evidence: p.expectation.slice(0, 110),
        why: '존재·지속 기대(있다·유지·크다·남는다·이상)가 없다 — 저작 도구의 all-negative-signals 와 같은 축',
      });
    }
  }
  return {
    signals, findings,
    limitation: '⛔ 이 검사는 문면만 본다. 통과해도 「그 값이 참일 때 산출이 실제로 바뀌나」는 «안 쟀다» — 그것은 실물 실행의 몫이다.',
  };
}
