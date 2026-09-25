// grounded no-op 검증 — 이미 충족 시 PASS·미충족/오류 시 보수적 FAIL (2026-07-14).
import { test, expect, describe } from 'bun:test';
import { verifyPhaseAlreadySatisfied, parseNoopVerdict } from './mission-se-noop-verify.js';

const grounded = async () => ({ grounded: true, context: 'doc-curation.ts', files: ['src/autopilot/discovery/doc-curation.ts'] });
const readStub = () => 'const idempotencyKey = hashContent(...); if (existingIdempotencyKeys.has(key)) return { suppressed: true };';

describe('parseNoopVerdict', () => {
  test('satisfied JSON', () => {
    const v = parseNoopVerdict('판정: {"satisfied":true,"evidence":"doc-curation.ts:174","missing":""}');
    expect(v.satisfied).toBe(true);
    expect(v.evidence).toContain('doc-curation.ts:174');
  });
  test('not satisfied JSON', () => {
    const v = parseNoopVerdict('{"satisfied":false,"evidence":"","missing":"스냅샷 가드 없음"}');
    expect(v.satisfied).toBe(false);
    expect(v.missing).toContain('스냅샷');
  });
  test('파싱 실패 → 보수적 미충족(false-PASS 금지)', () => {
    expect(parseNoopVerdict('완전 헛소리 출력').satisfied).toBe(false);
    expect(parseNoopVerdict('').satisfied).toBe(false);
  });
  test('satisfied 아닌데 true 로 위장 못 함 — satisfied 는 정확히 true 만', () => {
    expect(parseNoopVerdict('{"satisfied":"yes"}').satisfied).toBe(false);
    expect(parseNoopVerdict('{"satisfied":1}').satisfied).toBe(false);
  });
});

describe('verifyPhaseAlreadySatisfied', () => {
  test('LLM 이 satisfied → 근거와 함께 충족 판정', async () => {
    const v = await verifyPhaseAlreadySatisfied('멱등 proposal 억제 배선', ['재실행 시 새 proposal 없음'], {
      ground: grounded, readFiles: readStub,
      classify: async () => '{"satisfied":true,"evidence":"doc-curation.ts:174 idempotencyKey+suppressed","missing":""}',
    });
    expect(v.satisfied).toBe(true);
    expect(v.evidence).toContain('174');
  });

  test('Kotlin과 Swift 구현 파일은 injected grounding에서 실제 근거로 인정한다', async () => {
    for (const file of [
      'apps/android/app/src/main/kotlin/com/monad/Main.kt',
      'apps/ios/MonadiOSKit/Sources/Monad/App.swift',
    ]) {
      const v = await verifyPhaseAlreadySatisfied('구현 확인', [], {
        ground: async () => ({ grounded: true, context: file, files: [file] }),
        readFiles: readStub,
        classify: async () => '{"satisfied":true,"evidence":"implementation","missing":""}',
      });
      expect(v.grounded).toBe(true);
    }
  });

  test('Kotlin과 Swift 시험 경로는 injected grounding의 실제 근거에서 배제한다', async () => {
    for (const file of [
      'apps/android/app/src/test/kotlin/com/monad/MainTest.kt',
      'apps/android/app/src/main/kotlin/com/monad/MainTest.kt',
      'apps/ios/MonadiOSKitTests/AppTests.swift',
    ]) {
      const v = await verifyPhaseAlreadySatisfied('시험 파일 제외', [], {
        ground: async () => ({ grounded: true, context: file, files: [file] }),
        readFiles: readStub,
        classify: async () => '{"satisfied":true,"evidence":"test","missing":""}',
      });
      expect(v.grounded).toBe(false);
    }
  });

  test('LLM 이 미충족 → false + missing', async () => {
    const v = await verifyPhaseAlreadySatisfied('스냅샷 가드 추가', ['update 전 스냅샷'], {
      ground: grounded, readFiles: readStub,
      classify: async () => '{"satisfied":false,"evidence":"","missing":"스냅샷 로직 부재"}',
    });
    expect(v.satisfied).toBe(false);
    expect(v.missing).toContain('스냅샷');
  });

  test('grounding 실패 → 보수적 미충족(자동 확증 불가)', async () => {
    const v = await verifyPhaseAlreadySatisfied('무언가', [], {
      ground: async () => ({ grounded: false, context: '', files: [] }),
      classify: async () => '{"satisfied":true}',  // 코드 없이 true 라 해도 무시
    });
    expect(v.satisfied).toBe(false);
  });

  test('LLM 오류 → fail-soft 보수적 미충족(false-PASS 금지)', async () => {
    const v = await verifyPhaseAlreadySatisfied('무언가', [], {
      ground: grounded, readFiles: readStub,
      classify: async () => { throw new Error('LLM down'); },
    });
    expect(v.satisfied).toBe(false);
  });
});
