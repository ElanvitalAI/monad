// ── 로컬 LLM 벤치마크 · 평가 뱅크 (100점 루브릭 · v2 하드닝 2026-07-20) ─────────────
//
// 대표 평가 방식 이식: temperature 0·같은 문항·순차·코딩은 실제 Python subprocess 실행·통과 테스트 수 채점.
// 점수 구성: 코딩 실행 50 · 추론 30 · RAG/근거 10 · 한국어 형식 10 = 100.
// 채점기는 전부 **결정론·순수**(모델/네트워크 무관) — canned 답변으로 단위테스트 가능. 코딩만 exec 주입.
//
// ⭐ v2 하드닝 근거(2026-07-20): v1 은 강한 로컬 모델(ornith-9b 96·qwen3.6 100)이 상단 **천장 포화**해
//   변별이 안 됐다(saturated 플래그가 경고만 냄). v2 는 ①난이도 스프레드(easy 바닥 + hard 천장) ②문항당
//   부분점수 granularity 를 높여 런간 변동(대표 실측 60/90/100)을 줄인다. 카테고리 만점(50/30/10/10)은
//   보존 → scores.ts CATEGORY_MAX·deriveTier·llm-bench.jsonl shape 하위호환. 스코어 비교용 rubricVersion 태깅.

import type { PyRunResult } from './code-exec.js';
import { extractCodeBlock, tallyMarkers } from './code-exec.js';

/** 루브릭 버전 — 레코드에 태깅해 스코어 세대를 구분(비교 불가 방지).
 *  v2.1(2026-07-20): v2 스윕서 추론 30/30·코딩 상단(gemma 50) 재포화 관측 → 추론 전면 하드닝(7인 스케줄·
 *  재귀수열·4인 논리)+코딩 regex-match(H+) 추가로 상위 3모델(gemma/qwen-coder/ornith) 변별 확보. */
export const RUBRIC_VERSION = 'v2.1-2026-07-20';

export type BenchCategory = 'coding' | 'reasoning' | 'rag' | 'kr-format';
export type CodeExecutor = (source: string) => Promise<PyRunResult>;
/** 문항 난이도 — 스프레드 설계 가시화(easy=바닥 변별·hard=천장 변별). */
export type BenchDifficulty = 'easy' | 'medium' | 'hard';

export interface BenchGradeResult {
  readonly score: number;
  readonly max: number;
  readonly detail: string;
}

export interface BenchTask {
  readonly id: string;
  readonly category: BenchCategory;
  readonly max: number;
  readonly difficulty: BenchDifficulty;
  readonly prompt: string;
  /** 결정론 채점. 코딩 태스크만 exec 사용(추론/RAG/형식은 순수 규칙). */
  readonly grade: (answer: string, exec: CodeExecutor) => Promise<BenchGradeResult>;
}

// ─── 코딩(50점) — 실제 실행 채점 · 난이도 스프레드(E·M·M·H·H) ────────────────────────

const CODING_MAX = 10;

/** 파이썬 테스트 드라이버 프리앰블 — 각 테스트를 **개별 타임아웃(3s)** 으로 격리 실행해 __PASS__/__FAIL__
 *  마커 출력. 한 테스트의 무한루프가 프로세스를 죽여 나머지 마커를 못 내면 태스크 전체가 부당하게 0점이
 *  되므로, signal.alarm 으로 문항 내 테스트별 부분점수를 보존한다. flush=True 로 킬 전 마커 확실히 출력. */
const PY_DRIVER = `
import signal
class _Timeout(Exception): pass
def _alarm(sig, frm): raise _Timeout()
signal.signal(signal.SIGALRM, _alarm)
def _t(name, fn):
    try:
        signal.setitimer(signal.ITIMER_REAL, 3.0)
        ok = bool(fn())
    except BaseException:
        ok = False
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    print(("__PASS__ " if ok else "__FAIL__ ") + name, flush=True)
`;

