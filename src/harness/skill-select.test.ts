// selectHarnessSkill — S1 luna 주경로 skill 선택(luna 우선·substring fallback·allowlist·fail-soft) 테스트

import { describe, test, expect } from 'bun:test';
import { selectHarnessSkill } from './skill-select.js';
import type { SkillIndexEntry } from '../skills/index.js';

function entry(over: Partial<SkillIndexEntry>): SkillIndexEntry {
  return { name: 'x', description: 'd', triggers: [], extractedTriggers: [], autoTrigger: false, category: 'c', skillDir: '/x', ...over } as SkillIndexEntry;
}

// omni-market = allowlist / stochastic-multi-agent-consensus = allowlist 밖(에이전트 배치).
const index = [
  entry({ name: 'omni-market', description: '금융 데이터 조회', triggers: ['주가', 'stock', 'price'] }),
  entry({ name: 'omni-digest', description: 'URL 요약', triggers: ['요약', 'digest', 'summarize'] }),
  entry({ name: 'stochastic-multi-agent-consensus', description: 'N 에이전트', triggers: ['consensus', 'poll agents'] }),
];

describe('selectHarnessSkill', () => {
  test('luna 가 allowlist skill 픽 → 격리 실행(source=luna·picked carry)', async () => {
    let called = '';
    const r = await selectHarnessSkill('삼성전자 주가 흐름 알려줘', {
      index,
      pickSkills: async () => ['omni-market', 'omni-digest'],   // luna 의미매칭(오타/한글 견고)
      invoke: async (_obj, skill) => { called = skill; return { ok: true, output: '주가 데이터' }; },
    });
    expect(r).toEqual({ skill: 'omni-market', output: '주가 데이터', source: 'luna', picked: ['omni-market', 'omni-digest'] });
    expect(called).toBe('omni-market');
  });

  test('luna 픽이 allowlist 밖뿐 → substring fallback 시도', async () => {
    let subCalled = false;
    const r = await selectHarnessSkill('요약하고 digest 로 정리', {
      index,
      pickSkills: async () => ['stochastic-multi-agent-consensus'],   // luna 픽이 실행 불가 allowlist 밖
      invoke: async () => ({ ok: true, output: '요약 결과' }),
      execFallback: async () => { subCalled = true; return { skill: 'omni-digest', output: '요약 결과' }; },
    });
    expect(r?.source).toBe('substring');
    expect(r?.skill).toBe('omni-digest');
    expect(subCalled).toBe(true);
  });

  test('luna 실패(null) → substring fallback', async () => {
    const r = await selectHarnessSkill('요약하고 digest', {
      index,
      pickSkills: async () => null,   // luna 실패
      invoke: async () => ({ ok: true, output: '요약' }),
      execFallback: async () => ({ skill: 'omni-digest', output: '요약' }),
    });
    expect(r?.source).toBe('substring');
  });

  test('luna 실행 빈 출력 → substring fallback 로 이월', async () => {
    const r = await selectHarnessSkill('삼성전자 주가', {
      index,
      pickSkills: async () => ['omni-market'],
      invoke: async () => ({ ok: true, output: '   ' }),   // 빈 출력
      execFallback: async () => ({ skill: 'omni-digest', output: '대체' }),
    });
    // luna 실행이 빈 출력이면 fallback 로 넘어가 substring 결과. picked 는 luna 픽 보존.
    expect(r?.source).toBe('substring');
    expect(r?.picked).toEqual(['omni-market']);
  });

  test('luna·substring 둘 다 무결과 → null', async () => {
    const r = await selectHarnessSkill('그냥 대화', {
      index,
      pickSkills: async () => [],   // 관련없음
      execFallback: async () => null,
    });
    expect(r).toBeNull();
  });

  test('luna throw → fail-soft substring fallback', async () => {
    const r = await selectHarnessSkill('요약 digest', {
      index,
      pickSkills: async () => { throw new Error('luna down'); },
      execFallback: async () => ({ skill: 'omni-digest', output: 'ok' }),
    });
    expect(r?.source).toBe('substring');
  });

  test('빈 objective / 빈 index → null(실행 안 함)', async () => {
    expect(await selectHarnessSkill('   ', { index })).toBeNull();
    expect(await selectHarnessSkill('주가', { index: [] })).toBeNull();
  });
});
