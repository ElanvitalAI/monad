import { classifyRouting, closedTurnBoundary, logIds, logStringField, parseLogData, toolsForSessionTurn, turnStartedAfter, turnTextBytes, type ClosedTurnBoundary, type RoutingOutcome } from './nl-routing-measurement.js';

interface LiveCorpusItem {
  id: string;
  accept: readonly string[];
  /** 부정 기대(대조군) — 이 툴이 돌면 실패다. 없으면 종전 의미론 그대로. */
  reject?: readonly string[];
}

export interface LiveRecord {
  id: string;
  rep: number;
  sessionId: string;
  fired: string[];
  outcome: RoutingOutcome;
  /** The turn was still open at the measurement deadline. */
  truncated?: true;
}

type CommandExecutor = (args: string[]) => string;

export function commandResult(execute: CommandExecutor, args: string[]): string | null {
  try {
    return execute(args);
  } catch {
    return null;
  }
}

export interface LiveTurnRunner {
  lifecycleLogs(sessionId: string): string | null;
  deliverInput(prompt: string): boolean;
  toolsForClosedTurn(sessionId: string, boundary: ClosedTurnBoundary): string[] | null;
  /** ⭐ 화면 지문 — 진행의 **둘째 신호**(선택 · 없으면 로그만 본다).
   *  ⛔ 왜 필요한가(실측 2026-08-02): 긴 툴 호출 하나(`RunShell` 로 `tsc`)는 **몇 분간 로그를 한 줄도
   *  안 남긴다** — 로그만 보면 「정지」로 오판한다. 반대로 진짜로 막힌 턴은
   *  `slow-tool awaiting` 을 30초마다 남겨 **로그가 자란다**. ⇒ 이 축에서 로그는 거꾸로였다.
   *  ⭐ 살아 있는 TUI 는 스트리밍 타이머를 **다시 그린다**. 그래서 지문은 숫자를 **포함**한 화면 전체다 —
   *  한 글자도 안 바뀌면 그건 「느린 것」이 아니라 **다시 그리지도 못하는 것**이다. */
  screenFingerprint?(): string | null;
}

/** ⭐⭐ **인과로** pty↔session 을 묶는다 — `lifecycle.bridge-attached` **선언이 없을 때**의 경로.
 *
 *  ⛔ 실측(2026-08-01): `dev --monad --hold` 로 붙잡은 bare TUI 는 그 선언을 **남기지 않는다**
 *  (`self_*` 하니스 pty 만 남긴다). 그래서 `verifyPtySession` 이 영영 거짓이고, 러너는
 *  **입력을 아예 안 보낸다**(남의 세션에 주입하지 않으려는 안전장치).
 *
 *  ⭐ 그렇다고 안전장치를 낮추지 않는다. 선언보다 **강한 증거**로 바꾼다:
 *  ***내가 그 pty 에 넣은 입력에, 그 세션이, 그 길이로 반응했는가.***
 *  선언은 "붙어 있다더라" 이고 이것은 "내가 넣었더니 그 세션이 움직였다" 다.
 *
 *  ⚠️ 프로브는 **실제 턴 하나를 쓴다**. 코퍼스 문항으로 프로브하지 마라(표본이 오염된다). */
export async function provePtyDrivesSession(
  runner: LiveTurnRunner,
  sessionId: string,
  probe: string,
  options: LiveTurnOptions,
): Promise<{ proven: true } | { proven: false; reason: 'snapshot-failed' | 'delivery-failed' | 'no-turn' | 'turn-not-closed' | 'length-mismatch' }> {
  const before = runner.lifecycleLogs(sessionId);
  if (before === null) return { proven: false, reason: 'snapshot-failed' };
  if (!runner.deliverInput(probe)) return { proven: false, reason: 'delivery-failed' };
  const waited = await waitForClosedTurn(runner, sessionId, logIds(before), options);
  // ⛔ 「못 쟀다」와 「턴이 안 열렸다」를 따로 돌려준다 — 뒤만이 "그 pty 는 이 세션을 몰지 않는다" 다.
  if (waited.kind !== 'closed') return { proven: false, reason: waited.kind === 'turn-not-closed' ? 'turn-not-closed' : waited.kind };
  const boundary = waited.boundary;
  const after = runner.lifecycleLogs(sessionId);
  if (after === null) return { proven: false, reason: 'snapshot-failed' };
  // ⛔⭐ **길이까지 맞춘다** — 마침 다른 곳에서 같은 세션에 제출이 들어와도 새 턴은 열린다.
  //    내가 넣은 바이트 수와 같아야 «내 입력이 연 턴» 이다.
  const bytes = turnTextBytes(after, boundary.startId, boundary.instance);
  return bytes === Buffer.byteLength(probe, 'utf8') ? { proven: true } : { proven: false, reason: 'length-mismatch' };
}

