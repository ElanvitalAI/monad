// buildHarnessSpaceAddendum — 자기인지 공간 프리앰블 주입 테스트

import { describe, test, expect, afterEach } from 'bun:test';
import { buildHarnessSpaceAddendum } from './universal-preamble.js';
import { HARNESS_SPACE_ENV, HARNESS_SPACE_ID_ENV } from '../harness/harness-space.js';

afterEach(() => {
  delete process.env[HARNESS_SPACE_ENV];
  delete process.env[HARNESS_SPACE_ID_ENV];
});

describe('buildHarnessSpaceAddendum', () => {
  test('공간 밖(마커 없음) → [](무주입·기존 동작)', () => {
    delete process.env[HARNESS_SPACE_ENV];
    expect(buildHarnessSpaceAddendum()).toEqual([]);
  });

  test('격리 공간 안 → 자기인지 system 메시지 1개', () => {
    process.env[HARNESS_SPACE_ENV] = 'self-implement';
    process.env[HARNESS_SPACE_ID_ENV] = 'f1-grounding';
    const msgs = buildHarnessSpaceAddendum();
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.role).toBe('system');
    const c = String(msgs[0]!.content);
    expect(c).toContain('격리 self-dev-harness 공간');   // 자기인지
    expect(c).toContain('self-implement');                // kind
    expect(c).toContain('f1-grounding');                  // id
    expect(c).toContain('미션 DB 무접촉');                 // 격리 규율(판단 근거)
    expect(c).toContain('fail-closed');                   // PR 규율
    // ★ anti-full-suite(2026-07-25) — 전 family 에 "전체 bun test 금지·변경 파일만" 스코프 규율 주입
    //   (executor 가 전체 스위트를 돌려 execute 타임아웃되던 근본 차단·codex 전용 규율을 family-agnostic 으로 lift).
    expect(c).toContain('전체 `bun test` 스위트는 금지');
    expect(c).toContain('run_tests');
  });

  test('id 없어도 공간 인지(kind만)', () => {
    process.env[HARNESS_SPACE_ENV] = 'dev-harness';
    const msgs = buildHarnessSpaceAddendum();
    expect(msgs.length).toBe(1);
    expect(String(msgs[0]!.content)).toContain('dev-harness');
  });
});
