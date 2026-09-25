#!/usr/bin/env bun
// ── Backend Exploration-Budget Bench (READ-ONLY · 2026-07-17) ──────────────────
// terra/sol/luna vs opus 의 "단발 에이전트 턴" 탐색 예산 거동 실측.
//
// 목적: 동일한 READ-ONLY 탐색 태스크를 4 백엔드에 각각 1턴씩 주고, 백엔드별로
//   (a) tool-loop 예산 config (maxTurns · familyDefaultMaxTurns · reasoning effort)
//   (b) 실제 tool call 횟수
//   (c) 예산/합성(synthesis) 컷오프에 걸렸는지 (max_turn_requests / NO FINAL SYNTHESIS)
//   (d) 최종 답변 길이
//   (e) 실제로 해석된 provider/model/키 출처 (cross-family 401 노출)
//   (f) wall-clock 소요시간
// 을 캡처해 비교표로 출력한다.
//
// 사용:
//   bun scripts/backend-explore-bench.ts                 # 4 백엔드 전부
//   bun scripts/backend-explore-bench.ts --only opus     # 하나만
//   bun scripts/backend-explore-bench.ts --only luna     # (luna 는 401 예상)
//
// ⚠️ 이 스크립트는 실제 API 를 호출한다(유료). READ-ONLY 태스크지만 도구 surface
//    (Bash/Read/...)는 편집 가능 — 태스크 프롬프트가 편집을 요구하지 않을 뿐이다.
//    ~/.monad/config.json 은 절대 건드리지 않는다(모듈-전역 캐시만 in-process mutate).
//
// ─── 배선 결정 (research, file:line) ────────────────────────────────────────────
//  · 엔트리: MonadBuiltinTurnRunner.prompt() (src/autopilot/monad-builtin-runner.ts:87)
//      → runCoreTurn (src/core-turn/run-core-turn.ts:72) → streamLLMWithTools
//        (src/llm.ts:6391). se-monad-self-impl.ts 와 동일한 in-process tool-loop.
//  · 도구: getAutopilotToolRegistry (src/autopilot/tool-registry.ts:111) — Read/Bash/
//      ToolSearch/WebSearch 등 16종 (Grep/Glob 전용 도구는 없음 → 탐색은 Read + Bash
//      grep 로 수행. AUTOPILOT_TOOL_IDS src/autopilot/tool-registry.ts:188).
//  · 예산 config 관측: streamLLMWithTools 가 debug.log('llm.router','tool-loop.config',…)
//      를 src/llm.ts:6460 에서 방출 (maxTurns · maxTurnsExplicit · familyDefaultMaxTurns).
//      단 `if (debug.enabled)` 게이트(src/llm.ts:6459) — 아래서 debug.setDiagEnabled(true)
//      로 게이트를 열고 registerSink(src/debug/log.ts:429)로 이벤트를 되읽는다.
//  · provider/model/키 해석: resolveDefaultProvider (src/llm.ts:3763) → getProviderForConfig
//      (src/llm.ts:9098). cross-family 이면 'cross-family-override'(src/llm.ts:9139) 방출
//      + keyMismatch 플래그. codex 키 출처=OAuth(~/.config/monad/auth.json · ~/.codex/auth.json)
//      우선, 없으면 cfg.apiKey (makeCodexProvider src/llm.ts:8744). anthropic=cfg.apiKey.
//  · 예산 상수: TOOL_LOOP_MAX_TURNS_CODEX=8 (src/llm.ts:3940) · _CLAUDE=24 (:3956) ·
//      _DEFAULT=6 (:3946). answerPriority='quality' 기본이면 codex 8 / claude 24
//      (ANSWER_PRIORITY_MAX_TURNS src/llm.ts:3962).
//  · tool-tier 매핑: gpt-5.6-luna=budget · terra=balanced/better · sol=best/loaded
//      (src/model-tier/llm-tier-map.ts:168). getModelFamily: gpt-5* → 'codex'
//      (src/models/prompts.ts:39).

import { getAutopilotToolRegistry } from '../src/autopilot/tool-registry.js';
import { MonadBuiltinTurnRunner } from '../src/autopilot/monad-builtin-runner.js';
import { registerAllDefaultToolRuntimes } from '../src/tool-runtime/index.js';
import { setSessionCwd } from '../src/session/working-dir.js';
import { getPolicy, setPolicy, setSystemFileGuardDisabled } from '../src/code-edit/index.js';
import { getUserConfig } from '../src/user-config.js';
import { debug } from '../src/debug/log.js';
import type { LogSink } from '../src/mss/logging/sink.js';
import type { LogRecord } from '../src/mss/logging/record.js';