export function verifyPtySession(execute: CommandExecutor, pty: string, expectedSession: string): boolean {
  // ⛔ **여기도 중첩 인스턴스를 본다**(1R 리뷰 must-fix ②) — 자식 TUI 선언은 ⟨test:state⟩ 에
  //    쌓이므로 한 우주만 보면 **선언이 있는데도 없다고 읽고 프로브 턴을 헛되이 태운다**.
  const raw = commandResult(execute, ['logs', ...scopeArgs(), '--exact-category', 'signal', '--event', 'lifecycle.bridge-attached', '--grep', pty, '--since', '24h', '--limit', '100', '--json']);
  if (raw === null) return false;
  for (const line of raw.split('\n')) {
    try {
      // ⛔ 공용 관대 리더를 쓴다 — 종전엔 ⑴ `session_id` 한 표기만 보고 ⑵ `data` 가 **객체일 때만** 풀어서,
      //    실제 로그(최상위 snake · 중첩 camel · `data` 는 **JSON 문자열**)에서는 영영 거짓이었다.
      const row = JSON.parse(line) as Record<string, unknown>;
      const data = parseLogData(row.data);
      if (row.event === 'lifecycle.bridge-attached'
        && data?.ptyId === pty
        && logStringField(row, 'session_id') === expectedSession) return true;
    } catch { /* malformed log line */ }
  }
  return false;
}

/** ⛔⭐⭐ **중첩 인스턴스를 함께 본다** — 기본 조회는 **한 우주만** 본다.
 *
 *  실측(2026-08-01): `dev --monad --hold` 로 붙잡은 자식 TUI 의 로그는 `⟨test:state⟩` 에 쌓이는데,
 *  부모 셸의 조회(`--test` = `test:monad-agent`)로는 **0건**으로 보인다. 그 0 은 «미배선» 이 아니라
 *  **«다른 우주를 봤다»** 이고, 그대로 두면 계측이 살아 있는 판에 «없다» 로 판정한다.
 *  ⇒ 세션 id 로 이미 좁히고 있으므로 인스턴스를 넓혀도 표본이 섞이지 않는다. */
// ⛔⭐⭐⭐ 연합 조회(`--all --include-test`)는 **누적된 worktree 우주 전부**를 연다.
//   실측 2026-08-02: 이 저장소에 worktree 우주 **189개** — 한 판정마다 189개 SQLite 를 열어
//   `database is locked`·`disk I/O error` 가 쏟아지고 **인과 프로브조차 못 끝냈다**(실패 92건 · 판정 0).
//   ⇒ 측정 대상 우주를 **알면 지목한다**. 모르면 종전대로 연합한다(무회귀).
//   ⚠️ 지목은 「덜 보는 것」이 아니라 **「그 우주만 보는 것」** 이다 — 자식이 그 우주에 있음을
//      `config path` 로 확인한 뒤에만 준다.
const FEDERATED = ['--all', '--include-test'] as const;
//   ⛔⭐ 라벨(`--instance`)로는 못 좁힌다 — `test:state` 하나에 **71개 우주**가 겹친다(원장 `OBS-S16`).
//   ⇒ 좁히기는 **경로**로 한다: 호출자가 `CORPUS_STATE_DIR` 로 스토어를 못 박으면(그 값이
//     `MONAD_STATE_DIR` 로 자식 `monad` 에 실린다) 조회는 **그 스토어 하나**만 본다.
//   실측: 연합 0.6s→실패 92건·판정 0  vs  경로 지목 **0.63s·정확히 그 우주**.
const scopeArgs = (): readonly string[] => (process.env.CORPUS_STATE_DIR?.trim() ? [] : FEDERATED);
const SESSION_LINK_DEPTH_LIMIT = 8;

function linkChildrenForClosedTurn(raw: string, sessionId: string, boundary: ClosedTurnBoundary): string[] {
  const children: string[] = [];
  for (const line of raw.split('\n')) {
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const timestamp = typeof row.ts === 'string' ? row.ts : typeof row.timestamp === 'string' ? row.timestamp : undefined;
      const data = parseLogData(row.data);
      const parentSessionId = data?.parentSessionId ?? (typeof row.session_id === 'string' ? row.session_id : typeof row.sessionId === 'string' ? row.sessionId : data?.sessionId);
      const childSessionId = data?.childSessionId;
      const runId = logStringField(row, 'runId');
      if (row.event !== 'core-turn' && row.event !== 'child-scope') continue;
      if (parentSessionId !== sessionId || typeof childSessionId !== 'string') continue;
      if (timestamp === undefined || timestamp < boundary.timestamp || timestamp > boundary.completedAt) continue;
      if (runId !== undefined && runId !== boundary.runId) continue;
      children.push(childSessionId);
    } catch { /* malformed log line */ }
  }
  return children;
}

