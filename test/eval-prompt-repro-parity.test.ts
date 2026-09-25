// repro(B1 프로브) 파리티 회귀 — 2026-07-27 리뷰 must-fix.
//
// 발단(실측): 같은 골이 데몬에선 `RunDevHarness` 를 부르는데 `monad repro --tools webterm`
// 은 0회였다. 축이 둘 갈려 있었다 — ①프롬프트(데몬은 `monadSelfAccessPrompt` 를 주입하는데
// repro 는 안 했다 · `--tools` 는 **툴 목록만** 맞춘다) ②모델(`opts.model ?? 'gpt-5.5'`
// 하드코딩이라 config 라우팅을 무시했다).
//
// ⚠️ 이게 왜 실버그인가: B1 은 "자연어로 툴을 고르나" 를 재는 **판정 프로브**다. 프로브가
//    실제와 반대 답을 내면 사다리(B0→B1→B2…) 자체가 못 쓰게 된다. 수리했지만 회귀로 잠기지
//    않으면 조용히 다시 갈리므로 여기서 못 박는다.

import { describe, expect, test } from 'bun:test';
import { reproSurfaceParityMessages, resolveReproModelId } from '../src/eval-prompt-cli.js';

describe('repro 파리티 ① 프롬프트 — 데몬 서피스에만 self-access 를 주입한다', () => {
  const SENTINEL = '<<self-access-prompt>>';
  const stub = () => SENTINEL;

  test('★chat·webterm 은 데몬 서피스라 주입한다', () => {
    for (const tools of ['chat', 'webterm'] as const) {
      const msgs = reproSurfaceParityMessages(tools, stub);
      expect({ tools, n: msgs.length, role: msgs[0]?.role, body: msgs[0]?.content })
        .toEqual({ tools, n: 1, role: 'system', body: SENTINEL });
    }
  });

  test('★cli 는 데몬 서피스가 아니라 무접촉 — 종전 동작 유지', () => {
    expect(reproSurfaceParityMessages('cli', stub)).toEqual([]);
  });

  test('서피스 미지정도 무접촉', () => {
    expect(reproSurfaceParityMessages(undefined, stub)).toEqual([]);
  });

  test('주입하지 않는 서피스에서는 프롬프트를 **만들지도** 않는다', () => {
    // 프롬프트 조립은 공짜가 아니므로 cli 경로에서 호출 자체가 없어야 한다.
    let calls = 0;
    reproSurfaceParityMessages('cli', () => { calls++; return SENTINEL; });
    expect(calls).toBe(0);
  });
});

describe('repro 파리티 ② 모델 — 명시 > provider 기본 > 최후 폴백', () => {
  test('★명시 모델이 최우선 (provider 기본이 있어도)', () => {
    expect(resolveReproModelId('gpt-5.6-sol', 'gpt-5.6-terra')).toBe('gpt-5.6-sol');
  });

  test('★명시가 없으면 config 라우팅(provider 기본)을 쓴다 — 하드코딩이 이기지 않는다', () => {
    // 이게 원래 결함이었다: 하드코딩이 기본이라 프로브가 데몬과 다른 모델로 판정했다.
    expect(resolveReproModelId(undefined, 'gpt-5.6-terra')).toBe('gpt-5.6-terra');
  });

  test('provider 가 기본 모델을 못 주는 경우에만 최후 폴백', () => {
    expect(resolveReproModelId(undefined, undefined)).toBe('gpt-5.5');
  });

  test('최후 폴백은 마지막 그물일 뿐 — 앞의 두 축이 있으면 절대 쓰이지 않는다', () => {
    expect(resolveReproModelId('m-explicit', 'm-default', 'm-lastresort')).toBe('m-explicit');
    expect(resolveReproModelId(undefined, 'm-default', 'm-lastresort')).toBe('m-default');
  });
});