// 스탠드얼론은 데몬 부팅 경로가 없어 도구 런타임이 전역 레지스트리에 미등록
// (dispatchToolByName 이 'Read' 못 찾음). 데몬 부팅과 동일하게 등록(idempotent).
registerAllDefaultToolRuntimes();

const execCwd = process.cwd();

// ── CLI 파싱 ────────────────────────────────────────────────────────────────
const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1]?.toLowerCase() : undefined;
})();

// ── 단일 READ-ONLY 탐색 태스크 ─────────────────────────────────────────────────
// 탐색을 실제로 요구하는 태스크라야 백엔드별 예산 차이가 드러난다(추측 금지 강제).
// Grep 전용 도구는 없으므로 "Grep/Read" 대신 "Bash grep · Read" 를 허용한다.
const TASK = [
  'src/llm.ts 에서 tool-loop 최대 턴 수를 정하는 상수들(이름이 TOOL_LOOP_MAX_TURNS_ 로',
  '시작하는 export const 들)을 모두 찾아, 각 상수의 값과 의미를 file:line 과 함께 요약하라.',
  '',
  '반드시 실제로 도구를 사용해 확인하라(Bash 로 grep 하거나 Read 로 파일을 읽어라).',
  '추측하지 마라 — 값과 줄 번호는 실제 파일 내용에서 인용해야 한다.',
  '이 저장소는 read-only 조사다: 파일을 편집하거나 새로 만들지 마라.',
].join('\n');

// ── 백엔드 정의 ─────────────────────────────────────────────────────────────
// provider 는 model 의 family 로 결정: gpt-5.6-* → openai-codex, claude-* → anthropic.
// effort 는 codex reasoning effort 로 config 에 in-place override(디스크 무오염).
interface Backend {
  key: string;
  model: string;
  provider: 'anthropic' | 'openai-codex';
  effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  note: string;
}

const ALL_BACKENDS: Backend[] = [
  { key: 'opus', model: 'claude-opus-4-8', provider: 'anthropic', note: 'Anthropic frontier' },
  { key: 'sol', model: 'gpt-5.6-sol', provider: 'openai-codex', effort: 'medium', note: 'codex 심층추론 tier(best)' },
  { key: 'terra', model: 'gpt-5.6-terra', provider: 'openai-codex', effort: 'low', note: 'codex 코딩 sweet spot(balanced)' },
  { key: 'luna', model: 'gpt-5.6-luna', provider: 'openai-codex', effort: 'minimal', note: 'codex 빠름/저렴(budget) — 401 예상' },
];
const BACKENDS: Backend[] = ALL_BACKENDS.filter((b) => !onlyArg || b.key === onlyArg);

// ── 결과 row ────────────────────────────────────────────────────────────────
interface Row {
  backend: string;
  provider: string;      // 실제 해석된 provider (config 방출 기준)
  model: string;
  effort: string;
  maxTurns: string;      // tool-loop.config 관측값
  maxTurnsExplicit: boolean;
  familyDefault: string;
  toolCalls: number;
  cutoff: string;        // max_turn_requests / no-synthesis / -
  answerChars: number;
  durationSec: number;
  keyMismatch: string;   // cross-family-override 관측 (yes/no/-)
  error: string;
}

// ── 격리 컨텍스트 설정 (se-monad-self-impl.ts 와 동일 패턴·read-only 라 편집은 안 함) ──
try {
  setSessionCwd(execCwd, 'tool');
  setSystemFileGuardDisabled(true);       // worktree/소스 조회만 — 편집 미요청
  setPolicy({ ...getPolicy(), mode: 'unsupervised' }); // 무인 auto-approve(태스크는 read-only)
} catch (e) {
  console.error('[bench] 격리 컨텍스트 설정 실패:', e instanceof Error ? e.message : e);
}

// ── debug 게이트 열기 + provider/tool-loop 이벤트 캡처 sink ────────────────────
// tool-loop.config 등은 `if (debug.enabled)` 뒤에서만 방출(src/llm.ts:6459) → diag 로 게이트를 연다.
// setDiagEnabled(true) 는 file sink 를 건드리지 않는다(순수 in-memory 게이트 토글).
debug.setDiagEnabled(true);