/** Production command adapter; exceptions never become empty logs or a no-fire result. */
export function createMonadLiveTurnRunner(execute: CommandExecutor, pty: string): LiveTurnRunner {
  const toolLogs = (sessionId: string, boundary: ClosedTurnBoundary) =>
    commandResult(execute, ['logs', ...scopeArgs(), '--surface', 'tui', '--exact-category', 'capability.resolve', '--event', 'tool-selected', '--session', sessionId, '--since', boundary.timestamp, '--limit', '900', '--json']);
  const linkLogs = (sessionId: string, boundary: ClosedTurnBoundary) =>
    commandResult(execute, ['logs', ...scopeArgs(), '--exact-category', 'session.link', '--session', sessionId, '--since', boundary.timestamp, '--limit', '900', '--json']);

  return {
    lifecycleLogs: (sessionId) => commandResult(execute, ['logs', ...scopeArgs(), '--surface', 'tui', '--exact-category', 'input.submit', '--session', sessionId, '--since', '1h', '--limit', '900', '--json']),
    deliverInput: (prompt) => commandResult(execute, ['pty', 'text', pty, prompt, '--enter']) !== null,
    screenFingerprint: () => commandResult(execute, ['pty', 'snapshot', pty]),
    toolsForClosedTurn: (sessionId, boundary) => {
      const tools: string[] = [];
      const visited = new Set<string>();
      let sessions = [sessionId];
      for (let depth = 0; sessions.length > 0 && depth <= SESSION_LINK_DEPTH_LIMIT; depth += 1) {
        const next: string[] = [];
        for (const currentSessionId of sessions) {
          if (visited.has(currentSessionId)) continue;
          visited.add(currentSessionId);
          const rawTools = toolLogs(currentSessionId, boundary);
          const rawLinks = linkLogs(currentSessionId, boundary);
          if (rawTools === null || rawLinks === null) return null;
          tools.push(...toolsForSessionTurn(rawTools, currentSessionId, boundary));
          next.push(...linkChildrenForClosedTurn(rawLinks, currentSessionId, boundary));
        }
        sessions = next;
      }
      return [...new Set(tools)];
    },
  };
}

export interface LiveTurnOptions {
  settleMs: number;
  pollMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type LiveTurnResult =
  | { kind: 'measured'; record: LiveRecord; openTurn?: ClosedTurnBoundary }
  | { kind: 'unmeasurable'; reason: 'snapshot-failed' | 'delivery-failed' | 'completion-failed' | 'tools-query-failed' };

/** ⛔⭐ `stalled` = **진행이 멈췄다**(경과 시간이 아니라). `deadline-expired` 는 남겨 두지만
 *  이 함수는 더 이상 내지 않는다 — 타입 소비자를 깨지 않으려는 보존이다. */
export type OpenTurnWait = 'closed' | 'deadline-expired' | 'snapshot-failed' | 'stalled';

/** Wait for an already-observed truncated turn to close without delivering another input. */
export async function waitForOpenTurnClose(runner: LiveTurnRunner, sessionId: string, openTurn: ClosedTurnBoundary, options: LiveTurnOptions): Promise<OpenTurnWait> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // ⛔⭐⭐⭐ **경과가 아니라 정지로 끊는다**(실측 2026-08-02 · F4 9차):
  //   종전엔 `deadline = now() + settleMs` 라 **아직 진행 중인 턴도 시한이 되면 죽었다.**
  //   그러면 절단 회차 하나가 남은 문항 전부를 미측정으로 만든다 — 12문항 중 3문항만 재고 멈췄다.
  //   ⇒ 그 세션의 로그가 **자라는 동안은 기다리고**, `settleMs` 동안 **한 글자도 안 늘었을 때만** 멈춘다.
  //   ⚠️ 불변식은 그대로다 — 이 함수는 **입력을 넣지 않는다**. 기다리는 방식만 바꾼다.
  //   ⭐ 진행 신호는 **둘**이다 — 로그 성장 ⊕ 화면 변화. 하나만 보면 오판한다(위 인터페이스 주석).
  let lastKey = '';
  let lastProgressAt = now();
  for (;;) {
    const raw = runner.lifecycleLogs(sessionId);
    if (raw === null) return 'snapshot-failed';
    if (closedTurnBoundary(raw, openTurn, sessionId)) return 'closed';
    const key = `${raw.length}\u0000${runner.screenFingerprint?.() ?? ''}`;
    if (key !== lastKey) {
      lastKey = key;
      lastProgressAt = now();
    } else if (now() - lastProgressAt >= options.settleMs) {
      return 'stalled';
    }
    await sleep(options.pollMs);
  }
}

