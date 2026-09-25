// ⭐ `rejected-tool` 은 **부정 기대**(대조군)를 위해 붙였다 — nl-selfdev-trigger-corpus 의 `D0`
//    티어처럼 *"이 툴만은 쏘면 안 된다"* 를 재는 칸이 있다. 대조군 없이 트리거율만 재면
//    *"아무 말에나 쏘는 것"* 이 만점을 받는다(정규식 강제가 0/5 로 실패한 길).
export type RoutingOutcome = 'pass' | 'no-fire' | 'wrong-tool' | 'rejected-tool';

export interface RoutingRecord {
  outcome: RoutingOutcome;
}

export interface PassSummary {
  passes: number;
  runs: number;
  expectedRuns: number;
}

export interface WilsonInterval {
  lower: number;
  upper: number;
}

/** ⛔⭐⭐ **`id` 는 전역 유일이 아니다** — `monad logs` 자신이 경고한다:
 *  *"연합(`--all`) 조회는 **행 id 가 인스턴스마다 독립**이라 `--before` 를 쓸 수 없다"*.
 *  연합 조회로 여러 저장소를 합치면 **같은 숫자 id 가 여러 인스턴스에** 존재한다.
 *  ⇒ 턴 경계·바이트 조회는 반드시 **`instance` + `id` 복합 키**로 묶는다. 안 그러면
 *  ⑴ 다른 인스턴스가 그 번호를 이미 썼다는 이유로 **새 턴을 건너뛰거나**
 *  ⑵ **남의 행의 `textBytes`** 로 인과를 오판한다. */
export interface TurnBoundary {
  startId: number;
  /** 그 행이 있던 로그 저장소. 단일 인스턴스 조회면 빈 문자열. */
  instance: string;
  timestamp: string;
  /** ⛔⭐⭐ **실측(2026-08-01): `input.submit` 은 `runId` 를 내지 않는다** — 최상위·중첩 전수 0건.
   *  종전 계약은 이것을 **필수**로 요구해서 턴 경계가 **영영 안 잡혔다**(오늘의 표기 불일치와 같은 계열 —
   *  존재하지 않는 필드를 가정한 계약). ⇒ 있으면 쓰고 없으면 `null`.
   *  ⚠️ `null` 이면 시작/종료를 **세션·인스턴스·id 순서**로 짝짓는다 — 같은 세션에 **동시 제출**이
   *  들어오면 남의 종료를 내 턴의 종료로 볼 수 있다. 러너는 직렬이라 실제 위험은 낮지만 **숨기지 않는다.** */
  runId: string | null;
}

/** 연합 조회에서 한 행을 가리키는 유일 키. */
export function logRowKey(instance: string | undefined, id: number): string {
  return `${instance ?? ''}#${id}`;
}

export interface ClosedTurnBoundary extends TurnBoundary {
  completedAt: string;
}

/** ⛔⭐⭐ **로그 한 행 안에서 표기가 갈린다** — 실측(2026-08-01 `monad logs --json`):
 *  최상위는 **snake_case**(`ts` · `session_id`) 인데 **중첩 `data` 는 camelCase**(`sessionId`) 다.
 *  ```
 *  {"ts":"…","session_id":"a4292021-…","data":"{\"sessionId\":\"a4292021-…\",\"tool\":\"Edit\"}"}
 *  ```
 *  ⇒ 한쪽 표기만 읽으면 **아무 에러도 안 나고 조용히 0건**이 된다(이 러너가 오래 못 돈 이유).
 *  ⇒ 아래 `stringField`·`timestampOf` 는 **양쪽 표기를 모두** 받는다. */
interface LogRow {
  id?: number;
  ts?: string;
  timestamp?: string;
  event?: string;
  session_id?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  run_id?: string | null;
  tool?: string | null;
  instance?: string;
  data?: unknown;
}

