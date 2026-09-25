#!/usr/bin/env bun
// ── Self-Evolution · monad-self 구현 러너 (백엔드 벤치용·2026-07-11) ────────
// monad 자체 에이전트 루프(MonadBuiltinTurnRunner + getAutopilotToolRegistry 코딩도구)로
// 격리 cwd 에서 코드를 자율 구현. 도구는 MONAD_TOOL_CWD/process.cwd 로 cwd 바인딩 →
// 이 스크립트를 worktree cwd(또는 MONAD_TOOL_CWD)로 스폰하면 그 worktree 를 편집한다.
// codex/claude ACP 위임(dispatchDelegateAgent)의 monad-self 대응. 사용: bun se-monad-self-impl.ts <task>

import { getAutopilotToolRegistry } from '../src/autopilot/tool-registry.js';
import { MonadBuiltinTurnRunner } from '../src/autopilot/monad-builtin-runner.js';
import { registerAllDefaultToolRuntimes } from '../src/tool-runtime/index.js';
import { setSessionCwd } from '../src/session/working-dir.js';
import { getPolicy, setPolicy, setSystemFileGuardDisabled } from '../src/code-edit/index.js';
import { getUserConfig } from '../src/user-config.js';
import { resolveSystemPrompt } from './se-monad-self-prompts.js';
import { runGoalLoop, type CoreTurnContext } from '../src/core-turn/index.js';
import { debug } from '../src/debug/log.js';
import { registerStandaloneLogSink } from '../src/domains/standalone-log-sink.js';
import { execSync } from 'node:child_process';

// 스탠드얼론은 데몬 부팅 경로가 없어 도구 런타임이 전역 레지스트리에 미등록
// (dispatchToolByName 이 'Write' 못 찾음). 데몬 부팅과 동일하게 등록(idempotent).
registerAllDefaultToolRuntimes();
// ★ 관측갭 수복(제1원칙·2026-07-22 대표 지시) — se build 서브프로세스는 데몬 StoreSink 를 상속 안 한다.
//   이 sink 를 안 붙이면 아래 debug.log('mission.se.walker',...)(어느 루프·verify·escalation·stopReason)가
//   파일 트레일(buildLog)에만 남고 logs.db 에 안 닿아 `monad logs --category mission.se.walker` 로 조회 불가
//   (= 관측 안 한 것). self-implement CLI(index.ts) 와 동일 패턴. MONAD_STATE_DIR 상속 → 격리 logs.db 정합.
try { await registerStandaloneLogSink('harness:se-build'); } catch { /* fail-open */ }