/** A measured truncated turn is usable evidence, but its still-open session must receive no later corpus input. */
export function endsLiveRun(result: LiveTurnResult): boolean {
  return result.kind === 'unmeasurable' || result.record.truncated === true;
}

/** ⛔ **두 실패를 가른다**(1R 리뷰 must-fix ①) — 종전엔 «폴링 중 로그 조회 실패» 와
 *  «턴이 안 열림» 이 **같은 `null`** 이었다. 앞은 **못 잰 것**이고 뒤는 **잰 결과**다.
 *  둘을 뭉치면 「측정 실패」가 「그 pty 는 이 세션을 몰지 않는다」로 둔갑한다. */
type ClosedTurnWait =
  | { readonly kind: 'closed'; readonly boundary: ClosedTurnBoundary }
  | { readonly kind: 'snapshot-failed' }
  /** 그 세션에 **새 턴이 아예 안 열렸다** — 그 pty 가 이 세션을 몰지 않는다는 신호다. */
  | { readonly kind: 'no-turn' }
  /** ⭐ 턴은 **열렸는데 시한 안에 안 닫혔다**(3R 리뷰 should-fix) — 「안 열림」과 처방이 다르다:
   *  앞은 배선을 의심하고 이쪽은 **대기 시한**(`CORPUS_SETTLE_MS`)을 의심한다.
   *  이미 발사된 도구는 절단 시점까지 판정하고, 빈 목록은 여전히 측정 불가로 남긴다. */
  | { readonly kind: 'turn-not-closed'; readonly boundary: ClosedTurnBoundary };

async function waitForClosedTurn(runner: LiveTurnRunner, sessionId: string, knownLogIds: ReadonlySet<string>, options: LiveTurnOptions): Promise<ClosedTurnWait> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + options.settleMs;
  const deadlineTimestamp = new Date(deadline).toISOString();
  let boundary: ReturnType<typeof turnStartedAfter> = null;
  while (now() < deadline) {
    const raw = runner.lifecycleLogs(sessionId);
    if (raw === null) return { kind: 'snapshot-failed' };
    boundary ??= turnStartedAfter(raw, knownLogIds, sessionId);
    const closed = boundary && closedTurnBoundary(raw, boundary, sessionId);
    if (closed) return { kind: 'closed', boundary: closed };
    await sleep(options.pollMs);
  }
  return boundary
    ? { kind: 'turn-not-closed', boundary: { ...boundary, completedAt: deadlineTimestamp } }
    : { kind: 'no-turn' };
}

/** A failed lifecycle or log command ends the run: that session cannot safely receive another turn. */
export async function measureLiveTurn(runner: LiveTurnRunner, sessionId: string, item: LiveCorpusItem, prompt: string, rep: number, options: LiveTurnOptions): Promise<LiveTurnResult> {
  const before = runner.lifecycleLogs(sessionId);
  if (before === null) return { kind: 'unmeasurable', reason: 'snapshot-failed' };
  if (!runner.deliverInput(prompt)) return { kind: 'unmeasurable', reason: 'delivery-failed' };
  const waited = await waitForClosedTurn(runner, sessionId, logIds(before), options);
  // ⛔ 폴링 중 조회 실패는 `completion-failed`(턴 미완)와 다른 사유다 — 뭉치면 원인이 사라진다.
  if (waited.kind === 'snapshot-failed') return { kind: 'unmeasurable', reason: 'snapshot-failed' };
  if (waited.kind === 'no-turn') return { kind: 'unmeasurable', reason: 'completion-failed' };
  const fired = runner.toolsForClosedTurn(sessionId, waited.boundary);
  if (fired === null) return { kind: 'unmeasurable', reason: 'tools-query-failed' };
  // A truncated turn with no observed tool could fire later, so it remains unmeasurable rather than no-fire.
  if (waited.kind === 'turn-not-closed' && fired.length === 0) return { kind: 'unmeasurable', reason: 'completion-failed' };
  // ⛔ 종전엔 이 줄이 분류 로직을 **복제**하고 있었다(스크리닝은 `classifyRouting`, 라이브는 인라인).
  //    정본(라이브)과 하한(스크리닝)이 **다른 자를 쓰면** 두 수를 비교할 수 없다 — 공용 분류기로 모은다.
  const outcome = classifyRouting(fired, item.accept, item.reject);
  const record: LiveRecord = waited.kind === 'turn-not-closed'
    ? { id: item.id, rep, sessionId, fired, outcome, truncated: true }
    : { id: item.id, rep, sessionId, fired, outcome };
  return waited.kind === 'turn-not-closed'
    ? { kind: 'measured', record, openTurn: waited.boundary }
    : { kind: 'measured', record };
}