export function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function positiveIntegerList(value: string | undefined, name: string, fallback: readonly number[]): number[] {
  const values = value?.trim() ? value.split(',').map((part) => Number(part.trim())) : [...fallback];
  if (values.length === 0 || values.some((item) => !Number.isInteger(item) || item < 1)) {
    throw new Error(`${name} must be a comma-separated list of positive integers`);
  }
  return values;
}

/** ⛔ 판정 순서가 계약이다(코퍼스 `grading` 문면과 1:1).
 *  ⑴ 금지 툴이 돌았으면 다른 무엇이 돌았든 실패다 — 대조군의 전부가 이 한 줄이다.
 *  ⑵ `accept` 가 비면 통과다: 대조군 항목은 *"금지 툴만 안 쏘면 무엇을 하든 좋다"* 이므로
 *     조회 툴이 돌아도, 툴 없이 말로만 답해도 옳다.
 *  ⚠️ 그래서 `accept`·`reject` 가 **둘 다 비면 무조건 통과하는 칸**이 된다 — 아무것도 증명하지
 *     않는 항목이므로 코퍼스를 읽는 쪽에서 거부한다(`assertGradableItems`). */
export function classifyRouting(
  fired: readonly string[],
  accept: readonly string[],
  reject: readonly string[] = [],
): RoutingOutcome {
  if (fired.some((tool) => reject.includes(tool))) return 'rejected-tool';
  // ⛔ **`reject` 가 있을 때만** 빈 `accept` 를 통과로 읽는다(1R 리뷰 must-fix ①).
  //    종전엔 `accept` 만 비어도 `pass` 였는데, 그러면 `classifyRouting(['X'], [])` 이
  //    `wrong-tool` → `pass` 로 뒤집혀 **부정 기대와 무관한 기존 호출부가 조용히 바뀐다.**
  //    ⚠️ 내 무회귀 테스트가 이걸 못 잡았다 — `accept` 가 빈 경우를 안 봤다.
  if (reject.length > 0 && accept.length === 0) return 'pass';
  if (fired.length === 0) return 'no-fire';
  return fired.some((tool) => accept.includes(tool)) ? 'pass' : 'wrong-tool';
}

/** 계약이 허용하는 모양(`accept` 누락 = 대조군)을 러너가 **받을 수 있게** 만든다.
 *  ⛔ 러너 안에 인라인으로 두면 증명할 수가 없다 — `assertGradableItems` 는 통과시키는데
 *  러너가 `item.accept.length` 에서 죽는 경로를 테스트가 못 잡는다(3R 리뷰 should-fix ①). */
export function normalizeCorpusItems<T extends { accept?: readonly string[] }>(
  items: readonly T[],
): (T & { accept: readonly string[] })[] {
  return items.map((item) => ({ ...item, accept: item.accept ?? [] }));
}

/** ⛔ 프로브 문장이 **코퍼스 밖**인지 확인한다 — 문항으로 프로브하면 그 회차가 표본에 섞여
 *  수를 조용히 오염시킨다. 계약을 주석으로만 적어 두면 지켜지지 않으므로 실행 시 거부한다.
 *  ⚠️ 공백만 다른 경우도 같은 문장으로 본다(사람이 `CORPUS_PROBE_TEXT` 를 손으로 넣기 때문). */
export function assertProbeOutsideCorpus(probe: string, prompts: readonly string[]): void {
  const norm = (value: string) => value.replace(/\s+/g, ' ').trim();
  const probeNorm = norm(probe);
  if (!probeNorm) throw new Error('probe text must not be empty');
  if (prompts.some((prompt) => norm(prompt) === probeNorm)) {
    throw new Error(`probe text is a corpus prompt; measuring it would contaminate the sample: ${probe}`);
  }
}

/** 채점 가능한 항목인지 로드 시점에 거른다 — `accept`·`reject` 가 둘 다 비면 그 칸은
 *  **늘 통과**하고, 늘 통과하는 검사는 아무것도 증명하지 않는다. ⛔ 조용히 통과시키지 않고 던진다. */
