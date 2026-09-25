// Live TUI is the NL corpus authority. Each verdict is a closed, session-scoped turn.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertGradableItems, assertProbeOutsideCorpus, normalizeCorpusItems, positiveInteger, summarizeCorpusRun, wilsonInterval } from './lib/nl-routing-measurement.js';
import { createMonadLiveTurnRunner, provePtyDrivesSession, verifyPtySession, type LiveRecord } from './lib/nl-routing-live.js';
import { resolveTruncatedTurnWaitMs, runLiveCorpus } from './lib/nl-routing-corpus-run.js';
import { truncatedTurnsSummary } from './lib/nl-routing-live-summary.js';

// ⚠️ `accept` 는 파일에서 **빠져 있을 수 있다** — `assertGradableItems` 는 `reject` 만 있는
//    항목을 유효로 인정하므로(대조군), 여기서 `[]` 로 정규화하지 않으면 아래 `item.accept.length`
//    에서 죽는다(2R 리뷰 should-fix ①). 계약이 허용하는 모양을 러너가 못 받으면 그건 배선 결손이다.
interface CorpusItem { id: string; tier: string; prompt: string; accept?: string[]; reject?: string[]; note?: string; boundary?: boolean; context_dependent?: boolean; context?: string }
type NormalizedItem = CorpusItem & { accept: string[] };
/** ⭐ 코퍼스가 들고 있는 **계약 문면**. 종전엔 파일에만 있고 아무도 읽지 않았다(4R 리뷰 must-fix).
 *  ⇒ 삭제하지 않고 **출력에 연결**한다 — 수와 계약이 같은 화면에 나와야 다음 사람이
 *  «이 수를 어떻게 읽나» 를 따로 찾지 않는다. 이 레포가 반복해서 다친 자리이기도 하다
 *  (세대가 다른 수를 같은 표에 놓는 사고). 없는 필드는 조용히 건너뛴다(자매 코퍼스 호환). */
interface CorpusContract {
  description?: string;
  owner?: string;
  plan?: string;
  surface?: string;
  grading?: string;
  measurement_contract?: string;
  target_terms_why?: string;
  tier_oracle_status?: Record<string, string>;
}

function printContract(contract: CorpusContract, tiers: readonly string[]): void {
  if (contract.description) console.log(`[live] ${contract.description}`);
  const meta = [contract.owner && `소유 ${contract.owner}`, contract.plan && `계획 ${contract.plan}`, contract.surface && `서피스 ${contract.surface}`].filter(Boolean);
  if (meta.length) console.log(`[live] ${meta.join(' · ')}`);
  if (contract.grading) console.log(`[live] 채점 — ${contract.grading}`);
  if (contract.measurement_contract) console.log(`[live] 측정 계약 — ${contract.measurement_contract}`);
  if (contract.target_terms_why) console.log(`[live] 대상 계약 — ${contract.target_terms_why}`);
  // ⛔ **이번에 재는 티어의 오라클 상태**를 수보다 먼저 찍는다 — "잠정" 인 티어의 수를
  //    확정 지표로 읽는 것이 이 코퍼스가 가장 두려워하는 오독이다.
  for (const tier of tiers) {
    const status = contract.tier_oracle_status?.[tier];
    if (status) console.log(`[live] 오라클 ${tier} — ${status}`);
  }
}
// 이 러너는 측정할 코퍼스를 외부에서 명시적으로 받는다.
const corpusPath = process.env.CORPUS_PATH;
const CORPUS_PATH = corpusPath ? resolve(process.cwd(), corpusPath) : undefined;
const PTY = process.env.CORPUS_PTY;
const SESSION = process.env.CORPUS_SESSION;
const SESSIONS = process.env.CORPUS_SESSIONS?.split(',').map((session) => session.trim()).filter(Boolean);
const ALLOW_CONTAMINATED_SESSION_REUSE = process.env.CORPUS_ALLOW_CONTAMINATED_SESSION_REUSE === '1';
const CONFIG_DIR = process.env.CORPUS_CONFIG_DIR;
const SETTLE_MS = positiveInteger(process.env.CORPUS_SETTLE_MS, 'CORPUS_SETTLE_MS', 45_000);
const TRUNCATED_TURN_WAIT_MS = resolveTruncatedTurnWaitMs(process.env.CORPUS_TRUNCATED_TURN_WAIT_MS, SETTLE_MS);
const REPEATS = positiveInteger(process.env.CORPUS_LIVE_REPEATS, 'CORPUS_LIVE_REPEATS', 3);
const POLL_MS = 250;
// ⚠️ 프로브 문장은 **코퍼스 밖**이어야 한다 — 문항으로 프로브하면 그 회차가 표본에 섞인다.
//    툴을 부를 이유가 없는 짧은 인사말을 쓴다.
const PROBE_TEXT = process.env.CORPUS_PROBE_TEXT ?? '안녕';