// ★ 근본 개선(대표 지시) — 실행 cwd 를 도구 체인에 명시 전달. monad-self 의 code-edit 도구는
// getSessionCwd() 로 상대경로를 anchor 하고, self-edit 가드가 monad 소스 편집을 차단한다.
// 격리 worktree(disposable·disarmed·SE arming 게이트 하)에서 monad-self 가 자율 편집하려면:
//   ① session cwd = worktree (상대경로 anchor·도구 cwd)
//   ② self-edit 가드 우회(worktree 는 정식 소스 아님·격리 dogfood)
//   ③ policy unsupervised(auto-approve·승인자 없는 무인 실행)
// 이 프로세스는 worktree 전용 격리 서브프로세스라 모듈-전역 설정이 안전(정식 소스 무영향).
const execCwd = process.cwd();
// ── 실험 제어 env (백엔드 튜닝·2026-07-11) ──────────────────────────────────
//   MONAD_SELF_MAX_TURNS : per-prompt tool-loop 예산(명시 시 codex 패밀리 기본 8 override).
//   MONAD_SELF_MODEL     : modelOverride (gpt-5.6-sol / gpt-5.6-terra / anthropic/claude-opus-4-6 등).
//   MONAD_SELF_EFFORT    : codex reasoning effort (minimal|low|medium|high|xhigh|max) — config in-place override.
//   MONAD_SELF_ADAPTIVE  : '1' 이면 max_turns 도달 + 진행중일 때 예산 확장하며 재프롬프트(adaptive escalation).
const envMaxTurns = process.env.MONAD_SELF_MAX_TURNS ? Number(process.env.MONAD_SELF_MAX_TURNS) : undefined;
const envModel = process.env.MONAD_SELF_MODEL || undefined;
const envEffort = process.env.MONAD_SELF_EFFORT as 'minimal'|'low'|'medium'|'high'|'xhigh'|'max'|undefined;
const envAdaptive = process.env.MONAD_SELF_ADAPTIVE === '1';
const envSystem = process.env.MONAD_SELF_SYSTEM || undefined; // thin|optimized|action-first
// cwd 를 프롬프트에 명시 — codex 계열이 존재하지 않는 컨테이너 루트(/workspace 등)를 추측해
// "file not found" 로 tool call 을 낭비하는 것을 예방(monad-self dogfood 2026-07-11).
const cwdLine = `\n\nWorking directory (all relative paths resolve here): ${execCwd}\nUse paths relative to this directory (or this absolute prefix). Do NOT assume /workspace or any other root.`;
const systemPrompt = resolveSystemPrompt(envSystem) + (envSystem && envSystem !== 'thin' ? cwdLine : '');
try {
  setSessionCwd(execCwd, 'tool');
  setSystemFileGuardDisabled(true);
  setPolicy({ ...getPolicy(), mode: 'unsupervised' });
  if (envEffort) {
    // getUserConfig()는 module cache 참조 반환 → in-place mutate 로 디스크 오염 없이
    // 이 격리 서브프로세스에서만 effort override(mtime 불변이라 cache 계속 serve).
    const cfg = getUserConfig() as { codexReasoning?: { effort?: string; summary?: string } };
    cfg.codexReasoning = { ...(cfg.codexReasoning ?? {}), effort: envEffort };
  }
  // ★ 모델 provider 전환 — getProviderForConfig 는 provider 를 config.llm.provider(openai-codex)
  // 에 고정 해석. sol/terra 는 둘 다 openai-codex 라 modelOverride 만으로 되지만, opus(anthropic)/
  // grok/gemini 는 provider 자체를 바꿔야 함(안 하면 claude 모델을 codex 엔드포인트로 보내 실패).
  // rotation 에서 해당 provider 의 apiKey/baseUrl 을 찾아 in-process 로 llm 을 전환(디스크 무오염).
  if (envModel) {
    const m = envModel.toLowerCase();
    const wantProvider = m.startsWith('claude') || m.startsWith('opus') || m.includes('claude') ? 'anthropic'
      : m.startsWith('grok') ? 'grok'
      : m.startsWith('gemini') ? 'gemini'
      : null; // gpt/sol/terra/luna → openai-codex(전환 불필요)
    if (wantProvider) {
      const cfg = getUserConfig() as unknown as { llm: { provider: string; apiKey?: string; model?: string; baseUrl?: string; rotation?: Array<{ provider: string; apiKey?: string; baseUrl?: string; label?: string }> } };
      const rot = (cfg.llm.rotation ?? []).find((r) => r.provider === wantProvider);
      cfg.llm.provider = wantProvider;
      cfg.llm.model = envModel;
      // ★ env-first 키 해석(대표 2026-07-22 — "환경변수 전달 이슈") — 이 격리 서브프로세스가
      //   유효 env 키를 상속받았으면(터미널/데몬-env 전파) config rotation 의 stale 키보다 우선한다.
      //   데몬(launchd)은 env 가 비어 rotation 폴백(그래서 stale anthropic 키로 401 나던 근본) — env 가
      //   차 있으면 그걸 쓰고, 없으면 rotation. 무회귀(env 없으면 종전과 동일).
      const envKeyName: Record<string, string> = { anthropic: 'ANTHROPIC_API_KEY', grok: 'XAI_API_KEY', gemini: 'GEMINI_API_KEY' };
      const envApiKey = process.env[envKeyName[wantProvider] ?? '']?.trim() || undefined;
      const keySource = envApiKey ? 'env' : rot?.apiKey ? 'rotation' : 'MISSING';
      if (envApiKey) cfg.llm.apiKey = envApiKey;
      else if (rot?.apiKey) cfg.llm.apiKey = rot.apiKey;
      if (rot?.baseUrl) cfg.llm.baseUrl = rot.baseUrl;
      console.error(`[monad-self] provider 전환 → ${wantProvider} (apiKey ${keySource})`);
    }
  }
} catch (e) { console.error('[monad-self] 격리 컨텍스트 설정 실패:', e instanceof Error ? e.message : e); }