export function assertGradableItems(
  items: readonly { id: string; accept?: readonly string[]; reject?: readonly string[] }[],
): void {
  const ungradable = items
    .filter((item) => (item.accept?.length ?? 0) === 0 && (item.reject?.length ?? 0) === 0)
    .map((item) => item.id);
  if (ungradable.length > 0) {
    throw new Error(`corpus items have neither accept nor reject (always pass, prove nothing): ${ungradable.join(', ')}`);
  }
}

export function passSummary(records: readonly RoutingRecord[], expectedRuns = records.length): PassSummary {
  return {
    passes: records.filter((record) => record.outcome === 'pass').length,
    runs: records.length,
    expectedRuns,
  };
}

export interface CorpusRunSummary {
  perItem: { id: string; summary: PassSummary }[];
  /** ⭐ 경계·측정 불가 문항을 **뺀** 합계. 이것이 보고되는 수다. */
  aggregate: PassSummary;
  /** 경계 문항만의 합계. 경계가 없으면 null. */
  boundary: PassSummary | null;
  boundaryIds: string[];
  /** 기대 툴이 선택한 서피스에 없는 문항의 별도 합계. */
  unmeasurable: PassSummary | null;
  unmeasurableIds: string[];
  /** 회차마다 결과가 갈린, 측정 가능한 문항 — 확률 표본이라는 사실을 드러내는 자리. */
  fluctuating: string[];
}

/** 기대 툴이 하나 이상인 문항만 서피스 가용성으로 측정 불가가 될 수 있다.
 * `accept`가 비어 있는 부정 기대 대조군은 어느 서피스에서도 그대로 채점 가능하다. */
export function unavailableExpectedToolIds(
  items: readonly { id: string; accept: readonly string[] }[],
  availableToolNames: readonly string[],
): string[] {
  const available = new Set(availableToolNames);
  return items
    .filter((item) => item.accept.length > 0 && !item.accept.some((tool) => available.has(tool)))
    .map((item) => item.id);
}

/** ⛔ 집계를 **순수 함수**로 뺀다(5R 리뷰 must-fix) — 종전엔 러너 안에 인라인이라
 *  *"경계 문항을 합계에서 뺀다"* 는 계약을 테스트가 **주장만** 하고 증명하지 못했다
 *  (fixture 에 `boundary` 가 있는지만 봤다 = Goodhart). 계약은 그 계약이 실제로 적용된
 *  **결과**로 잠가야 한다. */
export function summarizeCorpusRun(
  items: readonly { id: string; boundary?: boolean; unmeasurable?: boolean }[],
  records: readonly (RoutingRecord & { id: string })[],
  expectedRuns: number,
): CorpusRunSummary {
  const unmeasurableIds = items.filter((item) => item.unmeasurable).map((item) => item.id);
  const isUnmeasurable = new Set(unmeasurableIds);
  const boundaryIds = items.filter((item) => item.boundary && !isUnmeasurable.has(item.id)).map((item) => item.id);
  const isBoundary = new Set(boundaryIds);
  const perItem = items.map((item) => ({
    id: item.id,
    summary: passSummary(records.filter((record) => record.id === item.id), expectedRuns),
  }));
  // ⛔ 합계의 `expectedRuns` 를 **실제 레코드 수**로 두면, 런이 중간에 끊겨도 `4/4` 처럼
  //    완전해 보인다(6R 리뷰 should-fix). 부재와 미지가 같은 값이면 거짓을 생산한다.
  //    ⇒ 기대 회차는 **문항 수 × 회차**로 따로 계산해, 모자란 것이 수에 드러나게 한다.
  const boundaryCount = boundaryIds.length;
  const unmeasurableCount = unmeasurableIds.length;
  return {
    perItem,
    aggregate: passSummary(
      records.filter((record) => !isBoundary.has(record.id) && !isUnmeasurable.has(record.id)),
      (items.length - boundaryCount - unmeasurableCount) * expectedRuns,
    ),
    boundary: boundaryCount > 0
      ? passSummary(records.filter((record) => isBoundary.has(record.id)), boundaryCount * expectedRuns)
      : null,
    boundaryIds,
    unmeasurable: unmeasurableCount > 0
      ? passSummary(records.filter((record) => isUnmeasurable.has(record.id)), unmeasurableCount * expectedRuns)
      : null,
    unmeasurableIds,
    fluctuating: perItem
      .filter(({ id, summary }) => !isUnmeasurable.has(id) && summary.passes > 0 && summary.passes < summary.runs)
      .map(({ id }) => id),
  };
}

