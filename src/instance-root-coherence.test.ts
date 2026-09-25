// Instance root coherence 가드 테스트 (Phase D2-핵심).

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkInstanceRootCoherence, assertInstanceRootCoherence, detectShadowRootEnvs, checkProdSpawnFootgun, warnProdSpawnFootgun } from './instance-root-coherence.js';
import { setMonadConfigDir, resetMonadConfigDir } from './monad-config-dir.js';
import { resetEffectiveInstanceRoot, setTreeDerivedTestForTesting, treeDerivedTestEnabled } from './instance/resolve.js';
import { debug } from './debug/log.js';

const savedStateDir = process.env.MONAD_STATE_DIR;
const savedNestDepth = process.env.MONAD_NEST_DEPTH;
const savedShadow: Record<string, string | undefined> = {};
for (const e of ['MONAD_HOME', 'MONAD_DIR', 'MONAD_NEXUS_DIR', 'MONAD_TASKS_DIR', 'MONAD_TASKS_DB']) savedShadow[e] = process.env[e];

// ⚠️ **어느 우주를 시험하는지 선언한다** — 3층(트리 파생) 스위치는 **개발자 머신의
//    `~/.monad/config.json`** 을 직접 읽으므로, 선언하지 않으면 이 파일의 결과가 **체크아웃과 머신
//    설정에 좌우된다**(P3 착지 #5479 이후 비-리더 트리에서 4건이 계속 빨간 채였다).
//    아래 단언들은 전부 **1·2층(명시 축)** 을 시험하므로 3층은 **OFF 로 고정**한다.
//    3층 ON 의 동작은 별도 describe 가 따로 시험한다.
beforeEach(() => {
  resetEffectiveInstanceRoot();
  setTreeDerivedTestForTesting(false);
});

afterEach(() => {
  setTreeDerivedTestForTesting(undefined);   // 실제 머신 설정으로 복원
  resetEffectiveInstanceRoot();
  resetMonadConfigDir();
  if (savedStateDir === undefined) delete process.env.MONAD_STATE_DIR;
  else process.env.MONAD_STATE_DIR = savedStateDir;
  if (savedNestDepth === undefined) delete process.env.MONAD_NEST_DEPTH;
  else process.env.MONAD_NEST_DEPTH = savedNestDepth;
  for (const [e, v] of Object.entries(savedShadow)) {
    if (v === undefined) delete process.env[e];
    else process.env[e] = v;
  }
});

// seam 자체의 동작 — 오버라이드가 머신 config 를 이기고, `undefined` 로 실제 설정이 복원된다.
// ⚠️ 이 파일에 두는 이유: 축 선언을 **실제로 쓰는 곳**이라 seam 이 깨지면 여기가 먼저 깨진다.
describe('setTreeDerivedTestForTesting — 축 선언 seam', () => {
  test('오버라이드가 머신 config 를 이긴다 · undefined 로 복원', () => {
    const machine = (() => { setTreeDerivedTestForTesting(undefined); return treeDerivedTestEnabled(); })();
    setTreeDerivedTestForTesting(true);
    expect(treeDerivedTestEnabled()).toBe(true);
    setTreeDerivedTestForTesting(false);
    expect(treeDerivedTestEnabled()).toBe(false);
    setTreeDerivedTestForTesting(undefined);
    expect(treeDerivedTestEnabled()).toBe(machine);
  });
});