/** 코딩 태스크 공통 채점 — 모델 코드 + 드라이버 실행 → 통과/전체 비율 × max. */
function makeCodingGrade(fnName: string, driver: string): BenchTask['grade'] {
  return async (answer, exec) => {
    const code = extractCodeBlock(answer);
    if (!new RegExp(`def\\s+${fnName}\\s*\\(`).test(code)) {
      return { score: 0, max: CODING_MAX, detail: `함수 ${fnName} 미정의(추출 코드에 없음)` };
    }
    const source = `${code}\n${PY_DRIVER}\n${driver}\n`;
    const r = await exec(source);
    const { passed, failed, failedNames } = tallyMarkers(r.stdout);
    const total = passed + failed;
    if (total === 0) {
      const err = r.timedOut ? '실행 타임아웃' : (r.stderr.trim().slice(0, 160) || '마커 출력 없음');
      return { score: 0, max: CODING_MAX, detail: `실행 실패: ${err}` };
    }
    const score = Math.round((passed / total) * CODING_MAX);
    return { score, max: CODING_MAX, detail: `${passed}/${total} 통과${failedNames.length ? ` (실패: ${failedNames.join(',')})` : ''}` };
  };
}

const CODING_TASKS: BenchTask[] = [
  {
    id: 'coding.interval-merge',
    category: 'coding',
    max: CODING_MAX,
    difficulty: 'easy',
    prompt: [
      '파이썬 함수 `merge_intervals(intervals)` 를 구현하라.',
      '- intervals: [start, end] 쌍의 리스트(정수). 겹치거나 맞닿은(예: [1,4],[4,5]) 구간을 합친다.',
      '- 반환: start 오름차순으로 정렬된 합쳐진 구간 리스트.',
      '- 입력 리스트를 변형하지 말 것(불변).',
      '설명 없이 ```python 코드블록``` 하나로 함수만 답하라.',
    ].join('\n'),
    grade: makeCodingGrade('merge_intervals', `
_t("overlap", lambda: merge_intervals([[1,3],[2,6],[8,10],[15,18]]) == [[1,6],[8,10],[15,18]])
_t("adjacent", lambda: merge_intervals([[1,4],[4,5]]) == [[1,5]])
_t("unsorted", lambda: merge_intervals([[8,10],[1,3],[2,6]]) == [[1,6],[8,10]])
_t("single", lambda: merge_intervals([[1,1]]) == [[1,1]])
def _imm():
    src=[[1,3],[2,6]]; snap=[list(x) for x in src]; merge_intervals(src); return src==snap
_t("immutable", _imm)
`),
  },
  {
    id: 'coding.csv-parse',
    category: 'coding',
    max: CODING_MAX,
    difficulty: 'medium',
    prompt: [
      '파이썬 함수 `parse_csv_line(line)` 를 구현하라.',
      '- CSV 한 줄을 파싱: 쉼표로 필드 구분. 큰따옴표로 감싼 필드는 내부에 쉼표를 포함할 수 있다.',
      '- 필드 내 이스케이프된 따옴표는 "" (두 개) 로 표현되며 하나의 " 로 해석.',
      '- 반환: 따옴표를 벗긴 필드 문자열 리스트.',
      '설명 없이 ```python 코드블록``` 하나로 함수만 답하라.',
    ].join('\n'),
    grade: makeCodingGrade('parse_csv_line', `
_t("plain", lambda: parse_csv_line("a,b,c") == ["a","b","c"])
_t("quoted_comma", lambda: parse_csv_line('"a,b",c') == ["a,b","c"])
_t("escaped_quote", lambda: parse_csv_line('"she said ""hi""",x') == ['she said "hi"',"x"])
_t("empty_fields", lambda: parse_csv_line("a,,c") == ["a","","c"])
_t("trailing_empty", lambda: parse_csv_line("a,b,") == ["a","b",""])
`),
  },
  {
    id: 'coding.regex-match',
    category: 'coding',
    max: CODING_MAX,
    difficulty: 'hard',
    prompt: [
      '파이썬 함수 `regex_match(s, p)` 를 구현하라 — 정규식 매칭(문자열 s 전체가 패턴 p 에 매칭되는지).',
      '- `.` 은 임의의 한 문자와 매칭.',
      '- `*` 은 **바로 앞 원소의 0개 이상** 반복과 매칭(예: `a*` = a 0개 이상, `.*` = 임의 문자열).',
      '- 매칭은 s **전체**를 덮어야 한다(부분 매칭 아님). `re` 모듈 등 내장 정규식 사용 금지, 직접 구현하라.',
      '- 반환: bool.',
      '설명 없이 ```python 코드블록``` 하나로 함수만 답하라.',
    ].join('\n'),
    grade: makeCodingGrade('regex_match', `
_t("no_star", lambda: regex_match("aa","a") == False)
_t("star_repeat", lambda: regex_match("aa","a*") == True)
_t("dot_star", lambda: regex_match("ab",".*") == True)
_t("mixed_star", lambda: regex_match("aab","c*a*b") == True)
_t("no_full_match", lambda: regex_match("mississippi","mis*is*p*.") == False)
_t("empty_star", lambda: regex_match("","a*") == True)
_t("dot_mid", lambda: regex_match("abc","a.c") == True)
_t("star_then_lit", lambda: regex_match("aaa","a*a") == True)
_t("trailing_star_zero", lambda: regex_match("a","ab*") == True)
_t("both_empty", lambda: regex_match("","") == True)
`),
  },
  {
    id: 'coding.eval-expr',
    category: 'coding',
    max: CODING_MAX,
    difficulty: 'hard',
    prompt: [
      '파이썬 함수 `eval_expr(expr)` 를 구현하라 — 정수 산술식 문자열을 평가한다.',
      '- 지원: 정수, 이항 연산 `+ - * /`, 괄호, 단항 마이너스, 임의의 공백.',
      '- 연산자 우선순위: `* /` 가 `+ -` 보다 높고, 같은 우선순위는 좌결합.',
      '- 나눗셈 `/` 는 **0 방향 절삭(truncate toward zero)** 정수 나눗셈(예: -6/4 == -1, 100/7 == 14).',
      '- 0으로 나누는 입력은 주어지지 않는다. `eval`/`exec` 같은 내장 평가 함수 사용 금지, 직접 파싱하라.',
      '- 반환: 정수.',
      '설명 없이 ```python 코드블록``` 하나로 함수만 답하라.',
    ].join('\n'),
    grade: makeCodingGrade('eval_expr', `
_t("prec", lambda: eval_expr("1+2*3") == 7)
_t("paren", lambda: eval_expr("(1+2)*3") == 9)
_t("mixed", lambda: eval_expr("2*3+4*5") == 26)
_t("left_assoc", lambda: eval_expr("10-2-3") == 5)
_t("unary", lambda: eval_expr("-(3+4)") == -7)
_t("nested", lambda: eval_expr("2*(3+(4-1))") == 12)
_t("trunc_pos", lambda: eval_expr("100/7") == 14)
_t("spaces", lambda: eval_expr(" 3 + 4 ") == 7)
_t("trunc_neg", lambda: eval_expr("-6/4") == -1)
`),
  },
  {
    id: 'coding.min-coins',
    category: 'coding',
    max: CODING_MAX,
    difficulty: 'hard',
    prompt: [
      '파이썬 함수 `min_coins(coins, amount)` 를 구현하라 — 액수를 만드는 최소 동전 개수.',
      '- coins: 양의 정수 액면 리스트(무한히 사용 가능). amount: 만들 목표 정수(≥0).',
      '- 정확히 amount 를 만드는 데 필요한 **최소 동전 개수**를 반환. amount == 0 이면 0.',
      '- 어떤 조합으로도 만들 수 없으면 -1 을 반환(그리디가 아니라 최적해여야 함).',
      '설명 없이 ```python 코드블록``` 하나로 함수만 답하라.',
    ].join('\n'),
    grade: makeCodingGrade('min_coins', `
_t("basic", lambda: min_coins([1,2,5], 11) == 3)
_t("impossible", lambda: min_coins([2], 3) == -1)
_t("zero", lambda: min_coins([1], 0) == 0)
_t("multi", lambda: min_coins([2,5,10,1], 27) == 4)
_t("impossible2", lambda: min_coins([5,10], 3) == -1)
_t("non_greedy", lambda: min_coins([1,3,4], 6) == 2)
_t("pair", lambda: min_coins([7,2,3,6], 13) == 2)
`),
  },
];

