// #24 A — subprocess 위임 직렬화/파싱 계약(순수). 격리(데몬 무블로킹)는 대조실험으로 실증됨.
import { describe, test, expect } from 'bun:test';
import {
  DETACHED_PROGRESS_FRAME_PREFIX,
  type DetachedProgressFrame,
  decodeDetachedPayload,
  decodeDetachedProgressFrame,
  encodeDetachedPayload,
  encodeDetachedProgressFrame,
  parseDetachedStdout,
  resolveDetachedRunIdentity,
} from './dispatch-detached.js';

describe('encode/decodeDetachedPayload — 라운드트립(셸 이스케이프 안전)', () => {
  test('objective/target/auto_drive 왕복', () => {
    const args = { objective: 'P→E→R→D로 "X" 만들어줘 · $특수문자 | & ;', target: 'self', auto_drive: 'on', base: 'main' };
    expect(decodeDetachedPayload(encodeDetachedPayload(args))).toEqual(args);
  });
  test('base64라 셸 메타문자 없음', () => {
    const p = encodeDetachedPayload({ objective: "a'b\"c`d", auto_drive: 'on' });
    expect(p).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe('parseDetachedStdout — RESULT/PROGRESS 추출', () => {
  test('RESULT 라인 채택(마지막) + PROGRESS 수집', () => {
    const out = [
      'some boot noise',
      'PROGRESS:[plan] 🧭 계획…',
      'PROGRESS:[execute] 🔨 구현…',
      'RESULT:RunDevHarness 📬 draft PR 개설 — https://pr/1',
    ].join('\n');
    const r = parseDetachedStdout(out);
    expect(r.result).toBe('RunDevHarness 📬 draft PR 개설 — https://pr/1');
    expect(r.progress).toEqual(['[plan] 🧭 계획…', '[execute] 🔨 구현…']);
  });
  test('RESULT 여러 개면 마지막', () => {
    expect(parseDetachedStdout('RESULT:first\nRESULT:last').result).toBe('last');
  });
  test('RESULT 없으면 null', () => {
    expect(parseDetachedStdout('noise\nPROGRESS:x').result).toBeNull();
  });
});

describe('structured detached progress frames', () => {
  test('all required fields, identifiers, and human newline round-trip on one line', () => {
    const frame = { version: 1 as const, kind: 'step' as const, planId: 'plan-literal', stepId: 'step-literal', seq: 7, humanLine: 'first line\nsecond line' } satisfies DetachedProgressFrame;
    const encoded = encodeDetachedProgressFrame(frame);
    expect(encoded).toStartWith(DETACHED_PROGRESS_FRAME_PREFIX);
    expect(encoded).not.toContain('\n');
    expect(decodeDetachedProgressFrame(encoded)).toEqual(frame);
  });

  test('plan declaration may omit stepId', () => {
    const frame = { version: 1 as const, kind: 'plan' as const, planId: 'plan-only', seq: 0 } satisfies DetachedProgressFrame;
    expect(decodeDetachedProgressFrame(encodeDetachedProgressFrame(frame))).toEqual(frame);
    expect(decodeDetachedProgressFrame(encodeDetachedProgressFrame(frame))?.stepId).toBeUndefined();
  });

  test('encoder rejects runtime-invalid frames using the same schema as the decoder', () => {
    const invalidFrames: unknown[] = [
      { version: 1, kind: 'plan', planId: 'p', stepId: 'forbidden', seq: 0 },
      { version: 1, kind: 'step', seq: -1 },
      { version: 1, kind: 'step', seq: 1.5 },
      { version: 1, kind: 'unknown', seq: 0 },
      { version: 2, kind: 'step', seq: 0 },
    ];
    for (const frame of invalidFrames) {
      expect(() => encodeDetachedProgressFrame(frame as DetachedProgressFrame)).toThrow('Invalid detached progress frame');
    }
  });

  test('mixed legacy, structured, result, and noise lines keep all three non-empty collections separated', () => {
    const first = { version: 1 as const, kind: 'plan' as const, planId: 'p1', seq: 0, humanLine: 'plan' } satisfies DetachedProgressFrame;
    const second = { version: 1 as const, kind: 'step' as const, planId: 'p1', stepId: 's2', seq: 2, humanLine: 'step' } satisfies DetachedProgressFrame;
    const parsed = parseDetachedStdout([
      'noise before',
      'PROGRESS:legacy one',
      encodeDetachedProgressFrame(first),
      'PROGRESS:legacy two',
      encodeDetachedProgressFrame(second),
      'RESULT:final output',
      'noise after',
    ].join('\n'));
    expect(parsed.progress).toEqual(['legacy one', 'legacy two']);
    expect(parsed.structuredProgress).toEqual([first, second]);
    expect(parsed.result).toBe('final output');
    expect(parsed.progress).toHaveLength(2);
    expect(parsed.structuredProgress).toHaveLength(2);
    expect(parsed.result).not.toBeNull();
  });

  test('malformed, unknown-version, schema-invalid, plan-step, and illegal-base64 frames are discarded without affecting other lines', () => {
    const valid = encodeDetachedProgressFrame({ version: 1, kind: 'step', planId: 'p', stepId: 's', seq: 1 });
    const validPayload = valid.slice(DETACHED_PROGRESS_FRAME_PREFIX.length);
    const planWithStepId = Buffer.from(JSON.stringify({ version: 1, kind: 'plan', planId: 'p', stepId: 'forbidden', seq: 0 })).toString('base64');
    const parsed = parseDetachedStdout([
      'PROGRESS:still here',
      `${DETACHED_PROGRESS_FRAME_PREFIX}not-base64-json`,
      `${DETACHED_PROGRESS_FRAME_PREFIX}${Buffer.from(JSON.stringify({ version: 2, kind: 'step', seq: 2 })).toString('base64')}`,
      `${DETACHED_PROGRESS_FRAME_PREFIX}${Buffer.from(JSON.stringify({ version: 1, kind: 'step', seq: 'bad' })).toString('base64')}`,
      `${DETACHED_PROGRESS_FRAME_PREFIX}${planWithStepId}`,
      `${DETACHED_PROGRESS_FRAME_PREFIX}${validPayload.slice(0, 4)}!${validPayload.slice(4)}`,
      `${DETACHED_PROGRESS_FRAME_PREFIX}${validPayload}!`,
      valid,
      'RESULT:still final',
    ].join('\n'));
    expect(parsed.progress).toEqual(['still here']);
    expect(parsed.structuredProgress).toHaveLength(1);
    expect(parsed.structuredProgress[0]).toEqual({ version: 1, kind: 'step', planId: 'p', stepId: 's', seq: 1 });
    expect(parsed.result).toBe('still final');
  });
});

describe('resolveDetachedRunIdentity — detached child runId propagation', () => {
  test('부모가 구운 명시 runId가 환경 상속값보다 우선한다', () => {
    expect(resolveDetachedRunIdentity(
      { runId: 'run-parent' },
      { ELANOUS_RUN_ID: 'run-other' },
    )).toEqual({ runId: 'run-parent', source: 'explicit' });
  });

  test('명시 runId가 없으면 환경을 상속하고, 없으면 새로 mint한다', () => {
    expect(resolveDetachedRunIdentity({}, { ELANOUS_RUN_ID: 'run-inherited' }))
      .toEqual({ runId: 'run-inherited', source: 'inherited' });

    const minted = resolveDetachedRunIdentity({}, {});
    expect(minted.source).toBe('minted');
    expect(minted.runId).toMatch(/^run-[A-Za-z0-9-]+$/);
  });

  test('부모가 전달한 runId를 정규화한다', () => {
    expect(resolveDetachedRunIdentity({ runId: '  run/../x  ' }, {}))
      .toEqual({ runId: 'run-x', source: 'explicit' });
  });
});
