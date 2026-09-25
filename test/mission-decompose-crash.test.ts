import { describe, expect, test } from 'bun:test';
import { buildDecomposeCrashRecord, type DecomposeCrashContext } from '../src/autopilot/mission-engine.js';
import { DecomposeError } from '../src/task-orchestrator/generator.js';

// §5.3 재분해 크래시 근본조사 — 기존 catch 는 e.message.slice(120)만 남겨 "빈 응답이었나
// 스키마 위반이었나"를 규명 못했다. buildDecomposeCrashRecord 가 rawText/validationErrors/
// code 를 통째로 보존함을 고정한다. 이 캡처가 다음 크래시 1회 진단의 전제.

const CTX: DecomposeCrashContext = {
  model: 'gpt-5.6-sol', effort: 'high', objectiveChars: 4200,
  groundingChars: 2500, researchChars: 0, reviseChars: 300, maxTasks: 8,
};
const NOW = '2026-07-13T00:00:00.000Z';

describe('decompose crash diagnostics', () => {
  test('빈 응답(rawText="") → rawTextChars=0 신호 + 컨텍스트 보존', () => {
    // 토큰/스트리밍 소진으로 LLM 이 빈 응답 → 파싱 실패 → 재시도 → VALIDATION_FAILED.
    const err = new DecomposeError('VALIDATION_FAILED', 'schema violation after 1 retry',
      [{ code: 'NOT_OBJECT', message: 'JSON parse failed' }], '');
    const rec = buildDecomposeCrashRecord('apm_x', err, CTX, NOW);

    expect(rec.rawTextChars).toBe(0);                 // ← 빈 응답 신호(토큰 소진)
    expect(rec.code).toBe('VALIDATION_FAILED');
    expect(rec.errorName).toBe('DecomposeError');
    expect(rec.validationErrors).toBeTruthy();
    expect(rec.model).toBe('gpt-5.6-sol');
    expect(rec.groundingChars).toBe(2500);
    expect(rec.ts).toBe(NOW);
    expect(rec.missionId).toBe('apm_x');
  });

  test('스키마 위반(rawText 있음 + validationErrors) → rawTextChars>0 로 구분', () => {
    const raw = '{ "tasks": [ { "title": "x" } ] }'; // 형식은 JSON 이나 스키마 위반
    const err = new DecomposeError('VALIDATION_FAILED', 'schema violation after 1 retry',
      [{ code: 'TASK_SHAPE', message: 'task 0 missing required fields' }], raw);
    const rec = buildDecomposeCrashRecord('apm_y', err, CTX, NOW);

    expect(rec.rawTextChars).toBe(raw.length);        // ← >0: 빈 응답 아님, 스키마 문제
    expect(rec.rawTextHead).toContain('tasks');
    expect(rec.validationErrors).toBeTruthy();
  });

  test('rawText 는 1500자로 절단(로그 폭주 방지)', () => {
    const big = 'a'.repeat(5000);
    const err = new DecomposeError('VALIDATION_FAILED', 'x', undefined, big);
    const rec = buildDecomposeCrashRecord('apm_z', err, CTX, NOW);

    expect(rec.rawTextChars).toBe(5000);              // 원본 길이는 보존
    expect(rec.rawTextHead?.length).toBe(1500);       // 저장본은 절단
  });

  test('비-Error throw(문자열) → graceful, rawText 없으면 null', () => {
    const rec = buildDecomposeCrashRecord('apm_s', 'boom', CTX, NOW);

    expect(rec.errorName).toBe('string');
    expect(rec.code).toBeNull();
    expect(rec.message).toBe('boom');
    expect(rec.rawTextChars).toBeNull();              // rawText 부재 → null(빈응답 0 과 구분)
    expect(rec.stack).toBeNull();
  });
});
