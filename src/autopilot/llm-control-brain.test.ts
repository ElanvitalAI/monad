// PLAN §7 P3b — LLM 제어 brain. 주입 stream(스텁)으로 순수 검증(실 LLM 무관).
import { describe, expect, test } from 'bun:test';
import { createLlmControlBrain, parseControlDecision, extractFirstJsonObject, type StreamLLMFn } from './llm-control-brain.js';
import { runPtyControlLoop, controlDepsForHandle, type ControlObservation, type RunSupervisor } from './pty-control-loop.js';
import { decideInterventionStep } from '../self-implement/intervention-step.js';

const obs = (over: Partial<ControlObservation> = {}): ControlObservation => {
  const observation = { screen: 'screen', state: 'idle' as const, step: 0, changed: false, ...over };
  return {
    ...observation,
    intervention: decideInterventionStep({
      screen: observation.screen,
      previous: null,
      stopAfterSameScreens: 2,
      descriptor: { level: 'L3', controlStance: 'owned', draft: 'continue' },
    }),
  };
};

describe('parseControlDecision', () => {
  test('input — text 동반', () => {
    expect(parseControlDecision('{"action":"input","text":"go\\r"}')).toEqual({ action: 'input', text: 'go\r' });
  });
  test('done — reason', () => {
    expect(parseControlDecision('{"action":"done","reason":"완료"}')).toEqual({ action: 'done', reason: '완료' });
  });
  test('wait', () => {
    expect(parseControlDecision('{"action":"wait"}')).toEqual({ action: 'wait' });
  });
  test('no-progress — reason 동반', () => {
    expect(parseControlDecision('{"action":"no-progress","reason":"화면이 멈췄지만 완료 표시는 없음"}'))
      .toEqual({ action: 'no-progress', reason: '화면이 멈췄지만 완료 표시는 없음' });
  });
  test('no-progress 인데 reason 없음 → wait(fail-soft)', () => {
    expect(parseControlDecision('{"action":"no-progress"}')).toEqual({ action: 'wait' });
  });
  test('input 인데 text 없음 → wait(fail-soft)', () => {
    expect(parseControlDecision('{"action":"input"}')).toEqual({ action: 'wait' });
  });
  test('무JSON → wait', () => {
    expect(parseControlDecision('그냥 텍스트')).toEqual({ action: 'wait' });
  });
  test('JSON 파싱 실패 → wait', () => {
    expect(parseControlDecision('{action: broken')).toEqual({ action: 'wait' });
  });
  test('산문 속 JSON 추출', () => {
    expect(parseControlDecision('결정: {"action":"done","reason":"ok"} 끝')).toMatchObject({ action: 'done' });
  });
  test('JSON 뒤 다른 중괄호 있어도 첫 균형 객체 파싱(review·탐욕적 아님)', () => {
    expect(parseControlDecision('{"action":"input","text":"go\\r"} 그리고 {noise}')).toEqual({ action: 'input', text: 'go\r' });
  });
  test('문자열 내 중괄호 무시(depth 스캔)', () => {
    expect(extractFirstJsonObject('{"action":"input","text":"a{b}c"}')).toBe('{"action":"input","text":"a{b}c"}');
  });
});