// ⛔⭐ `CORPUS_STATE_DIR` — 측정 대상 우주를 **경로로** 못 박는다. 라벨(`--instance`)로는 못 좁힌다:
//   `test:state` 하나에 71개 우주가 겹친다(원장 `OBS-S16`). 못 박으면 조회가 그 스토어 하나만 열어
//   연합이 189+71 우주를 여는 `database is locked` 폭풍을 피한다(실측: 실패 92건·판정 0 → 0.63s).
const STATE_DIR = process.env.CORPUS_STATE_DIR;

// ⛔⭐⭐⭐ **제어면과 관측면이 다른 우주에 산다**(실측 2026-08-02 · 원장 `OBS-S14`):
//   `dev --hold` 의 **부모**가 pty 를 등록하므로 `pty text` 는 **부모의 우주**에서 보이고,
//   세션·로그는 **자식의 우주**에서 난다. ⇒ 한 env 로 둘을 덮으면 하나가 깨진다
//   (실측: 스토어를 자식으로 못 박자 `pty: pty_xxx was not found` 로 입력 전달 자체가 실패했다).
//   ⇒ **`logs` 만** 자식 스토어로 좁힌다. 나머지(`pty …`)는 호출자의 우주 그대로 둔다.
function monad(args: string[]): string {
  const scopesToChildStore = STATE_DIR !== undefined && args[0] === 'logs';
  // ⛔⭐⭐⭐ `--config-dir` 는 `MONAD_STATE_DIR` 을 **덮는다**(실측 2026-08-02):
  //     MONAD_STATE_DIR=<child> logs …                    → 4행
  //     MONAD_STATE_DIR=<child> logs --config-dir <test> … → 0행
  //   ⇒ pty 를 찾으려고 `CORPUS_CONFIG_DIR` 을 주면 **로그 조회가 통째로 눈이 먼다.**
  //   위 주석(67-71)이 *"logs 만 자식 스토어로 좁힌다"* 를 적어 두고 74-75 로 구현했는데,
  //   이 줄이 모든 명령에 `--config-dir` 를 붙여 그것을 조용히 되돌리고 있었다.
  //   ⇒ 자식 스토어로 좁히는 `logs` 에는 `--config-dir` 를 **붙이지 않는다**(스토어는 env 가 정한다).
  const full = CONFIG_DIR && !scopesToChildStore ? [...args, '--config-dir', CONFIG_DIR] : args;
  const env = scopesToChildStore ? { ...process.env, MONAD_STATE_DIR: STATE_DIR } : process.env;
  return execFileSync('bun', ['bin/monad.mjs', ...full], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
}

function promptForItem(item: CorpusItem): string {
  return item.context_dependent && item.context ? `${item.context}\n\n${item.prompt}` : item.prompt;
}

async function main(): Promise<void> {
  if (!CORPUS_PATH) throw new Error('CORPUS_PATH is required; provide the corpus JSON path to measure.');
  if (!PTY) throw new Error('CORPUS_PTY is required; obtain child session IDs before injecting input.');
  const sessions = SESSIONS ?? (SESSION ? [SESSION] : []);
  if (sessions.length === 0) throw new Error('CORPUS_SESSIONS or CORPUS_SESSION is required; obtain child session IDs before injecting input.');
  const contaminatedSessionReuse = ALLOW_CONTAMINATED_SESSION_REUSE && sessions.length === 1 && REPEATS > 1;
  if (sessions.length < REPEATS && !contaminatedSessionReuse) throw new Error(`CORPUS_SESSIONS requires at least ${REPEATS} distinct sessions for ${REPEATS} repeats; CORPUS_SESSION supports only one repeat.`);
  const repeatSessions = contaminatedSessionReuse ? Array.from({ length: REPEATS }, () => sessions[0]!) : sessions.slice(0, REPEATS);
  if (!contaminatedSessionReuse && new Set(repeatSessions).size !== repeatSessions.length) throw new Error('CORPUS_SESSIONS must provide a distinct session for every repeat.');
  // ⭐ 두 경로다. ⑴ 선언(`lifecycle.bridge-attached`)이 있으면 그걸 쓴다 — 턴을 안 쓰고 싸다.
  //    ⑵ 없으면 **인과로 증명**한다: 내가 이 pty 에 넣은 입력에 그 세션이 그 길이로 반응했나.
  //    ⛔ 실측 — `dev --monad --hold` 의 bare TUI 는 선언을 안 남긴다(`self_*` 하니스만 남긴다).
  //    그래서 ⑴만 있으면 이 러너는 **영영 못 돈다**. 안전장치를 낮추는 대신 증거를 바꾼다.
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as CorpusContract & { items: CorpusItem[] };
  const probeRunner = createMonadLiveTurnRunner(monad, PTY);
  for (const sessionId of repeatSessions) {
    if (verifyPtySession(monad, PTY, sessionId)) {
      console.log(`[live] pty↔session 확인 — lifecycle.bridge-attached 선언 · session=${sessionId}`);
      continue;
    }
    // ⛔ **프로브가 코퍼스 문항이면 그 회차가 표본에 섞인다**(1R 리뷰 must-fix ③).
    //    기본값이든 CORPUS_PROBE_TEXT 든 **실제 코퍼스와 대조**해서 거부한다 — 계약을 문면으로만
    //    적어 두면 지켜지지 않는다(이 레포가 반복해서 다친 자리).
    assertProbeOutsideCorpus(PROBE_TEXT, corpus.items.map((item) => item.prompt));
    console.log(`[live] 선언 없음 → 인과 프로브로 증명한다(턴 1회 소모 · 코퍼스 밖 문장) · session=${sessionId}`);
    const proof = await provePtyDrivesSession(probeRunner, sessionId, PROBE_TEXT, { settleMs: SETTLE_MS, pollMs: POLL_MS });
    if (!proof.proven) {
      throw new Error(`CORPUS_PTY ${PTY} did not drive session ${sessionId} (${proof.reason}); no corpus input was delivered.`);
    }
    console.log(`[live] ⭐ 인과 확인 — 이 pty 에 넣은 입력이 이 세션의 턴을 열었다 · session=${sessionId}`);
  }
  // ⛔ **id 필터 전에** 코퍼스 전체를 검사한다(1R 리뷰 must-fix ②) — 필터 뒤에 두면
  //    채점 불가 항목이 이번 선택에 안 들어왔다는 이유로 **조용히 통과**하고, 다음 사람이
  //    그 항목을 고르는 순간 늘 통과하는 칸으로 측정하게 된다.
  assertGradableItems(corpus.items);
  // ⭐ 정규화는 **라이브러리**가 한다 — 여기 인라인으로 두면 테스트가 이 경로를 못 잡는다.
  const normalized = normalizeCorpusItems(corpus.items) as NormalizedItem[];
  const ids = process.argv.slice(2);
  const items = ids.length ? normalized.filter((item) => ids.includes(item.id)) : normalized;
  if (items.length === 0) throw new Error('해당 id 없음');

  // ⛔ 어느 코퍼스로 잰 수인지 출력에 남긴다 — 코퍼스가 갈아 끼워지므로, 안 남기면
  //    판정 계약이 다른 두 수가 같은 표에 섞인다(이 레포가 이미 한 번 경고한 형태).
  console.log(`[live] 코퍼스 ${CORPUS_PATH}`);
  printContract(corpus, [...new Set(items.map((item) => item.tier))]);
  console.log(`[live] ${items.length} 문항 × ${REPEATS}회 · pty=${PTY} · sessions=${repeatSessions.join(',')} · 완료 대기 ${SETTLE_MS}ms`);
  if (contaminatedSessionReuse) {
    console.log('[live] ⚠️ contaminated-session-reuse: 단일 세션을 회차 간 재사용한 오염 대조군이다.');
  }
  console.log('[live] 각 회차는 직렬이며, 회차별로 다른 세션의 input.submit 시작/완료 사이 tool-selected 행만 판정한다. 경계를 잃으면 즉시 중단한다.\n');
  const runner = probeRunner;
  const { records, truncatedTurns, aborted, contaminatedSessionReuse: completedWithContaminatedSessionReuse } = await runLiveCorpus<NormalizedItem>(runner, sessions, items, {
    repeats: REPEATS,
    allowContaminatedSessionReuse: contaminatedSessionReuse,
    settleMs: SETTLE_MS,
    truncatedTurnWaitMs: TRUNCATED_TURN_WAIT_MS,
    pollMs: POLL_MS,
    promptForItem,
    onMeasured(item, rep, record) {
      const expectation = item.accept.length > 0 ? item.accept.join('|') : `⛔쏘면 안 됨: ${(item.reject ?? []).join('|')}`;
      console.log(`  ${item.id} rep${rep + 1} ${record.outcome}  기대 ${expectation} → 실제 ${record.fired.join(',') || '(툴 0)'}`);
      if (record.outcome !== 'pass' && item.note) console.log(`      ↳ ${item.note}`);
    },
    onWaitingForOpenTurn(item, rep, waitMs) {
      console.log(`[live] ⏳ ${item.id} rep${rep + 1} 절단 회차 뒤 열린 턴을 기다린다 — 로그가 자라는 동안은 계속, ${waitMs}ms 동안 안 자라면 정지로 본다; 이 동안 후속 입력은 넣지 않는다.`);
    },
    onAbort(item, rep, reason) {
      if (reason === 'truncated-turn-stalled') console.error(`[live] ⏱️ ${item.id} rep${rep + 1} 열린 턴의 진행이 멈췄다(경과 시간이 아니라 정지); 열린 세션에 후속 입력을 섞지 않기 위해 실행을 중단한다.`);
      else if (reason === 'truncated-turn') console.error(`[live] ⏱️ ${item.id} rep${rep + 1} 절단 회차를 기록했다; 열린 세션에 후속 입력을 섞지 않기 위해 실행을 중단한다.`);
      else console.error(`[live] ⛔ ${item.id} rep${rep + 1} 측정 불가 (${reason}); 세션 턴 경계를 잃어 실행을 중단한다.`);
    },
  });

  // ⭐ 집계는 **순수 함수**가 한다 — 경계 문항 분리 계약이 여기 인라인이면 테스트가 결과를
  //    증명하지 못한다(5R 리뷰 must-fix). 계약은 그 계약이 적용된 **결과**로 잠근다.
  const { perItem, aggregate, boundary, boundaryIds, fluctuating } = summarizeCorpusRun(items, records, REPEATS);
  const interval = wilsonInterval(aggregate.passes, aggregate.runs);
  console.log(`\n[live] 이 수는 LLM 실행 확률의 표본이라 런마다 움직인다.`);
  console.log(`[live] 문항별 ${perItem.map(({ id, summary }) => `${id} ${summary.passes}/${summary.runs}${summary.runs === summary.expectedRuns ? '' : ` (기대 ${summary.expectedRuns})`}`).join(' · ')}`);
  console.log(`[live] 합계 ${aggregate.passes}/${aggregate.runs}${boundaryIds.length > 0 ? ` (경계 ${boundaryIds.join(',')} 제외)` : ''}${interval ? ` · 95% Wilson ${(interval.lower * 100).toFixed(1)}%–${(interval.upper * 100).toFixed(1)}%` : ' · 95% Wilson 산출 불가'}`);
  if (boundary) {
    console.log(`[live] ⭐ 경계 문항 ${boundary.passes}/${boundary.runs} — 합계와 따로 읽는다(여기서 쏘는 것은 결함이 아니라 신호다)`);
  }
  const truncatedSummary = truncatedTurnsSummary(truncatedTurns);
  if (truncatedSummary) console.log(truncatedSummary);
  console.log(`[live] 흔들린 문항 id ${fluctuating.length > 0 ? fluctuating.join(', ') : '(없음)'}`);
  if (completedWithContaminatedSessionReuse && !aborted) console.log('[live] result contaminated-session-reuse=true');
  if (aborted) process.exitCode = 1;
}

await main();