describe('checkInstanceRootCoherence', () => {
  test('prod 기본(양축 미설정) → 둘 다 ~/.monad → coherent', () => {
    resetMonadConfigDir();
    delete process.env.MONAD_STATE_DIR;
    const c = checkInstanceRootCoherence();
    expect(c.configDir).toBe(join(homedir(), '.monad'));
    expect(c.stateDir).toBe(join(homedir(), '.monad'));
    expect(c.coherent).toBe(true);
  });

  test('--test 동형(양축 같은 뿌리) → coherent', () => {
    setMonadConfigDir('/tmp/repo/.monad-test');
    process.env.MONAD_STATE_DIR = '/tmp/repo/.monad-test';
    expect(checkInstanceRootCoherence().coherent).toBe(true);
  });

  // ⭐ **P3(#5479) 이 이 결함을 없앴다** — 종전 두 테스트는 *"한 축만 설정 → 갈라짐(2026-07-19 누출류)"*
  //    을 **기대값으로 박아** 두었는데, P3 이후 두 축이 `effectiveInstanceRoot` 한 함수로 수렴해
  //    **다른 축이 따라온다.** 그래서 그 단언들은 *고쳐진 결함이 그대로 있기를* 요구하고 있었다.
  //    ⇒ 새 불변식을 단언한다. 갈라짐 자체의 판정 로직은 아래 `assertInstanceRootCoherence` 가 주입으로 덮는다.
  test('⭐ MONAD_STATE_DIR 만 설정 → config-dir 이 **따라온다**(P3 이후 · 종전엔 divergent 를 기대했다)', () => {
    resetMonadConfigDir();
    process.env.MONAD_STATE_DIR = '/tmp/repo/.monad-test';
    const c = checkInstanceRootCoherence();
    expect(c.stateDir).toBe('/tmp/repo/.monad-test');
    expect(c.configDir).toBe('/tmp/repo/.monad-test');   // ← 따라옴
    expect(c.coherent).toBe(true);
  });

  test('⭐ --config-dir 만 설정 → state-dir 이 **따라온다**(1층이 공통 뿌리)', () => {
    setMonadConfigDir('/tmp/repo/.monad-test');
    delete process.env.MONAD_STATE_DIR;
    const c = checkInstanceRootCoherence();
    expect(c.configDir).toBe('/tmp/repo/.monad-test');
    expect(c.stateDir).toBe('/tmp/repo/.monad-test');
    expect(c.coherent).toBe(true);
  });
});

describe('assertInstanceRootCoherence', () => {
  test('coherent 면 조용히 통과(throw 안 함)', () => {
    resetMonadConfigDir();
    delete process.env.MONAD_STATE_DIR;
    expect(() => assertInstanceRootCoherence({ throwOnDivergence: true })).not.toThrow();
  });

  // ⚠️ divergence 는 P3 이후 **공개 API 로 재현 불가**(두 축이 한 함수로 수렴). 가드 로직을 지우지
  //    않으려면 축을 주입해야 한다 — 그래서 `readers` 를 쓴다. 프로덕션 경로는 인자 없이 부른다.
  const divergent = { configDir: () => '/tmp/a', stateDir: () => '/tmp/b' };

  test('divergent + warn-first(기본) → throw 안 함', () => {
    expect(() => assertInstanceRootCoherence({ readers: divergent })).not.toThrow();
  });

  test('divergent + throwOnDivergence → throw', () => {
    expect(() => assertInstanceRootCoherence({ throwOnDivergence: true, readers: divergent })).toThrow(/divergence/);
  });

  test('⭐ 실제 축으로는 갈라지지 않는다 — 한 축만 설정해도 따라온다(P3 불변식)', () => {
    setMonadConfigDir('/tmp/repo/.monad-test');
    delete process.env.MONAD_STATE_DIR;
    expect(() => assertInstanceRootCoherence({ throwOnDivergence: true })).not.toThrow();
  });
});