describe('createLlmControlBrain', () => {
  test('stream 결과를 결정으로 파싱 + 히스토리 축적', async () => {
    const seen: string[] = [];
    const stream: StreamLLMFn = async (messages) => {
      seen.push((messages[1] as { content: string }).content);
      return '{"action":"input","text":"hello\\r","reason":"프롬프트"}';
    };
    const brain = createLlmControlBrain({ goal: '테스트 골', stream });
    const d = await brain.decide(obs({ step: 3 }));
    expect(d).toEqual({ action: 'input', text: 'hello\r' });
    expect(seen[0]).toContain('스텝 3'); // user 프롬프트에 스텝
  });

  test('시스템 프롬프트에 목표 + #1 상태 보간(고유값·review Goodhart 방지)', async () => {
    let sys = '';
    const stream: StreamLLMFn = async (m) => { sys = (m[0] as { content: string }).content; return '{"action":"wait"}'; };
    const brain = createLlmControlBrain({ goal: 'ZEBRA_GOAL', stream });
    // 'idle' 은 템플릿 고정문구에 없음 → 실제 obs.state 보간이어야만 등장(blocked 는 고정문구에 있어 Goodhart).
    await brain.decide(obs({ state: 'idle' }));
    expect(sys).toContain('ZEBRA_GOAL');
    expect(sys).toMatch(/참고 신호\): idle/); // 실제 obs.state 보간 검증
  });

  test('round context reaches actual LLM messages and makes the screen a supporting signal', async () => {
    let sys = '';
    let usr = '';
    const stream: StreamLLMFn = async (m) => {
      sys = (m[0] as { content: string }).content;
      usr = (m[1] as { content: string }).content;
      return '{"action":"wait"}';
    };
    const brain = createLlmControlBrain({ goal: 'ROUND_GOAL', stream });
    await brain.decide(obs({
      screen: 'ROUND_SCREEN',
      roundContext: { round: 4, effectiveMax: 5, previousRoundFailure: 'PREVIOUS_FAILURE' },
    }));
    expect(sys).toContain('화면은 현재 신호 하나다');
    expect(usr).toContain('현재 라운드: 4/5');
    expect(usr).toContain('직전 라운드 실패: PREVIOUS_FAILURE');
    expect(usr).toContain('ROUND_SCREEN');
  });

  test('landed sibling summary reaches the actual LLM prompt with bounded metadata', async () => {
    let usr = '';
    const stream: StreamLLMFn = async (m) => { usr = (m[1] as { content: string }).content; return '{"action":"wait"}'; };
    const brain = createLlmControlBrain({ goal: 'LANDED_SIBLING_GOAL', stream });
    await brain.decide(obs({
      roundContext: {
        round: 1,
        effectiveMax: 2,
        previousRoundFailure: 'REWORK',
        landedSiblings: {
          items: [{ runId: 'sibling-1', shardId: 'shard-1', pieceIndex: 1, prNumber: 123 }],
          shownItems: 1,
          totalItems: 17,
          omittedItems: 16,
          truncated: true,
        },
      },
    }));
    expect(usr).toContain('착지한 형제: #123 (shard-1)');
    expect(usr).toContain('표시 1/17 · 생략 16 · 잘림 true');
  });

  test('round context absent preserves the prior LLM prompt shape', async () => {
    let sys = '';
    let usr = '';
    const stream: StreamLLMFn = async (m) => {
      sys = (m[0] as { content: string }).content;
      usr = (m[1] as { content: string }).content;
      return '{"action":"wait"}';
    };
    const brain = createLlmControlBrain({ goal: 'x', stream });
    await brain.decide(obs({ screen: 'SCREEN_ONLY' }));
    expect(sys).toContain('화면만 보고');
    expect(sys).not.toContain('화면은 현재 신호 하나다');
    expect(usr).not.toContain('=== 라운드 맥락 ===');
    expect(usr).toContain('SCREEN_ONLY');
  });

  test('obs.screen 고유 내용이 user 프롬프트에 포함(화면→LLM 계약·review)', async () => {
    let usr = '';
    const stream: StreamLLMFn = async (m) => { usr = (m[1] as { content: string }).content; return '{"action":"wait"}'; };
    const brain = createLlmControlBrain({ goal: 'x', stream });
    await brain.decide(obs({ screen: 'UNIQUE_SCREEN_TOKEN_9Z7Q' }));
    expect(usr).toContain('UNIQUE_SCREEN_TOKEN_9Z7Q');
  });

  test('정지 맥락을 user 프롬프트에 사람이 읽는 형태로 넣는다', async () => {
    let usr = '';
    const stream: StreamLLMFn = async (m) => { usr = (m[1] as { content: string }).content; return '{"action":"wait"}'; };
    const brain = createLlmControlBrain({ goal: 'x', stream });
    await brain.decide(obs({ sameScreenMs: 464_190, stallRung: 2 }));
    expect(usr).toContain('화면 무변화: 464초(7분 44초) · stall 사다리 2단');
  });

  // ⭐⭐ 사후 리뷰 must-fix(2026-07-27) — 정지 값이 **없을 때** 프롬프트가 종전과 같아야 한다.
  //   P3b 초판은 시스템 프롬프트에 "화면이 오래 얼어붙으면 done 고려" 를 **무조건** 넣어,
  //   정지 값을 채우지 않는 **다른 소비자**(agent-mission 등)의 프롬프트까지 조용히 바꿨다.
  //   근거 없이 done 쪽으로 미는 지침을 주는 셈이라 판단 품질에 직접 영향한다.
  test('⭐ 정지 값이 없으면 정지 지침이 프롬프트에 없다 (다른 소비자 무회귀)', async () => {
    let sys = '';
    const stream: StreamLLMFn = async (m) => { sys = (m[0] as { content: string }).content; return '{"action":"wait"}'; };
    const brain = createLlmControlBrain({ goal: 'x', stream });
    await brain.decide(obs());                       // sameScreenMs·stallRung 미주입
    expect(sys).not.toContain('얼어붙');
    // 3-action 계약과 나머지 골격은 그대로다(지침만 조건부).
    expect(sys).toContain('"input"');
    expect(sys).toContain('"wait"');
    expect(sys).toContain('"done"');
    expect(sys).not.toContain('"no-progress"');
  });

  test('⭐ 정지 값이 실리면 정지 지침이 붙는다 (조건부의 반대 방향)', async () => {
    let sys = '';
    const stream: StreamLLMFn = async (m) => { sys = (m[0] as { content: string }).content; return '{"action":"wait"}'; };
    const brain = createLlmControlBrain({ goal: 'x', stream });
    await brain.decide(obs({ sameScreenMs: 464_190, stallRung: 2 }));
    expect(sys).toContain('얼어붙');
    expect(sys).toContain('"no-progress"');
    expect(sys).toContain('완료를 주장할 수 없으면');
  });

  test('LLM 오류 → wait(fail-soft·throw 안 함)', async () => {
    const stream: StreamLLMFn = async () => { throw new Error('provider down'); };
    const brain = createLlmControlBrain({ goal: 'x', stream });
    expect(await brain.decide(obs())).toEqual({ action: 'wait' });
  });

  test('onDecision 훅 호출', async () => {
    const calls: string[] = [];
    const stream: StreamLLMFn = async () => '{"action":"done","reason":"끝"}';
    const brain = createLlmControlBrain({ goal: 'x', stream, onDecision: (d) => calls.push(d.action) });
    await brain.decide(obs());
    expect(calls).toEqual(['done']);
  });

  test('히스토리 — 이전 결정이 다음 프롬프트에 포함(review)', async () => {
    const prompts: string[] = [];
    let i = 0;
    const stream: StreamLLMFn = async (m) => { prompts.push((m[1] as { content: string }).content); return i++ === 0 ? '{"action":"input","text":"a\\r"}' : '{"action":"wait"}'; };
    const brain = createLlmControlBrain({ goal: 'g', stream });
    await brain.decide(obs({ step: 0 }));
    await brain.decide(obs({ step: 1 }));
    expect(prompts[1]).toContain('0:input'); // 2번째 프롬프트에 1번째 결정
  });

  test('timeout — provider 멈추면 wait(루프 종료 지연 방지·review)', async () => {
    const stream: StreamLLMFn = () => new Promise<string>(() => {}); // 영원히 pending
    const brain = createLlmControlBrain({ goal: 'x', stream, timeoutMs: 30 });
    expect(await brain.decide(obs())).toEqual({ action: 'wait' });
  });

  test('timeout — in-flight streamLLM 을 signal 로 abort(orphan 방지·review)', async () => {
    let aborted = false;
    const stream: StreamLLMFn = (_m, _cb, o) => new Promise<string>((_, rej) => {
      o?.signal?.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')); });
    });
    const brain = createLlmControlBrain({ goal: 'x', stream, timeoutMs: 20 });
    expect(await brain.decide(obs())).toEqual({ action: 'wait' });
    expect(aborted).toBe(true); // 진행중 요청 취소됨
  });
});

