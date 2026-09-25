// ── system-lookback 단위테스트 — R3 소스 룩백(순수) ──
import { describe, it, expect } from 'bun:test';
import { suspectSourceFiles, buildLookbackPrompt } from './system-lookback.js';
import type { ContradictionSignal, ContradictionKind } from './contradiction-detector.js';

const sig = (kind: ContradictionKind, detail = 'd'): ContradictionSignal => ({ kind, systemSuspect: true, detail });

describe('system-lookback — R3 소스 룩백', () => {
  it('files-touched-but-empty-diff → diff 캡처·worktree base·페이즈 순회 의심', () => {
    const f = suspectSourceFiles([sig('files-touched-but-empty-diff')]);
    expect(f).toContain('src/autopilot/build/nocturnal-deps.ts');
    expect(f).toContain('src/autopilot/build/isolated-instance.ts');
    expect(f).toContain('scripts/run-mission.ts');
  });

  it('여러 모순 → 의심 소스 합집합·중복 제거', () => {
    const f = suspectSourceFiles([sig('files-touched-but-empty-diff'), sig('diff-body-absent')]);
    expect(f.filter((x) => x === 'src/autopilot/build/nocturnal-deps.ts').length).toBe(1);
  });

  it('빈 신호 → 빈 목록', () => {
    expect(suspectSourceFiles([])).toEqual([]);
  });

  it('buildLookbackPrompt — READ-ONLY·모순·소스 발췌·지시 포함', () => {
    const p = buildLookbackPrompt({
      phaseTitle: '시세 루프 구현',
      signals: [sig('diff-body-absent', '본문 미전달')],
      sourceExcerpts: [{ file: 'nocturnal-deps.ts', content: 'const diff = git diff HEAD' }],
    });
    expect(p).toContain('READ-ONLY');
    expect(p).toContain('diff-body-absent');
    expect(p).toContain('nocturnal-deps.ts');
    expect(p).toContain('수정 후보');
    expect(p).toContain('소스 자체를 의심');
  });
});