// ─── 추론(30점) — 결정론 규칙 채점 · 부분점수 granularity ──────────────────────────

/** 답변 마지막의 `ANSWER: ...` 값을 추출(대소문자·공백 관대). 없으면 null. */
export function extractAnswerTag(answer: string): string | null {
  const matches = [...answer.matchAll(/ANSWER\s*[:：]\s*(.+)/gi)];
  if (!matches.length) return null;
  return matches[matches.length - 1]![1]!.trim();
}

// ── flexible-extract 폴백(개선 A · lm-eval-harness flexible-extract 근거) ──────────
// 태그 미준수 모델(특히 thinking 모델)을 format-sensitivity 로 부당하게 0점 처리하지 않도록, ANSWER 태그가
// 없으면 응답에서 "마지막 신호"를 결정론적으로 추출한다. strict(태그) 우선·폴백은 관대.

/** 텍스트에서 마지막 정수(음수 포함). 없으면 null. */
export function flexibleLastInt(text: string): number | null {
  const nums = text.match(/-?\d+/g);
  if (!nums) return null;
  return Number.parseInt(nums[nums.length - 1]!, 10);
}

/** 텍스트에서 패턴의 마지막 매치(그룹1). 없으면 null. 단어경계로 산문 오탐 완화. */
export function flexibleLastToken(text: string, re: RegExp): string | null {
  const ms = [...text.matchAll(re)];
  if (!ms.length) return null;
  return ms[ms.length - 1]![1] ?? ms[ms.length - 1]![0];
}