// ── LLM brain → controlDepsForHandle → registry arbiter 실배선(mock adapter) ──
describe('createLlmControlBrain + controlDepsForHandle (실배선 통합)', () => {
  test('LLM 결정이 controlDepsForHandle 통해 arbiter agent write 로', async () => {
    process.env.ELANOUS_STATE_DIR ||= '/tmp/p3b-brain-test';
    const { startPty, setPtyAdapterForTesting, unregisterPty } = await import('../pty-shell/registry.js');
    const writes: string[] = [];
    setPtyAdapterForTesting(() => ({
      pid: 9, write: (s: string) => { writes.push(s); }, kill: () => {}, resize: () => {},
      onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
    }));
    const ids: string[] = [];
    try {
      const script = ['{"action":"input","text":"answer\\r"}', '{"action":"done","reason":"완료"}'];
      let i = 0;
      const stream: StreamLLMFn = async () => script[Math.min(i++, script.length - 1)]!;
      const brain: RunSupervisor = createLlmControlBrain({ goal: '답 입력', stream });
      const h = startPty({ cmd: 'x', accessMode: 'auto', transitionPolicy: 'open', detach: true });
      ids.push(h.id);
      const r = await runPtyControlLoop(brain, controlDepsForHandle(h), { maxSteps: 10, pollMs: 0 });
      expect(r.termination.kind).toBe('success');
      expect(writes).toEqual(['answer\r']); // LLM 결정 → controlDepsForHandle → arbiter auto+agent write
    } finally {
      for (const id of ids) unregisterPty(id);
      setPtyAdapterForTesting(null);
    }
  });

  test('observe→화면→LLM 실경로 — onData 방출·화면 읽는 stub(review Goodhart 방지)', async () => {
    process.env.ELANOUS_STATE_DIR ||= '/tmp/p3b-brain-test';
    const { startPty, setPtyAdapterForTesting, unregisterPty } = await import('../pty-shell/registry.js');
    const emitRef: { fn: ((d: string) => void) | null } = { fn: null };
    const writes: string[] = [];
    setPtyAdapterForTesting(() => ({
      pid: 5, write: (s: string) => { writes.push(s); }, kill: () => {}, resize: () => {},
      onData: (cb: (d: string) => void) => { emitRef.fn = cb; return { dispose() {} }; }, onExit: () => ({ dispose() {} }),
    }));
    const ids: string[] = [];
    try {
      const h = startPty({ cmd: 'x', accessMode: 'auto', transitionPolicy: 'open', detach: true });
      ids.push(h.id);
      emitRef.fn?.('SECRET_CODE_88\r\n'); // 자식 출력 → 에뮬레이터 → renderScreen 에 반영
      let done = false;
      // stub "LLM" 이 실제 user 프롬프트의 화면 내용을 읽어 결정(화면 무시 아님).
      const stream: StreamLLMFn = async (m) => {
        const screen = (m[1] as { content: string }).content;
        if (done) return '{"action":"done","reason":"완료"}';
        const code = screen.match(/SECRET_CODE_(\d+)/)?.[1];
        if (code) { done = true; return JSON.stringify({ action: 'input', text: `${code}\r` }); }
        return '{"action":"wait"}';
      };
      const brain = createLlmControlBrain({ goal: '화면의 코드 입력', stream });
      const r = await runPtyControlLoop(brain, controlDepsForHandle(h), { maxSteps: 6, pollMs: 0 });
      expect(r.termination.kind).toBe('success');
      expect(writes).toContain('88\r'); // 화면(renderScreen)에서 읽은 코드가 arbiter write 로 = observe→LLM→inject 실경로
    } finally {
      for (const id of ids) unregisterPty(id);
      setPtyAdapterForTesting(null);
    }
  });
});

describe('createLlmControlBrain + runPtyControlLoop (자율 통합)', () => {
  test('LLM brain 이 제어 루프를 완주(input×2 → done)', async () => {
    // 스텝별 스크립트된 "LLM" — 화면 무관 결정론.
    const script = [
      '{"action":"input","text":"step0\\r"}',
      '{"action":"input","text":"step1\\r"}',
      '{"action":"done","reason":"목표 달성"}',
    ];
    let i = 0;
    const stream: StreamLLMFn = async () => script[Math.min(i++, script.length - 1)]!;
    const injected: string[] = [];
    const deps = {
      observe: () => 'child screen',
      inject: (t: string) => { injected.push(t); return true; },
      sleep: async () => {},
    };
    const brain = createLlmControlBrain({ goal: '2 스텝 주입', stream });
    const r = await runPtyControlLoop(brain, deps, { maxSteps: 10, pollMs: 0 });
    expect(r.termination).toEqual({ kind: 'success', reason: '목표 달성' });
    expect(injected).toEqual(['step0\r', 'step1\r']); // LLM 결정이 arbiter inject 로
  });
});