describe('checkProdSpawnFootgun (backlog #1)', () => {
  // footgun = nested(depth>0) AND interactive(TTY) AND resolver-backed prod.
  // interactive 는 주입해 TTY 비의존 결정 테스트. 진리표 전 조합 확인.
  test('MONAD_STATE_DIR 비어도 3층 파생 격리 자식이면 prod 아님 (env predicate 회귀 방지)', () => {
    process.env.MONAD_NEST_DEPTH = '1';
    delete process.env.MONAD_STATE_DIR;
    setTreeDerivedTestForTesting(true);
    resetEffectiveInstanceRoot();
    const f = checkProdSpawnFootgun({ interactive: true });
    expect(f.prod).toBe(false);
    expect(f.footgun).toBe(false);
  });

  test('MONAD_STATE_DIR 비고 3층 파생도 없으면 prod (참 양성 유지)', () => {
    process.env.MONAD_NEST_DEPTH = '1';
    delete process.env.MONAD_STATE_DIR;
    setTreeDerivedTestForTesting(false);
    resetEffectiveInstanceRoot();
    expect(checkProdSpawnFootgun({ interactive: true })).toEqual({ nested: true, interactive: true, prod: true, footgun: true });
  });

  test('nested + interactive + prod → footgun (유일한 참 조합)', () => {
    process.env.MONAD_NEST_DEPTH = '1';
    delete process.env.MONAD_STATE_DIR;
    const f = checkProdSpawnFootgun({ interactive: true });
    expect(f).toEqual({ nested: true, interactive: true, prod: true, footgun: true });
  });

  test('nested + interactive 이지만 격리됨(MONAD_STATE_DIR 설정) → 침묵', () => {
    process.env.MONAD_NEST_DEPTH = '1';
    process.env.MONAD_STATE_DIR = '/tmp/repo/.monad-test';
    const f = checkProdSpawnFootgun({ interactive: true });
    expect(f.prod).toBe(false);
    expect(f.footgun).toBe(false);
  });

  test('nested 아님(top-level) + interactive + prod → 침묵 (self-dev 직접실행 아님)', () => {
    delete process.env.MONAD_NEST_DEPTH; // depth 0
    delete process.env.MONAD_STATE_DIR;
    const f = checkProdSpawnFootgun({ interactive: true });
    expect(f.nested).toBe(false);
    expect(f.footgun).toBe(false);
  });

  test('nested + prod 이지만 non-interactive(데몬/harness 자식) → 침묵', () => {
    process.env.MONAD_NEST_DEPTH = '2';
    delete process.env.MONAD_STATE_DIR;
    const f = checkProdSpawnFootgun({ interactive: false });
    expect(f.interactive).toBe(false);
    expect(f.footgun).toBe(false);
  });

  test('depth 0 은 nested 아님(경계) — depth 1 부터 nested', () => {
    process.env.MONAD_NEST_DEPTH = '0';
    expect(checkProdSpawnFootgun({ interactive: true }).nested).toBe(false);
    process.env.MONAD_NEST_DEPTH = '1';
    expect(checkProdSpawnFootgun({ interactive: true }).nested).toBe(true);
  });
});

describe('detectShadowRootEnvs (Phase F)', () => {
  test('shadow-root env 미설정 → 빈 목록', () => {
    for (const e of ['MONAD_HOME', 'MONAD_DIR', 'MONAD_NEXUS_DIR', 'MONAD_TASKS_DIR', 'MONAD_TASKS_DB']) delete process.env[e];
    expect(detectShadowRootEnvs()).toEqual([]);
  });

  test('MONAD_TASKS_DB 설정(config-dir 우회 footgun) → 감지', () => {
    for (const e of ['MONAD_HOME', 'MONAD_DIR', 'MONAD_NEXUS_DIR', 'MONAD_TASKS_DIR', 'MONAD_TASKS_DB']) delete process.env[e];
    process.env.MONAD_TASKS_DB = '/tmp/rogue/tasks.db';
    expect(detectShadowRootEnvs()).toEqual([{ name: 'MONAD_TASKS_DB', value: '/tmp/rogue/tasks.db' }]);
  });

  test('shadow env 설정돼도 assert 는 throw 안 함(warn-first)', () => {
    resetMonadConfigDir();
    delete process.env.MONAD_STATE_DIR;
    process.env.MONAD_HOME = '/tmp/shadow';
    expect(() => assertInstanceRootCoherence()).not.toThrow();
  });
});