const task = process.argv.slice(2).join(' ') || 'Create hello.txt containing MONAD_SELF_OK then stop.';
const signal = new AbortController().signal;
const { tools, dispatchTool } = getAutopilotToolRegistry({ surface: 'tui', sessionId: 'monad-self-bench', signal });

// ★ 관측(제1원칙·2026-07-22) — 어느 루프(goal-loop vs custom)·모델·예산으로 구동하는지 logs.db 에.
//   `monad logs --category mission.se.walker` 로 "walker 가 뭘로 어떻게 돌았나" 조회(종전 stderr 사각 해소).
const goalLoopMode = process.env.MONAD_SELF_GOALLOOP === '1';
debug.log('mission.se.walker', 'start', { loop: goalLoopMode ? 'goal-loop' : 'custom-escalation', model: envModel ?? '(default)', maxTurns: envMaxTurns ?? null, adaptive: envAdaptive, verify: process.env.MONAD_SELF_VERIFY_CMD ? true : false });

// ★ 이식 #2 (canonical goal-loop → se build · 2026-07-22 대표 지시 · RESEARCH-porting-goalloop-harness) —
//   opt-in(MONAD_SELF_GOALLOOP=1): 자체 escalation 루프(아래) 대신 canonical runGoalLoop 로 구동한다.
//   흡수 능력: 증거게이트 완주(update_goal+evidence — "테스트 안 돌리고 done" 위증 차단)·구조화
//   `goal.loop` 관측(monad logs 조회)·anti-spin(동일 tool 시그니처 정체감지)·context 압력 관리·구조화
//   stopReason. verify 는 모델이 도구로 실행해 evidence 로 인용(nocturnal-runner gate 가 최종 검증).
//   기본(미설정)=MonadBuiltinTurnRunner 커스텀 루프(무회귀). getAutopilotToolRegistry 반환이 이미
//   {LLMToolSpec[], CoreTurnDispatchTool} 라 래핑 없이 CoreTurnContext 에 직결.
if (process.env.MONAD_SELF_GOALLOOP === '1') {
  const verifyCmd = process.env.MONAD_SELF_VERIFY_CMD;
  const goalTask = verifyCmd
    ? `${task}\n\n검증(완료 전 필수): 구현 후 반드시 \`${verifyCmd}\` 를 실행해 통과를 확인하고, 그 출력을 완료 evidence 로 제시하라. 통과 전엔 완료 선언 금지.`
    : task;
  let glToolCalls = 0;
  const coreCtx: CoreTurnContext = {
    sessionId: 'monad-self-goalloop',
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: goalTask }],
    tools,
    dispatchTool,
    signal,
    callbacks: {
      onText: (delta: string) => process.stderr.write(delta),
      onToolCall: (call) => { glToolCalls++; console.error(`[tool #${glToolCalls}] ${call.name}`); },
    },
    ...(envModel ? { modelOverride: envModel } : {}),
    // ★ 대표 2026-07-23 "이터레이션 말고 나머지 제약은 없어야 한다" — iteration 캡(아래 maxIter=12)만 유일한
    //   제약. per-turn tool 예산은 사실상 무제한(한 iteration 안에서 필요한 만큼 편집·검증). 종전 400 바닥/
    //   ladder 값 캡 제거. env(MONAD_SELF_MAX_TOOL_TURNS) 로만 조정 가능.
    maxToolTurns: Number(process.env.MONAD_SELF_MAX_TOOL_TURNS) || 100000,
  };
  // ★ fail-fast to coordinator(대표 2026-07-23 재설계) — 종전 "예산 무제한(maxIter 1000)"은 goal-loop 이
  //   한 번 gate 에서 터진 뒤(goal_complete 하나 verdict fail) 같은 구조결함을 1000턴 grind 하는 근원이었다.
  //   대표 실증: terra 150→opus 400→opus 1000 전부 gate-failed = 모델능력 아닌 **과대결합(scoping)** 문제 →
  //   분할로 즉시 뚫림. 그래서 이제 **멀티 escalation 없이 짧은 단일 시도**로 돌고, 못 풀면 즉시 조율자
  //   triage(SE ladder 단일 rung → hasMoreRungs=false → split·증거 동반)로 올려 구조를 재편한다.
  //   goal-loop maxIterations 기본은 runGoalLoop 이 8회 — 능력 커진 loop 을 고려해 **12회로 상향**(잘-스코프된
  //   페이즈는 ~3턴에 완주하므로 12면 충분·못 끝내면 mis-scope 신호). env(MONAD_SELF_MAX_ITERATIONS) 로 조정.
  const maxIter = Number(process.env.MONAD_SELF_MAX_ITERATIONS) || 12;
  console.error(`[monad-self] ★ goal-loop 엔진(canonical·증거게이트·fail-fast→coordinator) maxIter=${maxIter} model=${envModel ?? '(default)'}`);
  const gl = await runGoalLoop(coreCtx, { maxIterations: maxIter });
  console.log(`\n[monad-self] goal-loop stopReason=${gl.stopReason} · iterations=${gl.iterations} · toolCalls=${glToolCalls}`);
  debug.log('mission.se.walker', 'goalloop-done', { stopReason: gl.stopReason, iterations: gl.iterations, toolCalls: glToolCalls });
  process.exit(0); // 실제 산출 판정은 nocturnal-runner gate(bun test)가 담당 — 여기선 루프만 완주.
}