/** Two-sided 95% Wilson score interval for a binomial pass proportion. */
export function wilsonInterval(passes: number, runs: number): WilsonInterval | null {
  if (!Number.isInteger(passes) || !Number.isInteger(runs) || runs < 1 || passes < 0 || passes > runs) return null;
  const z = 1.96;
  const zSquared = z ** 2;
  const proportion = passes / runs;
  const denominator = 1 + zSquared / runs;
  const center = (proportion + zSquared / (2 * runs)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * runs)) / runs) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

/** The live authority decision is the median of repeated binary pass outcomes. */
export function medianPassVerdict(records: readonly RoutingRecord[], expectedRuns = records.length): 'pass' | 'fail' | 'unmeasurable' {
  if (records.length === 0 || records.length < expectedRuns) return 'unmeasurable';
  const values = records.map((record) => record.outcome === 'pass' ? 1 : 0).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return median >= 0.5 ? 'pass' : 'fail';
}

function parseLogLine(line: string): LogRow | null {
  try { return JSON.parse(line) as LogRow; } catch { return null; }
}

/** 로그 행의 `data` — 실제 CLI 출력은 **JSON 문자열**이고 일부 소스는 객체다. 둘 다 받는다.
 *  ⛔ 문자열 경우를 안 풀면 `data.ptyId` 류가 영영 undefined 다(조용한 0건). */
