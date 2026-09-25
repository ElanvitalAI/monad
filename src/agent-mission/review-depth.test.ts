// 2계층 리뷰 무게 판정 테스트 — light(1차 충분)/heavy(2차 심판 머스트) 경계.
import { describe, test, expect } from 'bun:test';
import { assessReviewDepth, parseReviewDepthFromFilesJson, DEFAULT_CORE_PATHS } from './review-depth.js';

describe('assessReviewDepth', () => {
  test('소작업(테스트 1파일·소량) → light', () => {
    const r = assessReviewDepth({ changedFiles: ['src/util/format.test.ts'], additions: 30, deletions: 2 });
    expect(r.depth).toBe('light');
    expect(r.reasons).toEqual([]);
  });

  test('파일 수 초과(>5) → heavy', () => {
    const files = Array.from({ length: 6 }, (_, i) => `src/util/f${i}.ts`);
    const r = assessReviewDepth({ changedFiles: files, additions: 10, deletions: 0 });
    expect(r.depth).toBe('heavy');
    expect(r.reasons.some((x) => x.includes('파일'))).toBe(true);
  });

  test('diff 라인 초과(>200) → heavy', () => {
    const r = assessReviewDepth({ changedFiles: ['src/util/x.ts'], additions: 180, deletions: 40 });
    expect(r.depth).toBe('heavy');
    expect(r.reasons.some((x) => x.includes('줄'))).toBe(true);
  });

  test('핵심 경로(orchestrator·index) 변경 → heavy (소량이어도)', () => {
    const r = assessReviewDepth({ changedFiles: ['src/task-orchestrator/types.ts'], additions: 3, deletions: 1 });
    expect(r.depth).toBe('heavy');
    expect(r.reasons.some((x) => x.includes('핵심 경로'))).toBe(true);
  });

  test('변경 파일 미상(빈 배열) → 보수적 heavy', () => {
    const r = assessReviewDepth({ changedFiles: [], additions: 0, deletions: 0 });
    expect(r.depth).toBe('heavy');
  });

  test('config override — maxLightFiles 완화 시 light', () => {
    const files = Array.from({ length: 6 }, (_, i) => `src/util/f${i}.ts`);
    const r = assessReviewDepth({ changedFiles: files, additions: 10, deletions: 0 }, { maxLightFiles: 10 });
    expect(r.depth).toBe('light');
  });

  test('config override — corePaths 축소 시 코어 아닌 것으로 처리', () => {
    const r = assessReviewDepth({ changedFiles: ['src/task-orchestrator/types.ts'], additions: 3, deletions: 1 }, { corePaths: ['src/boot/'] });
    expect(r.depth).toBe('light'); // task-orchestrator 가 코어 목록서 빠짐
  });

  test('계획문서(PLAN/RFC/ROADMAP/마일스톤) 변경 → heavy (소량·코드 아니어도·방향 결정)', () => {
    for (const f of ['docs/plans/PLAN-foo-2026.md', 'docs/RFC-bar.md', 'docs/ROADMAP-x.md', 'MILESTONE-y.md', 'docs/rfcs/DESIGN-z.md']) {
      const r = assessReviewDepth({ changedFiles: [f], additions: 5, deletions: 0 });
      expect(r.depth).toBe('heavy');
      expect(r.reasons.some((x) => x.includes('계획문서'))).toBe(true);
    }
  });

  test('일반 문서(계획문서 아님) → light', () => {
    const r = assessReviewDepth({ changedFiles: ['docs/notes/memo.md', 'README.md'], additions: 5, deletions: 0 });
    expect(r.depth).toBe('light');
  });

  test('config planDocPatterns override', () => {
    const r = assessReviewDepth({ changedFiles: ['docs/spec/SPEC-a.md'], additions: 3, deletions: 0 }, { planDocPatterns: ['SPEC-'] });
    expect(r.depth).toBe('heavy');
  });
});

describe('parseReviewDepthFromFilesJson', () => {
  test('gh files json → 파일·add/del 집계', () => {
    const j = JSON.stringify({ files: [{ path: 'a.ts', additions: 10, deletions: 2 }, { path: 'b.ts', additions: 5, deletions: 0 }] });
    const r = parseReviewDepthFromFilesJson(j);
    expect(r.changedFiles).toEqual(['a.ts', 'b.ts']);
    expect(r.additions).toBe(15);
    expect(r.deletions).toBe(2);
  });
  test('파싱 실패 → 빈(미상)', () => {
    expect(parseReviewDepthFromFilesJson('nope').changedFiles).toEqual([]);
  });
});

describe('DEFAULT_CORE_PATHS', () => {
  test('시스템 코어 경로 포함', () => {
    expect(DEFAULT_CORE_PATHS).toContain('src/agent-mission/');
    expect(DEFAULT_CORE_PATHS).toContain('src/index.ts');
  });
});