console.error(`[monad-self] config: model=${envModel ?? '(default)'} effort=${envEffort ?? '(config)'} maxTurns=${envMaxTurns ?? '(family default)'} adaptive=${envAdaptive} system=${envSystem ?? 'thin'}`);

const runner = new MonadBuiltinTurnRunner({
  sessionId: 'monad-self-bench',
  tools,
  dispatchTool,
  systemPrompt,
  ...(envModel ? { modelOverride: envModel } : {}),
  ...(envMaxTurns !== undefined ? { maxToolTurns: envMaxTurns } : {}),
});

let toolCalls = 0;
const onUpdate = (u: unknown) => {
  const x = u as Record<string, unknown>;
  const su = x.sessionUpdate as string | undefined;
  if (su === 'tool_call' || su === 'tool_call_update') {
    if (su === 'tool_call') toolCalls++;
    const title = x.title ?? x.toolName ?? (x.rawInput as Record<string, unknown>)?.file_path ?? '';
    const status = x.status ?? '';
    const content = JSON.stringify(x.content ?? x.rawOutput ?? '').slice(0, 160);
    console.error(`[tool #${toolCalls}] ${su} · ${String(title).slice(0,60)} · ${status} · ${content}`);
  } else if (su === 'agent_message_chunk') {
    const t = (x.content as { text?: string })?.text; if (t) process.stderr.write(t);
  }
};

let result = await runner.prompt([{ type: 'text', text: task }], onUpdate);

