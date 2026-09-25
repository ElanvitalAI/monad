// ⑩ 재귀 depth cap 단위 테스트 — 액자(monad→자식 monad) 무한재귀 방지 규약 잠금.
import { describe, test, expect, afterAll, afterEach } from 'bun:test';
import {
  getNestDepth,
  getMaxNestDepth,
  nestCapReached,
  childNestEnv,
  nestInfo,
  observeNestAtBoot,
  resetNestBootObservationForTest,
} from '../src/agent/nest-depth.js';
import { debug } from '../src/debug/log.js';
import { toolSurface } from '../src/boot/daemon-tools/index.js';
import { wrapAutonomousTool } from '../src/agent/surface-ux/wrap.js';
import { defaultSeams } from '../src/self-implement/seams.js';

const origDepth = process.env.MONAD_NEST_DEPTH;
const origMax = process.env.MONAD_MAX_NEST_DEPTH;
// ⛔⭐ 부팅 관측이 origin env 를 함께 싣게 되면서(`origin-observation.ts`) 이 파일의 단언이
//    **바깥 환경에 의존**하게 됐다 — `MONAD_ORIGIN_*` 가 이미 설정된 셸에서는 payload 가 달라진다.
//    ⇒ 테스트는 자기 환경을 스스로 만든다(리뷰 1R must-fix).
const ORIGIN_ENV_KEYS = ['MONAD_ORIGIN_ROOT', 'MONAD_ORIGIN_AGENT', 'MONAD_ORIGIN_SESSION', 'MONAD_CONTROLLER'] as const;
// ⛔ 지우기 전에 **보관한다** — 안 그러면 이 파일이 같은 런의 **다른 테스트와 호출자 환경을 오염**시킨다(리뷰 2R).
const savedOrigin: Record<string, string | undefined> = Object.fromEntries(ORIGIN_ENV_KEYS.map((k) => [k, process.env[k]]));
for (const k of ORIGIN_ENV_KEYS) delete process.env[k];
// ⛔ 파일이 끝나면 **원래대로 돌려놓는다** — `afterAll` 이 그 자리다(내가 *"복원할 자리가 없다"* 고
//    적었던 것은 틀렸다 · 리뷰 2R).
afterAll(() => {
  for (const k of ORIGIN_ENV_KEYS) {
    const v = savedOrigin[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

afterEach(() => {
  // 이 파일이 도는 동안은 origin env 가 **없는 상태**가 계약이다.
  for (const k of ORIGIN_ENV_KEYS) delete process.env[k];
  if (origDepth === undefined) delete process.env.MONAD_NEST_DEPTH;
  else process.env.MONAD_NEST_DEPTH = origDepth;
  if (origMax === undefined) delete process.env.MONAD_MAX_NEST_DEPTH;
  else process.env.MONAD_MAX_NEST_DEPTH = origMax;
  resetNestBootObservationForTest();
});

describe('nest-depth cap (액자 방지)', () => {
  test('최상위=depth 0·기본 max 5·미상한', () => {
    delete process.env.MONAD_NEST_DEPTH;
    delete process.env.MONAD_MAX_NEST_DEPTH;
    expect(getNestDepth()).toBe(0);
    expect(getMaxNestDepth()).toBe(5);
    expect(nestCapReached()).toBe(false);
  });

  test('childNestEnv 는 depth 를 +1 전파', () => {
    process.env.MONAD_NEST_DEPTH = '1';
    expect(childNestEnv()).toEqual({ MONAD_NEST_DEPTH: '2' });
  });

  test('depth==max 면 상한 도달(5중까지 허용·6중 차단)', () => {
    delete process.env.MONAD_MAX_NEST_DEPTH;
    process.env.MONAD_NEST_DEPTH = '5';
    expect(nestCapReached()).toBe(true);
    process.env.MONAD_NEST_DEPTH = '4';
    expect(nestCapReached()).toBe(false);
  });

  test('env MONAD_MAX_NEST_DEPTH override', () => {
    process.env.MONAD_MAX_NEST_DEPTH = '1';
    process.env.MONAD_NEST_DEPTH = '1';
    expect(nestCapReached()).toBe(true);
    expect(nestInfo()).toEqual({ depth: 1, max: 1, capReached: true });
  });

  test('음수/비정상 env 는 0 으로 방어', () => {
    process.env.MONAD_NEST_DEPTH = 'abc';
    expect(getNestDepth()).toBe(0);
    process.env.MONAD_NEST_DEPTH = '-5';
    expect(getNestDepth()).toBe(0);
  });

  test('부팅 관측은 substrate.nest boot payload를 프로세스당 한 번 남긴다', () => {
    const calls: unknown[][] = [];
    const log = debug.log;
    debug.log = ((...args: unknown[]) => { calls.push(args); }) as typeof debug.log;
    try {
      process.env.MONAD_NEST_DEPTH = '1';
      process.env.MONAD_MAX_NEST_DEPTH = '3';
      observeNestAtBoot();
      observeNestAtBoot();
      expect(calls).toEqual([['substrate.nest', 'boot', {
        depth: 1, max: 3, capReached: false,
      }]]);
    } finally {
      debug.log = log;
    }
  });

  test('부팅 관측은 로거 실패를 밖으로 전파하지 않는다', () => {
    const log = debug.log;
    debug.log = () => { throw new Error('sink unavailable'); };
    try {
      expect(() => observeNestAtBoot()).not.toThrow();
    } finally {
      debug.log = log;
    }
  });

  test('상한의 기존 surface-capped와 spawn-refused 관측은 dispatch 경로에 남는다', async () => {
    const calls: unknown[][] = [];
    const log = debug.log;
    debug.log = ((...args: unknown[]) => { calls.push(args); }) as typeof debug.log;
    try {
      process.env.MONAD_NEST_DEPTH = '5';
      const result = await toolSurface('chat').dispatch(
        'delegate_code_agent',
        {},
        { cwd: '.', signal: new AbortController().signal },
      );
      expect(result).toEqual(expect.objectContaining({ error: expect.stringContaining('nest-cap') }));
      expect(calls).toContainEqual(['substrate.nest', 'surface-capped', expect.objectContaining({ depth: 5, max: 5, capReached: true }), { level: 'warn' }]);
      expect(calls).toContainEqual(['substrate.nest', 'spawn-refused', expect.objectContaining({ tool: 'delegate_code_agent', depth: 5, max: 5, capReached: true }), { level: 'warn' }]);
    } finally {
      debug.log = log;
    }
  });

  test('상한의 기존 implement-refused와 nest-cap-refused 관측은 각 실제 거부 경로에 남는다', async () => {
    const calls: unknown[][] = [];
    const log = debug.log;
    debug.log = ((...args: unknown[]) => { calls.push(args); }) as typeof debug.log;
    try {
      process.env.MONAD_NEST_DEPTH = '5';
      const implement = await defaultSeams({ ptyAvailable: () => false }).implement({ cwd: '.', feature: 'noop', runId: 'nest-refusal-test' });
      expect(implement).toEqual(expect.objectContaining({ ok: false, summary: expect.stringContaining('nest-cap') }));

      const wrapped = await wrapAutonomousTool({
        label: 'Nested tool',
        toolNames: ['NestedTool'],
        run: async () => ({ ok: true }),
      }, {}, {});
      expect(wrapped).toEqual(expect.objectContaining({ error: expect.stringContaining('nest cap reached') }));

      expect(calls).toContainEqual(['substrate.nest', 'implement-refused', { depth: 5, max: 5, capReached: true }, { level: 'warn' }]);
      expect(calls).toContainEqual(['surface-ux.wrap', 'nest-cap-refused', { label: 'Nested tool', depth: 5, max: 5, capReached: true }]);
    } finally {
      debug.log = log;
    }
  });
});