/** `key=value` 쌍을 텍스트 전체에서 마지막 값으로 수집(순서 무관·flexible). key 는 대소문자 무시.
 *  ⚠️ 꺾쇠 관대: 모델이 프롬프트 템플릿(`P=<T|L>`)의 `<>` 를 그대로 echo 해 `P=<T>` 로 답하는 경우가
 *  흔하다(라이브 실측 ornith). 이는 **올바른 답**이므로 `=` 뒤 선택적 `<` 를 건너뛰고 값을 잡는다. */
function collectPairs(text: string, keys: readonly string[], valRe: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const re = new RegExp(`${k}\\s*=\\s*<?\\s*(${valRe})`, 'gi');
    const ms = [...text.matchAll(re)];
    if (ms.length) out[k.toLowerCase()] = ms[ms.length - 1]![1]!;
  }
  return out;
}

const REASONING_TASKS: BenchTask[] = [
  {
    id: 'reasoning.schedule',
    category: 'reasoning',
    max: 10,
    difficulty: 'hard',
    prompt: [
      '논리 퍼즐: A, B, C, D, E, F, G 일곱 명을 월~일(각자 하루, 서로 다른 요일)에 배치한다.',
      '조건:',
      '1) A 는 월요일이다.',
      '2) G 는 일요일이다.',
      '3) C 는 화요일이다.',
      '4) F 는 토요일이다.',
      '5) D 는 C 의 바로 다음 요일이다.',
      '6) E 는 B 의 바로 다음 요일이다.',
      '7) B 는 D 보다 뒤 요일이다.',
      '각 요일에 누가 오는지 유일 해를 구하라.',
      '마지막 줄에 정확히: `ANSWER: Mon=?,Tue=?,Wed=?,Thu=?,Fri=?,Sat=?,Sun=?` (?는 이름).',
    ].join('\n'),
    grade: async (answer) => {
      const truth: Record<string, string> = { mon: 'A', tue: 'C', wed: 'D', thu: 'B', fri: 'E', sat: 'F', sun: 'G' };
      const src = extractAnswerTag(answer) ?? answer;
      const map: Record<string, string> = {};
      // 꺾쇠 관대(`Mon=<A>` echo 허용).
      for (const m of src.matchAll(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*=\s*<?\s*([A-G])/gi)) map[m[1]!.toLowerCase()] = m[2]!.toUpperCase();
      if (Object.keys(map).length === 0) return { score: 0, max: 10, detail: '요일 배치 파싱 실패' };
      let correct = 0;
      for (const k of Object.keys(truth)) if (map[k] === truth[k]) correct++;
      return { score: Math.round((correct / 7) * 10), max: 10, detail: `${correct}/7 요일 정답` };
    },
  },
  {
    id: 'reasoning.sequence',
    category: 'reasoning',
    max: 10,
    difficulty: 'hard',
    prompt: [
      '수열 a(n) 을 다음으로 정의한다:',
      '- a(1) = 2',
      '- n ≥ 2 이면 a(n) = a(n-1) × 2 − n',
      'a(6) 과 a(8) 의 값을 각각 구하라(음수 가능·단계별로 정확히 계산).',
      '마지막 줄에 정확히: `ANSWER: a6=<숫자>,a8=<숫자>`',
    ].join('\n'),
    grade: async (answer) => {
      const src = extractAnswerTag(answer) ?? answer;
      const pairs = collectPairs(src, ['a6', 'a8'], '-?\\d+');
      const a6ok = pairs.a6 !== undefined && Number.parseInt(pairs.a6, 10) === -24;
      const a8ok = pairs.a8 !== undefined && Number.parseInt(pairs.a8, 10) === -118;
      const correct = (a6ok ? 1 : 0) + (a8ok ? 1 : 0);
      return { score: correct * 5, max: 10, detail: `a6 ${a6ok ? '✓' : '✗'} · a8 ${a8ok ? '✓' : '✗'} (정답 -24·-118)` };
    },
  },
  {
    id: 'reasoning.deduction',
    category: 'reasoning',
    max: 10,
    difficulty: 'hard',
    prompt: [
      'P, Q, R, S 네 사람은 각자 항상 참만 말하는 "정직자(T)" 또는 항상 거짓만 말하는 "거짓말쟁이(L)" 이다.',
      '- P 가 말한다: "Q 는 거짓말쟁이다."',
      '- Q 가 말한다: "R 은 정직자다."',
      '- R 이 말한다: "S 는 거짓말쟁이다."',
      '- S 가 말한다: "P 와 Q 는 둘 다 거짓말쟁이다."',
      '각자의 유형을 논리적으로 결정하라(유일 해).',
      '마지막 줄에 정확히: `ANSWER: P=<T|L>,Q=<T|L>,R=<T|L>,S=<T|L>`',
    ].join('\n'),
    grade: async (answer) => {
      const truth: Record<string, string> = { p: 'L', q: 'T', r: 'T', s: 'L' };
      const src = extractAnswerTag(answer) ?? answer;
      const pairs = collectPairs(src, ['P', 'Q', 'R', 'S'], '[TL]');
      if (Object.keys(pairs).length === 0) return { score: 0, max: 10, detail: '유형 파싱 실패' };
      let correct = 0;
      for (const k of Object.keys(truth)) if ((pairs[k] ?? '').toUpperCase() === truth[k]) correct++;
      return { score: Math.round((correct / 4) * 10), max: 10, detail: `${correct}/4 유형 정답 (정답 P=L·Q=T·R=T·S=L)` };
    },
  },
];