// ── Adaptive escalation — 검증-주도 폐루프 (대표 지시: 상황 따라 turn 확장) ──
// codex 계열은 편집 후 테스트를 안 돌리고 조기 종료(exhausted 핑계)하는 경향이 있다
// (dogfood 2026-07-11). 하니스가 직접 verify 명령을 돌려 폐루프를 닫는다:
//   편집 → verify 실행 → 통과면 성공 → 실패면 그 출력을 모델에 되먹여 "root cause 고쳐라"
//   재프롬프트 → 통과 또는 예산소진까지 반복.
// verify 명령이 없으면 legacy max_turns 기반 확장으로 폴백. 러너 history 가 누적되므로
// 이전 tool evidence 는 보존된다. 무한루프 방지: MAX_ESCALATIONS + 진행 정체 감지.
const verifyCmd = process.env.MONAD_SELF_VERIFY_CMD || undefined;
const MAX_ESCALATIONS = Number(process.env.MONAD_SELF_MAX_ESCALATIONS ?? 4);

/** verify 명령 실행 → { passed, tail }. 실패 출력은 마지막 N줄만 되먹임(컨텍스트 절약). */
function runVerify(cmd: string): { passed: boolean; tail: string } {
  try {
    const out = execSync(cmd, { cwd: execCwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 });
    return { passed: true, tail: out.split('\n').slice(-8).join('\n') };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const combined = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim() || (err.message ?? 'verify failed');
    return { passed: false, tail: combined.split('\n').slice(-30).join('\n') };
  }
}

if (envAdaptive) {
  let escalations = 0;
  let lastToolCalls = toolCalls;
  while (escalations < MAX_ESCALATIONS) {
    if (verifyCmd) {
      // 검증-주도: 실제 게이트를 돌려 성공 판정. 통과하면 즉시 종료.
      const v = runVerify(verifyCmd);
      console.error(`\n[monad-self] verify(${verifyCmd}) → ${v.passed ? 'PASS ✅' : 'FAIL ❌'}`);
      debug.log('mission.se.walker', v.passed ? 'verify-pass' : 'verify-fail', { escalation: escalations, toolCalls, ...(v.passed ? {} : { tail: v.tail.slice(0, 200) }) });
      if (v.passed) { console.error('[monad-self] 검증 통과 — 완료'); break; }
      escalations++;
      console.error(`[monad-self] ⟳ escalation ${escalations}/${MAX_ESCALATIONS} — 실패 출력 되먹임·계속`);
      result = await runner.prompt(
        [{ type: 'text', text: `The verification command \`${verifyCmd}\` FAILED. Here is the tail of its output:\n\n${v.tail}\n\nFix the ROOT CAUSE and make it pass. Edit the necessary files (do not re-read files already in context), then the harness will re-run the command. If you created a test file, make sure it was actually written to disk. Keep going until it passes.` }],
        onUpdate,
      );
    } else {
      // 폴백: verify 없음 → max_turns 로 멈췄을 때만 예산 확장.
      if (result.stopReason !== 'max_turn_requests') break;
      escalations++;
      console.error(`\n[monad-self] ⟳ escalation ${escalations}/${MAX_ESCALATIONS} (max_turns hit·toolCalls=${toolCalls}) — 예산 확장·계속`);
      result = await runner.prompt(
        [{ type: 'text', text: 'You hit the tool-loop budget but the task is not finished. Continue from where you left off. Do NOT re-read files already in context. Prioritise edits and running the test. Stop only when the test passes.' }],
        onUpdate,
      );
    }
    if (toolCalls === lastToolCalls) { console.error('[monad-self] 진행 없음(toolCalls 정체) — escalation 중단'); break; }
    lastToolCalls = toolCalls;
  }
  console.error(`[monad-self] escalations=${escalations}`);
}

console.log(`\n[monad-self] stopReason=${result.stopReason} · toolCalls=${toolCalls}`);
debug.log('mission.se.walker', 'custom-done', { stopReason: result.stopReason, toolCalls });