export function parseLogData(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

/** 한 논리 필드의 **양쪽 표기**를 최상위 → 중첩 순으로 찾는다. 첫 문자열이 답이다. */
export function logStringField(row: Record<string, unknown>, field: 'session_id' | 'runId' | 'tool'): string | undefined {
  const aliases: readonly string[] = field === 'session_id'
    ? ['session_id', 'sessionId']
    : field === 'runId'
      ? ['runId', 'run_id']
      : ['tool'];
  const nested = parseLogData((row as Record<string, unknown>).data);
  for (const key of aliases) {
    const topLevel = (row as Record<string, unknown>)[key];
    if (typeof topLevel === 'string') return topLevel;
  }
  for (const key of aliases) {
    const value = nested?.[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/** 행이 어느 로그 저장소에서 왔나. 단일 인스턴스 조회면 없을 수 있다. */
function instanceOf(row: LogRow): string | undefined {
  const value = (row as Record<string, unknown>).instance;
  return typeof value === 'string' ? value : undefined;
}

/** 행의 타임스탬프 — 실제 로그는 `ts`, 옛 픽스처·타 소스는 `timestamp`. 둘 다 받는다. */
function timestampOf(row: LogRow): string | undefined {
  if (typeof row.ts === 'string') return row.ts;
  return typeof row.timestamp === 'string' ? row.timestamp : undefined;
}

/**
 * Scores only real tool-selected rows for the target session and closed turn.
 * tool-selected guarantees top-level event/sessionId/tool; runId is an optional
 * extra correlation key because older and current producers do not all emit it.
 */
export function toolsForSessionTurn(raw: string, sessionId: string, boundary?: ClosedTurnBoundary): string[] {
  const tools: string[] = [];
  for (const line of raw.split('\n')) {
    const row = parseLogLine(line);
    // ⛔ `tool` 도 **최상위에 없을 수 있다** — 실측된 실제 행은 `data` 안에만 담는다.
    //    종전엔 `row.tool` 만 봐서, 세션·시각을 다 맞춰도 **툴이 하나도 안 잡혔다**.
    const tool = row ? logStringField(row as Record<string, unknown>, 'tool') : undefined;
    if (!row || row.event !== 'tool-selected' || logStringField(row as Record<string, unknown>, 'session_id') !== sessionId || tool === undefined) continue;
    if (boundary) {
      const at = timestampOf(row);
      if (at === undefined || at < boundary.timestamp || at > boundary.completedAt) continue;
      const runId = logStringField(row as Record<string, unknown>, 'runId');
      if (runId !== undefined && runId !== boundary.runId) continue;
    }
    tools.push(tool);
  }
  return [...new Set(tools)];
}

/** Finds a new session-scoped submit start with the run identity required to close and score the turn. */
export function turnStartedAfter(raw: string, knownLogIds: ReadonlySet<string>, sessionId: string): TurnBoundary | null {
  for (const line of raw.split('\n')) {
    const row = parseLogLine(line);
    const runId = row ? logStringField(row as Record<string, unknown>, 'runId') : undefined;
    const at = row ? timestampOf(row) : undefined;
    if (row?.event !== 'execute.begin' || logStringField(row as Record<string, unknown>, 'session_id') !== sessionId || typeof row.id !== 'number' || knownLogIds.has(logRowKey(instanceOf(row), row.id)) || at === undefined) continue;
    return { startId: row.id, instance: instanceOf(row) ?? '', timestamp: at, runId: runId ?? null };
  }
  return null;
}

/** Completion must share the start's exact session and run identity. */
export function closedTurnBoundary(raw: string, boundary: TurnBoundary, sessionId: string): ClosedTurnBoundary | null {
  for (const line of raw.split('\n')) {
    const row = parseLogLine(line);
    const completedAt = row ? timestampOf(row) : undefined;
    if ((row?.event === 'execute.ok' || row?.event === 'execute.error')
      && logStringField(row as Record<string, unknown>, 'session_id') === sessionId
      // ⛔ `runId` 는 **있을 때만** 대조한다 — 실제 `input.submit` 은 내지 않는다(전수 0건).
      //    없으면 세션·인스턴스·id 순서로 닫는다. ⚠️ 동시 제출이 있으면 남의 종료를 볼 수 있다(직렬 전제).
      && (boundary.runId === null || logStringField(row as Record<string, unknown>, 'runId') === boundary.runId)
      && typeof row.id === 'number'
      && (instanceOf(row) ?? '') === boundary.instance
      && row.id > boundary.startId
      && completedAt !== undefined) return { ...boundary, completedAt };
  }
  return null;
}

/** 특정 로그 행(제출 시작)의 `textBytes`. ⭐ pty↔session 을 **인과로** 묶을 때 쓴다 —
 *  "내가 넣은 그 길이의 입력이 그 세션에서 시작됐다" 가 선언보다 강한 증거다. */
export function turnTextBytes(raw: string, startId: number, instance = ''): number | undefined {
  for (const line of raw.split('\n')) {
    const row = parseLogLine(line);
    // ⛔ 인스턴스까지 맞춘다 — 안 맞추면 **남의 행의 textBytes** 로 인과를 오판한다.
    if (row?.id !== startId || (instanceOf(row) ?? '') !== instance) continue;
    const bytes = parseLogData(row.data)?.textBytes;
    return typeof bytes === 'number' ? bytes : undefined;
  }
  return undefined;
}

/** ⛔ 연합 조회에서 **인스턴스마다 id 가 독립**이므로 복합 키로 모은다(2R 리뷰 must-fix). */
export function logIds(raw: string): Set<string> {
  return new Set(raw.split('\n').flatMap((line) => {
    const row = parseLogLine(line);
    return typeof row?.id === 'number' ? [logRowKey(instanceOf(row), row.id)] : [];
  }));
}

/**
 * 코퍼스를 티어 ⊕ 문항 id 로 좁힌다. **순수**.
 *
 * ⭐ 왜 필요한가 — `MEAS-T8`: ***문항 단위 판단은 집중 프로브(N≥10)로만*** 한다. 그런데 종전 러너는
 * **티어 필터만** 있어서, 한 문항을 10번 재려면 `monad repro` 같은 **다른 자**를 써야 했다.
 * ⛔ 다른 자로 잰 수는 기준선과 비교할 수 없다(형태 `F3`) ⇒ **같은 러너에서** 좁힌다.
 *
 * ⛔ 없는 id 를 조용히 무시하지 않는다 — 오타 하나가 **빈 표본을 "측정했다" 로 만든다**.
 */
export function selectCorpusItems<T extends { id: string; tier: string }>(
  items: readonly T[],
  filters: { tiers?: string; ids?: string },
): T[] {
  const tiers = (filters.tiers ?? '').trim();
  const ids = (filters.ids ?? '').trim();
  let selected = [...items];
  if (tiers) {
    // ⛔⭐⭐ 없는 티어 이름도 **이름을 대고** 거부한다 — `CORPUS_IDS` 와 같은 형태.
    //   그 전엔 티어 오타가 조용히 전부를 걸러 내고, 아래 일반 메시지가
    //   ***"필터가 서로 배타적이다" 라는 「다른 가설」을 가리켜 읽는 쪽을 오도***했다.
    //   실측(2026-08-03 · `[T]` 보고 `GOAL-T27`): 골이 `DEV-T1,DEV-T2,DEV-T3` 를 시켰고
    //   실제 티어는 `T1·T2·T3` 였다 ⇒ 자식이 **3라운드 동안** 0건을 받고 죽었으며,
    //   리뷰는 *"측정 문서가 없다"* 만 반복했고 **없는 「이유」는 아무도 못 봤다.**
    //   ⇒ ⭐ ***거부가 산출을 남겨도 그 산출이 오도하면 침묵보다 나쁠 수 있다.***
    const wantedTiers = tiers.split(',').map((tier) => tier.trim()).filter(Boolean);
    const knownTiers = new Set(items.map((item) => item.tier));
    const missingTiers = wantedTiers.filter((tier) => !knownTiers.has(tier));
    if (missingTiers.length) {
      throw new Error(`CORPUS_TIERS: 코퍼스에 없는 티어 ${missingTiers.join(', ')} — 있는 티어는 ${[...knownTiers].sort().join(', ')}`);
    }
    selected = selected.filter((item) => wantedTiers.includes(item.tier));
  }
  if (ids) {
    const wanted = ids.split(',').map((id) => id.trim()).filter(Boolean);
    const known = new Set(items.map((item) => item.id));
    const missing = wanted.filter((id) => !known.has(id));
    if (missing.length) throw new Error(`CORPUS_IDS: 코퍼스에 없는 문항 ${missing.join(', ')} — 오타를 빈 표본으로 넘기지 않는다`);
    selected = selected.filter((item) => wanted.includes(item.id));
  }
  if (!selected.length) throw new Error('선택된 문항이 0 — 필터가 서로 배타적이다(티어 ⊕ id 를 같이 줬나?)');
  return selected;
}

/** env → `selectCorpusItems` 필터. ⛔ **순수**로 뽑아 둔 이유는 배선을 테스트로 고정하기 위해서다 —
 *  순수 함수만 재면 *"필터는 맞는데 env 가 안 닿는"* 회귀를 못 잡는다(오늘 같은 계열 결손 2회). */
export function corpusFiltersFromEnv(env: Record<string, string | undefined>): { tiers?: string; ids?: string } {
  return {
    ...(env.CORPUS_TIERS ? { tiers: env.CORPUS_TIERS } : {}),
    ...(env.CORPUS_IDS ? { ids: env.CORPUS_IDS } : {}),
  };
}
