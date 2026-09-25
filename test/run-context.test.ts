// ⑨ 런컨텍스트 자기인지 단위 테스트 — 자율빌드/측정 컨텍스트서 outward 서피스 억제 규약 잠금.
import { describe, test, expect, afterEach } from 'bun:test';
import {
  getRunContext,
  isAutonomousRunContext,
  childRunContextEnv,
} from '../src/agent/run-context.js';

const orig = process.env.MONAD_RUN_CONTEXT;
afterEach(() => {
  if (orig === undefined) delete process.env.MONAD_RUN_CONTEXT;
  else process.env.MONAD_RUN_CONTEXT = orig;
});

describe('run-context (⑨ 서피스 적응)', () => {
  test('기본 production·비자율', () => {
    delete process.env.MONAD_RUN_CONTEXT;
    expect(getRunContext()).toBe('production');
    expect(isAutonomousRunContext()).toBe(false);
  });

  test('self-build/benchmark/simulator = 자율(서피스 억제 대상)', () => {
    for (const ctx of ['self-build', 'benchmark', 'simulator'] as const) {
      process.env.MONAD_RUN_CONTEXT = ctx;
      expect(getRunContext()).toBe(ctx);
      expect(isAutonomousRunContext()).toBe(true);
    }
  });

  test('알 수 없는 값은 production 으로 방어', () => {
    process.env.MONAD_RUN_CONTEXT = 'garbage';
    expect(getRunContext()).toBe('production');
    expect(isAutonomousRunContext()).toBe(false);
  });

  test('childRunContextEnv 전파', () => {
    expect(childRunContextEnv('self-build')).toEqual({ MONAD_RUN_CONTEXT: 'self-build' });
  });
});