describe('warnProdSpawnFootgun — emit 게이팅(P3·2026-07-26)', () => {
  // 실제 debug.registerSink 로 debug.log record 를 캡처(mock.module 없이·logs.db StoreSink 와 동일 경로) +
  //   process.stderr.write 원본 메서드 저장·복원. emit 별로 log/stderr 두 채널이 옳게 게이팅되는지 직접 검증.
  function withCapture(fn: () => void): { logs: { category: string; event: string; data?: Record<string, unknown> }[]; stderr: string } {
    const logs: { category: string; event: string; data?: Record<string, unknown> }[] = [];
    const off = debug.registerSink({ name: 'p3-test-capture', emit: (rec) => {
      logs.push({ category: rec.category, event: rec.event, ...(rec.data && typeof rec.data === 'object' ? { data: rec.data as Record<string, unknown> } : {}) });
    } });
    const origWrite = process.stderr.write;   // 원본 메서드 저장(bound wrapper 아님 — 전역 오염 방지)
    let stderr = '';
    process.stderr.write = ((s: string | Uint8Array) => { stderr += String(s); return true; }) as typeof process.stderr.write;
    try { fn(); } finally { process.stderr.write = origWrite; off(); }
    return { logs, stderr };
  }
  const footgunEnv = (): void => { process.env.MONAD_NEST_DEPTH = '1'; delete process.env.MONAD_STATE_DIR; };
  const hasFootgunLog = (logs: { category: string; event: string }[]): boolean =>
    logs.some((r) => r.category === 'instance.identity' && r.event === 'prod-spawn-footgun');

  test("emit:'log' → debug.log 발생(logs.db 도달 관문)·stderr 억제", () => {
    footgunEnv();
    const { logs, stderr } = withCapture(() => { warnProdSpawnFootgun({ interactive: true, emit: 'log' }); });
    expect(hasFootgunLog(logs)).toBe(true);   // sink(=logs.db StoreSink 동형)가 record 를 받음 = 도달 실증
    const record = logs.find((r) => r.category === 'instance.identity' && r.event === 'prod-spawn-footgun');
    expect(record?.data).toMatchObject({ kind: 'prod', layer: 'default', why: '기본값(~/.monad) — 명시도 스탬프도 없음' });
    expect(typeof record?.data?.root).toBe('string');
    expect(stderr).toBe('');
  });

  test("emit:'stderr' → stderr 발생·debug.log 억제", () => {
    footgunEnv();
    const { logs, stderr } = withCapture(() => {
      const f = warnProdSpawnFootgun({ interactive: true, emit: 'stderr' });
      expect(f.footgun).toBe(true);
    });
    expect(stderr).toContain('[instance]');
    expect(hasFootgunLog(logs)).toBe(false);
  });

  test("emit 기본('both') → debug.log·stderr 양쪽 발생(무회귀)", () => {
    footgunEnv();
    const { logs, stderr } = withCapture(() => { warnProdSpawnFootgun({ interactive: true }); });
    expect(hasFootgunLog(logs)).toBe(true);
    expect(stderr).toContain('[instance]');
  });

  test('자식 depth 경고는 --test 처방 대신 현재 우주와 리졸버 근거를 보인다', () => {
    process.env.MONAD_NEST_DEPTH = '2';
    delete process.env.MONAD_STATE_DIR;
    const { stderr } = withCapture(() => { warnProdSpawnFootgun({ interactive: true, emit: 'stderr' }); });
    expect(stderr).not.toContain('--test 를 붙이세요');
    expect(stderr).toContain('현재 우주: prod');
    expect(stderr).toContain('layer=default');
  });

  test('footgun 아니면(비인터랙티브) 양쪽 무출력', () => {
    footgunEnv();
    const { logs, stderr } = withCapture(() => {
      const f = warnProdSpawnFootgun({ interactive: false, emit: 'both' });
      expect(f.footgun).toBe(false);
    });
    expect(stderr).toBe('');
    expect(hasFootgunLog(logs)).toBe(false);
  });
});
