// P1 — URL→skill router. Deterministic pure-function tests.
// PLAN-url-triage-routing-2026-07-22.
import { describe, test, expect } from 'bun:test';
import { detectUrlRoute, classifyUrl, extractUrls, type UrlRoutingConfig } from './url-router.js';

const CFG: UrlRoutingConfig = {
  enabled: true,
  twoStage: true,
  defaultTargets: ['obsidian'],
  guardKeywords: ['참고', '구현', '반박', '비교', 'implement', 'fix'],
  absorbKeywords: ['absorb', '흡수', '지식화'],
  map: { youtube: 'youtube-master', x: 'omni-digest', github: 'omni-digest', web: 'omni-digest' },
  absorbSkill: 'yt-vault',
};

describe('classifyUrl', () => {
  test('youtube variants', () => {
    expect(classifyUrl('https://youtu.be/abc123')).toBe('youtube');
    expect(classifyUrl('https://www.youtube.com/watch?v=x')).toBe('youtube');
    expect(classifyUrl('https://m.youtube.com/shorts/x')).toBe('youtube');
  });
  test('x / twitter', () => {
    expect(classifyUrl('https://x.com/user/status/1')).toBe('x');
    expect(classifyUrl('https://twitter.com/user/status/1')).toBe('x');
  });
  test('github', () => {
    expect(classifyUrl('https://github.com/karpathy/nanochat')).toBe('github');
  });
  test('generic web fallback', () => {
    expect(classifyUrl('https://example.com/article')).toBe('web');
    expect(classifyUrl('not a url')).toBe('web');
  });
});

describe('extractUrls', () => {
  test('dedupes and strips trailing punctuation', () => {
    expect(extractUrls('봐 (https://x.com/a). 그리고 https://x.com/a 또'))
      .toEqual(['https://x.com/a']);
  });
  test('multiple distinct urls in order', () => {
    expect(extractUrls('https://a.com 와 https://b.com'))
      .toEqual(['https://a.com', 'https://b.com']);
  });
});

describe('detectUrlRoute', () => {
  test('bare youtube URL → youtube-master, two-stage, obsidian', () => {
    const d = detectUrlRoute('https://youtu.be/abc', CFG);
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('youtube');
    expect(d!.skill).toBe('youtube-master');
    expect(d!.absorb).toBe(false);
    expect(d!.twoStage).toBe(true);
    expect(d!.targets).toEqual(['obsidian']);
  });

  test('youtube + absorb keyword → yt-vault, single-pass', () => {
    const d = detectUrlRoute('이 영상 흡수해줘 https://youtu.be/abc', CFG);
    expect(d!.skill).toBe('yt-vault');
    expect(d!.absorb).toBe(true);
    expect(d!.twoStage).toBe(false);   // absorb is the detailed endpoint
  });

  test('X URL → omni-digest', () => {
    const d = detectUrlRoute('https://x.com/u/status/1', CFG);
    expect(d!.kind).toBe('x');
    expect(d!.skill).toBe('omni-digest');
  });

  test('github URL → omni-digest', () => {
    const d = detectUrlRoute('https://github.com/a/b', CFG);
    expect(d!.skill).toBe('omni-digest');
  });

  test('guard keyword suppresses auto-fire (R5/R8) — code reference', () => {
    expect(detectUrlRoute('이 코드 참고해서 구현해줘 https://github.com/a/b', CFG)).toBeNull();
  });

  test('guard keyword suppresses — argumentative intent', () => {
    expect(detectUrlRoute('이거 요약 말고 반박해봐 https://example.com/x', CFG)).toBeNull();
  });

  test('no URL → null', () => {
    expect(detectUrlRoute('그냥 대화입니다', CFG)).toBeNull();
  });

  test('disabled → null', () => {
    expect(detectUrlRoute('https://youtu.be/abc', { ...CFG, enabled: false })).toBeNull();
  });

  test('absorb keyword only applies to youtube (x+흡수 still omni-digest)', () => {
    const d = detectUrlRoute('이 글 흡수 https://x.com/u/status/1', CFG);
    expect(d!.skill).toBe('omni-digest');
    expect(d!.absorb).toBe(false);
  });

  test('twoStage=false config → summary path single-pass', () => {
    const d = detectUrlRoute('https://youtu.be/abc', { ...CFG, twoStage: false });
    expect(d!.twoStage).toBe(false);
  });
});
