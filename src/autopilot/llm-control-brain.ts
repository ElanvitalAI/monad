// ── LLM 제어 brain (PLAN §7 P3b · 제어 루프를 자율화) ──
//
// runPtyControlLoop(§P3a)의 "판단"을 실제 LLM 으로 채운다: 화면(#1 분류 상태 포함)을 보고 다음 행동
// (input/wait/done)을 결정. 이게 substrate(관측·판단·대기·안전한 행동)를 **실제 자율 에이전트**로 만든다.
//   runPtyControlLoop(createLlmControlBrain({goal}), controlDepsForHandle(h), opts)
//
// 범용 3-액션(input/wait/done) — agent-mission 의 codex-특정 5-액션(send/verify/search…)의 일반형.
// streamLLM 은 lazy-inject(테스트=스텁·프로덕션=실제 · 테스트가 llm.js 무겁게 로드 안 함).
//
// ⭐제1원칙: 판단은 관측 관문(debug.log('autopilot.control','brain'))에 남긴다. LLM 오류/무JSON 은
// **wait 로 fail-soft**(루프의 stuck 감지가 지속 실패를 종료로 수렴 — 헛돌지 않음).

import type { RunSupervisor, ControlDecision, ControlObservation } from './pty-control-loop.js';
import { formatStallContext } from './stall-context.js';
import type { LLMMessage } from '../llm.js';
import { debug } from '../debug/log.js';

/** 주입 가능한 LLM 스트림 함수(streamLLM 시그니처 부분집합). */
export type StreamLLMFn = (
  messages: LLMMessage[],
  onChunk: (delta: string, full: string) => void,
  opts?: { maxTokens?: number; temperature?: number; model?: string; signal?: AbortSignal },
) => Promise<string>;

export interface LlmControlBrainOpts {
  /** 자식이 달성해야 할 목표(미션). */
  readonly goal: string;
  /** LLM 스트림(미주입 시 실제 streamLLM lazy-import). */
  readonly stream?: StreamLLMFn;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** 스텝당 LLM 호출 상한(ms). 초과 시 wait(fail-soft) — provider 멈춰도 루프의 stuck/budget/
   *  takeover 종료가 지연 없이 동작(review). 기본 60s. ⚠️0 = 무제한: 루프는 여전히 yield(loop 이
   *  decide vs abort race)하나 provider 가 abort 무시 시 in-flight 요청이 orphan 으로 무기한 남을 수
   *  있으니, orphan 도 bound 하려면 timeoutMs>0 권장. */
  readonly timeoutMs?: number;
  /** 시스템 프롬프트 추가 컨텍스트(도메인 힌트). */
  readonly systemHint?: string;
  /** 프롬프트에 넣을 최근 결정 히스토리 개수(기본 5). */
  readonly historyLimit?: number;
  /** 결정 관측 훅(전사·디버그). */
  readonly onDecision?: (decision: ControlDecision, raw: string) => void;
  /** 도메인별 프롬프트가 기본 3-action 프롬프트를 대체할 때 사용한다. */
  readonly messageBuilder?: (obs: ControlObservation, history: readonly string[]) => LLMMessage[];
  /** 도메인별 원문→결정 어댑터. 비동기 부작용(search context 기록 등)도 허용한다. */
  readonly decisionFromRaw?: (raw: string, obs: ControlObservation) => ControlDecision | Promise<ControlDecision>;
}

/** 원문에서 **첫 균형 JSON 객체**를 추출(string/escape 인지). 탐욕적 `{…}`(첫`{`~끝`}`)은 응답에
 *  JSON 뒤 다른 중괄호가 있으면 유효한 첫 객체까지 파싱 실패시킴(review) → depth 스캔으로 견고화. */
export function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return raw.slice(start, i + 1); }
  }
  return null;
}

/** ⭐LLM 원문 → ControlDecision. JSON {action,text,reason} 관대 파싱. 무JSON/실패 → wait(fail-soft). */
export function parseControlDecision(raw: string): ControlDecision {
  const json = extractFirstJsonObject(raw);
  if (!json) return { action: 'wait' };
  try {
    const d = JSON.parse(json) as Record<string, unknown>;
    if (d.action === 'input' && typeof d.text === 'string' && d.text.length > 0) return { action: 'input', text: d.text };
    if (d.action === 'done') return { action: 'done', reason: typeof d.reason === 'string' ? d.reason : 'done' };
    if (d.action === 'no-progress' && typeof d.reason === 'string' && d.reason.length > 0) return { action: 'no-progress', reason: d.reason };
    return { action: 'wait' };
  } catch {
    return { action: 'wait' };
  }
}

function buildSystem(opts: LlmControlBrainOpts, state: string, stallKnown: boolean, hasRoundContext: boolean): string {
  const role = hasRoundContext
    ? '너는 PTY 로 열린 자식 프로그램/에이전트를 구동하는 컨트롤러다.'
    : '너는 PTY 로 열린 자식 프로그램/에이전트를 **화면만 보고** 구동하는 컨트롤러다.';
  return `${role}
목표: ${opts.goal.slice(0, 600)}
${opts.systemHint ? opts.systemHint.slice(0, 400) + '\n' : ''}${hasRoundContext ? '화면은 현재 신호 하나다. 제공된 라운드 맥락과 직전 실패를 함께 고려하되, 화면만으로 이전 라운드의 진행을 추정하지 마라.\n' : ''}화면을 보고 **다음 행동 하나**를 JSON 으로 결정하라:
- "input": 자식이 입력을 기다리면(프롬프트/선택/blocked) 다음 입력 text(개행 필요 시 \\r 포함).
- "wait": 자식이 아직 작업 중(working)이면 대기.
- "done": 목표를 달성했으면 reason.
${stallKnown ? '- "no-progress": 화면이 오래 얼어붙고 진행 표지가 없지만 완료를 주장할 수 없으면 reason.\n' : ''}${stallKnown ? '화면이 오래 얼어붙고 진행 표지가 없으면 done 또는 no-progress 를 화면 근거로만 판단하라.\n' : ''}화면 분류(참고 신호): ${state}.
JSON 만 출력: {"action":"input|wait|done${stallKnown ? '|no-progress' : ''}","text":"...","reason":"..."}`;
}