// ─── RAG / 근거 인용(10점) — 긍정·부정 2문항(항상-거부 패턴매칭 방지) ─────────────────

const RAG_SOURCE = [
  'ELANOUS OPS POLICY (발췌):',
  '- 스테이징 배포는 담당자 재량으로 즉시 진행할 수 있다.',
  '- 프로덕션 라우팅(production routing) 변경은 병합 전에 반드시 리뷰 게이트(review gate) 승인을 거쳐야 한다.',
  '- 문서 오탈자 수정은 리뷰 없이 병합 가능하다.',
].join('\n');

/** RAG 채점 공통 — 근거 인용(2점) + 판정 정확(3점) = 5점. verdict 태그 우선·flexible 폴백. */
function gradeRag(answer: string, wantVerdict: 'APPROVE' | 'REJECT', citeRe: RegExp): BenchGradeResult {
  const cited = citeRe.test(answer);
  // 꺾쇠 관대(`VERDICT: <REJECT>` echo 허용).
  const tagged = answer.match(/VERDICT\s*[:：]\s*<?\s*(APPROVE|REJECT)/i)?.[1]?.toUpperCase();
  // 태그 없으면 한국어 판정어로 폴백(관대).
  let verdict = tagged;
  if (!verdict) {
    const rejectSignal = /거부|불가|안\s*된다|필요하다|must|required|reject/i.test(answer);
    const approveSignal = /승인|가능|허용|바로\s*병합|approve|ok/i.test(answer);
    if (rejectSignal && !approveSignal) verdict = 'REJECT';
    else if (approveSignal && !rejectSignal) verdict = 'APPROVE';
  }
  let score = 0;
  if (cited) score += 2;
  if (verdict === wantVerdict) score += 3;
  return { score, max: 5, detail: `근거인용 ${cited ? '✓' : '✗'} · 판정 ${verdict ?? '?'}(정답 ${wantVerdict})` };
}