// per-backend 캡처 버킷. 각 백엔드 실행 직전 reset 한다.
let capture: {
  toolLoopConfig?: Record<string, unknown>;
  crossFamily?: Record<string, unknown>;
  resolveProvider?: Record<string, unknown>;
  toolCalls: number;
} = { toolCalls: 0 };

const benchSink: LogSink = {
  name: 'backend-explore-bench',
  emit(rec: LogRecord): void {
    const r = rec as unknown as { category?: string; event?: string; data?: Record<string, unknown> };
    if (r.category !== 'llm.router') return;
    if (r.event === 'tool-loop.config') capture.toolLoopConfig = r.data;
    else if (r.event === 'cross-family-override') capture.crossFamily = r.data;
    else if (r.event === 'resolveDefaultProvider') capture.resolveProvider = r.data;
  },
};
const unregister = debug.registerSink(benchSink);

// ── config in-place override (디스크 무오염) ────────────────────────────────────
// getUserConfig()는 module-cache 참조를 반환하므로 in-place mutate 하면 이 프로세스
// 에서만 유효하고 mtime 불변이라 캐시가 계속 서브된다(디스크 write 없음).
// 각 백엔드마다 provider/model/apiKey/effort 를 rotation 항목에서 끌어와 세팅한다.
// codex 는 rotation 의 openai-codex 키(sk-proj…)를 쓰거나 OAuth 로 폴백한다.
// ⚠️ luna(=codex)도 동일 경로 — 만약 codex 키/OAuth 가 유효하지 않으면 401 이 여기서 노출된다.
function applyBackendToConfig(b: Backend): void {
  const cfg = getUserConfig() as unknown as {
    llm: {
      provider: string; apiKey?: string; model?: string; baseUrl?: string;
      codexReasoning?: { effort?: string; summary?: string };
      rotation?: Array<{ provider: string; apiKey?: string; baseUrl?: string }>;
    };
  };
  const rot = (cfg.llm.rotation ?? []).find((r) => r.provider === b.provider);
  cfg.llm.provider = b.provider;
  cfg.llm.model = b.model;
  // provider 별 키: rotation 항목이 있으면 그걸, 없으면 기존 apiKey 유지(codex 는 OAuth 폴백 가능).
  if (rot?.apiKey) cfg.llm.apiKey = rot.apiKey;
  if (rot?.baseUrl) cfg.llm.baseUrl = rot.baseUrl; else delete cfg.llm.baseUrl;
  if (b.effort) cfg.llm.codexReasoning = { ...(cfg.llm.codexReasoning ?? {}), effort: b.effort };
  console.error(`[bench] config → provider=${b.provider} model=${b.model} effort=${b.effort ?? '(config)'} key=${rot?.apiKey ? `${b.provider}-rotation(${rot.apiKey.slice(0, 7)})` : 'existing/OAuth'}`);
}