function buildUser(obs: ControlObservation, history: readonly string[], limit: number): string {
  const recent = history.slice(-limit).join(' | ') || '없음';
  const stallContext = formatStallContext(obs);
  const roundContext = obs.roundContext
    ? `\n\n=== 라운드 맥락 ===\n현재 라운드: ${obs.roundContext.round}/${obs.roundContext.effectiveMax}\n직전 라운드 실패: ${obs.roundContext.previousRoundFailure}${obs.roundContext.landedSiblings ? `\n착지한 형제: ${obs.roundContext.landedSiblings.items.map((sibling) => `#${sibling.prNumber} (${sibling.shardId ?? sibling.runId})`).join(', ')} · 표시 ${obs.roundContext.landedSiblings.shownItems}/${obs.roundContext.landedSiblings.totalItems} · 생략 ${obs.roundContext.landedSiblings.omittedItems} · 잘림 ${obs.roundContext.landedSiblings.truncated}` : ''}`
    : '';
  return `스텝 ${obs.step}. 최근 결정: ${recent}. 화면 변화: ${obs.changed}${stallContext ? ` · ${stallContext}` : ''}${roundContext}\n\n=== 자식 화면 ===\n${obs.screen.slice(-3500)}`;
}

/**
 * ⭐제어 루프용 LLM brain. `runPtyControlLoop(createLlmControlBrain({goal}), deps, opts)` 로
 * 자율 미션 실행. 화면⊕#1상태 → LLM → input/wait/done. 오류·무JSON 은 wait(fail-soft).
 */
export function createLlmControlBrain(opts: LlmControlBrainOpts): RunSupervisor {
  const history: string[] = [];
  const histLimit = opts.historyLimit ?? 5;
  // 저장 시점 상한 — 긴 미션서 history 배열 무한증가 방지(review·프롬프트엔 slice 로 이미 상한).
  const HISTORY_CAP = 200;
  const record = (entry: string): void => {
    history.push(entry);
    if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  };
  // lazy — 테스트가 stream 주입 시 llm.js 로드 안 함.
  const stream: StreamLLMFn = opts.stream
    ?? (async (m, cb, o) => (await import('../llm.js')).streamLLM(m, cb, o ?? {}));

  return {
    async decide(obs: ControlObservation, externalSignal?: AbortSignal): Promise<ControlDecision> {
      const messages: LLMMessage[] = opts.messageBuilder?.(obs, history) ?? [
        // ⚠️ 정지 판단 지침은 **정지 맥락이 실제로 실렸을 때만** 넣는다(사후 리뷰 must-fix) —
        //   값이 없는데 지침만 주면 근거 없이 done 쪽으로 밀고, 무엇보다 이 brain 의 **다른**
        //   소비자(정지 값을 안 채우는 경로)의 프롬프트가 조용히 바뀐다.
        { role: 'system', content: buildSystem(opts, obs.state, formatStallContext(obs) !== '', obs.roundContext !== undefined) },
        { role: 'user', content: buildUser(obs, history, histLimit) },
      ];
      let raw = '';
      const controller = new AbortController();
      // 외부 signal(루프 takeover 감지) → 진행 중 streamLLM 취소(안전계약·review).
      const onExternalAbort = (): void => controller.abort();
      if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', onExternalAbort);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const call = stream(messages, () => {}, {
          maxTokens: opts.maxTokens ?? 400,
          temperature: opts.temperature ?? 0.2,
          signal: controller.signal, // timeout 시 in-flight streamLLM 취소(orphan 요청 방지·review)
          ...(opts.model ? { model: opts.model } : {}),
        });
        const timeoutMs = opts.timeoutMs ?? 60_000;
        // 스텝당 상한 — provider 가 멈춰도 decide()가 무기한 대기하지 않게(루프 종료 지연 방지).
        raw = timeoutMs > 0
          ? await Promise.race([
              call,
              new Promise<string>((_, rej) => { timer = setTimeout(() => { controller.abort(); rej(new Error('brain timeout')); }, timeoutMs); }),
            ])
          : await call;
      } catch (e) {
        // fail-soft: 루프의 stuck 감지가 지속 실패를 종료로 수렴(헛돌지 않음).
        debug.log('autopilot.control', 'brain-error', { step: obs.step, error: (e as Error).message });
        record(`${obs.step}:error`);
        return { action: 'wait' };
      } finally {
        if (timer) clearTimeout(timer); // 정상 호출마다 타이머 잔존 방지(review·누수)
        externalSignal?.removeEventListener('abort', onExternalAbort);
      }
      const decision = await (opts.decisionFromRaw?.(raw, obs) ?? parseControlDecision(raw));
      record(`${obs.step}:${decision.action}`);
      // ⭐제1원칙 관측 — 판단을 남긴다.
      debug.log('autopilot.control', 'brain', {
        step: obs.step, action: decision.action, state: obs.state,
        ...(decision.action === 'no-progress' ? { reason: decision.reason, stallRung: obs.stallRung } : {}),
        ...(obs.subjectPtyId ? { subjectPtyId: obs.subjectPtyId } : {}),
        ...(obs.runId ? { runId: obs.runId } : {}),
      });
      opts.onDecision?.(decision, raw);
      return decision;
    },
  };
}