const RAG_TASKS: BenchTask[] = [
  {
    id: 'rag.reject-production',
    category: 'rag',
    max: 5,
    difficulty: 'medium',
    prompt: [
      '아래 SOURCE 만 근거로 판단하라(외부 지식 금지).',
      '',
      RAG_SOURCE,
      '',
      '질문: "프로덕션 라우팅 변경을 리뷰 없이 바로 병합해도 되는가?"',
      '근거 문장을 인용하고 승인/거부를 판단하라. 마지막 줄에 정확히: `VERDICT: <APPROVE|REJECT>`',
    ].join('\n'),
    grade: async (answer) => gradeRag(answer, 'REJECT', /리뷰\s*게이트|review\s*gate/i),
  },
  {
    id: 'rag.approve-typo',
    category: 'rag',
    max: 5,
    difficulty: 'medium',
    prompt: [
      '아래 SOURCE 만 근거로 판단하라(외부 지식 금지).',
      '',
      RAG_SOURCE,
      '',
      '질문: "문서 오탈자 수정을 리뷰 없이 바로 병합해도 되는가?"',
      '근거 문장을 인용하고 승인/거부를 판단하라. 마지막 줄에 정확히: `VERDICT: <APPROVE|REJECT>`',
    ].join('\n'),
    grade: async (answer) => gradeRag(answer, 'APPROVE', /오탈자|리뷰\s*없이/i),
  },
];

// ─── 한국어 형식 준수(10점) ────────────────────────────────────────────

const KR_TASKS: BenchTask[] = [
  {
    id: 'kr-format.four-line',
    category: 'kr-format',
    max: 10,
    difficulty: 'easy',
    prompt: [
      '어떤 배포 사고를 회고한다. 정확히 4줄로, 각 줄을 아래 접두어로 시작해 한국어로만 작성하라(영문 금지):',
      '1줄) `원인:` (반드시 "출처" 포함)',
      '2줄) `위험:` (반드시 "기록" 포함)',
      '3줄) `조치:` (반드시 "검증" 포함)',
      '4줄) `확인:` (반드시 "보류" 포함)',
      '접두어와 지정 단어를 정확히 지키고, 다른 줄/설명/코드블록을 추가하지 말 것.',
    ].join('\n'),
    grade: async (answer) => {
      const lines = answer.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      const checks: Array<[string, boolean]> = [];
      checks.push(['4줄', lines.length === 4]);
      const prefixes = ['원인:', '위험:', '조치:', '확인:'];
      const keywords = ['출처', '기록', '검증', '보류'];
      for (let i = 0; i < 4; i++) {
        const line = lines[i] ?? '';
        checks.push([`${prefixes[i]}시작`, line.startsWith(prefixes[i]!)]);
        checks.push([`${keywords[i]}포함`, line.includes(keywords[i]!)]);
      }
      // 영문 금지 — 접두어(원인/위험/조치/확인)엔 ASCII 없음. 본문에 라틴 알파벳 있으면 위반.
      checks.push(['영문없음', !/[A-Za-z]/.test(lines.slice(0, 4).join('\n'))]);
      const passed = checks.filter(([, ok]) => ok).length;
      const score = Math.round((passed / checks.length) * 10);
      const fails = checks.filter(([, ok]) => !ok).map(([n]) => n);
      return { score, max: 10, detail: `${passed}/${checks.length} 체크${fails.length ? ` (실패: ${fails.join(',')})` : ''}` };
    },
  },
];

/** 전체 평가 뱅크(순서 고정 — 대표 방식: 같은 문항 같은 순서). 코딩50·추론30·RAG10·형식10 = 100. */
export const BENCH_TASKS: readonly BenchTask[] = [
  ...CODING_TASKS,
  ...REASONING_TASKS,
  ...RAG_TASKS,
  ...KR_TASKS,
];

/** 카테고리별 만점 합. */
export function categoryMaxes(tasks: readonly BenchTask[] = BENCH_TASKS): Record<BenchCategory, number> {
  const out: Record<BenchCategory, number> = { coding: 0, reasoning: 0, rag: 0, 'kr-format': 0 };
  for (const t of tasks) out[t.category] += t.max;
  return out;
}