// ── 단일 백엔드 실행 ────────────────────────────────────────────────────────────
async function runBackend(b: Backend): Promise<Row> {
  capture = { toolCalls: 0 };
  applyBackendToConfig(b);

  const signal = new AbortController().signal;
  const { tools, dispatchTool } = getAutopilotToolRegistry({
    surface: 'tui',
    sessionId: `explore-bench-${b.key}`,
    signal,
  });

  // modelOverride 를 명시 전달 → runCoreTurn → streamLLMWithTools 가 이 모델을 쓴다.
  // (config override 와 이중으로 보장 — modelOverride 가 최종 승자).
  const runner = new MonadBuiltinTurnRunner({
    sessionId: `explore-bench-${b.key}`,
    tools,
    dispatchTool,
    systemPrompt:
      `You are a code exploration agent. Working directory (relative paths resolve here): ${execCwd}. ` +
      `Use paths relative to this directory. Do NOT assume /workspace or any other root. ` +
      `This is a READ-ONLY investigation — do not edit or create files.`,
    modelOverride: b.model,
    // maxToolTurns 는 일부러 미지정 → family-default 예산(codex 8 / claude 24)이 그대로
    // 발동해야 백엔드별 예산 차이가 드러난다. tool-loop.config 로 실제 발동값을 관측한다.
  });

  let finalText = '';
  let sawNoSynthesis = false;
  const onUpdate = (u: unknown): void => {
    const x = u as Record<string, unknown>;
    const su = x.sessionUpdate as string | undefined;
    if (su === 'tool_call') {
      capture.toolCalls++;
      const title = x.title ?? x.toolName ?? '';
      console.error(`  [${b.key} tool #${capture.toolCalls}] ${String(title).slice(0, 40)}`);
    } else if (su === 'agent_message_chunk') {
      const t = (x.content as { text?: string })?.text;
      if (t) {
        finalText += t;
        if (/NO FINAL SYNTHESIS/i.test(t)) sawNoSynthesis = true;
      }
    }
  };

  const t0 = Date.now();
  let stopReason = '';
  let error = '';
  try {
    const result = await runner.prompt([{ type: 'text', text: TASK }], onUpdate);
    stopReason = result.stopReason;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    // 401 / cross-family 키 불일치가 여기로 떨어진다(luna 예상).
  }
  const durationSec = Math.round((Date.now() - t0) / 10) / 100;

  const tlc = capture.toolLoopConfig ?? {};
  const cf = capture.crossFamily;
  const cutoff =
    stopReason === 'max_turn_requests' ? 'max_turns'
      : sawNoSynthesis ? 'no-synthesis'
        : stopReason === 'refusal' || error ? 'error/refusal'
          : '-';

  return {
    backend: b.key,
    // 실제 해석된 provider: cross-family override 가 있으면 override 후 implied, 없으면 config.
    provider: cf ? `${b.provider}→${String(cf.implied)}` : b.provider,
    model: b.model,
    effort: b.effort ?? '(config)',
    maxTurns: tlc.maxTurns !== undefined ? String(tlc.maxTurns) : '?',
    maxTurnsExplicit: tlc.maxTurnsExplicit === true,
    familyDefault: tlc.familyDefaultMaxTurns !== undefined ? String(tlc.familyDefaultMaxTurns) : '?',
    toolCalls: capture.toolCalls,
    cutoff,
    answerChars: finalText.length,
    durationSec,
    keyMismatch: cf ? (cf.keyMismatch === true ? `YES(${String(cf.keyImplies)}≠${String(cf.implied)})` : 'no') : '-',
    error: error.slice(0, 80),
  };
}

// ── 실행 루프 ────────────────────────────────────────────────────────────────
const rows: Row[] = [];
for (const b of BACKENDS) {
  console.error(`\n━━━ ${b.key} (${b.model} · ${b.note}) ━━━`);
  try {
    rows.push(await runBackend(b));
  } catch (e) {
    // runBackend 내부 try/catch 로 대부분 흡수되지만, 배선 예외(도구 빌드 등)는 여기로.
    console.error(`  [${b.key}] 치명 오류:`, e instanceof Error ? e.message : e);
    rows.push({
      backend: b.key, provider: b.provider, model: b.model, effort: b.effort ?? '(config)',
      maxTurns: '?', maxTurnsExplicit: false, familyDefault: '?', toolCalls: 0,
      cutoff: 'error/refusal', answerChars: 0, durationSec: 0, keyMismatch: '-',
      error: (e instanceof Error ? e.message : String(e)).slice(0, 80),
    });
  }
}

unregister();

// ── 비교표 ──────────────────────────────────────────────────────────────────
console.log('\n\n═══════ terra/sol/luna vs opus — 탐색 예산 벤치 ═══════\n');
console.log('| 백엔드 | provider | model | effort | maxTurns | familyDefault | toolCalls | cutoff | answerChars | 소요(s) | keyMismatch | error |');
console.log('|---|---|---|---|--:|--:|--:|:--:|--:|--:|:--:|---|');
for (const r of rows) {
  const mt = `${r.maxTurns}${r.maxTurnsExplicit ? '*' : ''}`;
  console.log(
    `| ${r.backend} | ${r.provider} | ${r.model} | ${r.effort} | ${mt} | ${r.familyDefault} | ` +
    `${r.toolCalls} | ${r.cutoff} | ${r.answerChars} | ${r.durationSec} | ${r.keyMismatch} | ${r.error || '-'} |`,
  );
}
console.log('\n* maxTurns 뒤 * = 명시 override(이번 벤치는 미명시라 없어야 정상 = family-default 발동).');
console.log('cutoff: max_turns=예산소진 · no-synthesis=[NO FINAL SYNTHESIS] 방출 · error/refusal=예외(401 등).');
console.log('keyMismatch YES = cross-family 키 불일치(예: sk-ant 키를 codex 엔드포인트로 → 401 근본원인).');
