// P4 — URL route stage composition (plan builder). Pure, no execution.
import { describe, test, expect } from 'bun:test';
import { urlStagePlan, isShareablePublicUrl, appendPublicShareLink } from './url-route-exec.js';
import type { UrlRouteDecision } from './url-router.js';

function dec(over: Partial<UrlRouteDecision>): UrlRouteDecision {
  return {
    url: 'https://youtu.be/x', urls: ['https://youtu.be/x'],
    kind: 'youtube', skill: 'youtube-master', absorb: false,
    twoStage: true, targets: ['obsidian'], reason: 't', ...over,
  };
}

describe('urlStagePlan', () => {
  test('two-stage summary → quick then detailed, detailed saves', () => {
    const plan = urlStagePlan(dec({ twoStage: true }));
    expect(plan.map(p => p.kind)).toEqual(['quick', 'detailed']);
    expect(plan[0]!.args).toContain('짧게');
    expect(plan[0]!.args).toContain('저장은 하지 마');
    expect(plan[1]!.args).toContain('상세');
    expect(plan[1]!.args).toContain('옵시디언에 저장');
  });

  test('single-stage summary (twoStage=false) → one summary run that saves', () => {
    const plan = urlStagePlan(dec({ twoStage: false }));
    expect(plan.map(p => p.kind)).toEqual(['summary']);
    expect(plan[0]!.args).toContain('옵시디언에 저장');
  });

  test('absorb → single-pass absorb run', () => {
    const plan = urlStagePlan(dec({ absorb: true, twoStage: false, skill: 'yt-vault' }));
    expect(plan.map(p => p.kind)).toEqual(['absorb']);
    expect(plan[0]!.args).toContain('흡수');
  });

  test('URL leads every stage arg so skill URL-detection fires', () => {
    for (const stage of urlStagePlan(dec({ twoStage: true }))) {
      expect(stage.args.startsWith('https://youtu.be/x')).toBe(true);
    }
  });

  test('non-obsidian targets reflected in save clause', () => {
    const plan = urlStagePlan(dec({ twoStage: false, targets: ['markdown'] }));
    expect(plan[0]!.args).toContain('markdown로 저장');
  });
});

// E2 — 게시 공개 링크 (public URL) 붙이기 · 보안 · fail-soft
describe('isShareablePublicUrl', () => {
  test('공개 https URL 통과', () => {
    expect(isShareablePublicUrl('https://elanvital-public.s3.amazonaws.com/monad/publish/x.html')).toBe(true);
  });
  test('내부 서빙 /d/:id 경로 거부', () => {
    expect(isShareablePublicUrl('https://foo.ts.net/d/abc')).toBe(false);
  });
  test('localhost 거부', () => {
    expect(isShareablePublicUrl('http://localhost:8787/d/abc')).toBe(false);
  });
  test('사설/링크로컬 IP 거부', () => {
    expect(isShareablePublicUrl('http://192.168.0.5/x')).toBe(false);
    expect(isShareablePublicUrl('http://10.0.0.1/x')).toBe(false);
    expect(isShareablePublicUrl('http://172.16.0.1/x')).toBe(false);
    expect(isShareablePublicUrl('http://169.254.1.1/x')).toBe(false);
  });
  test('빈값/비URL 거부', () => {
    expect(isShareablePublicUrl(null)).toBe(false);
    expect(isShareablePublicUrl(undefined)).toBe(false);
    expect(isShareablePublicUrl('')).toBe(false);
    expect(isShareablePublicUrl('not a url')).toBe(false);
  });
});

describe('appendPublicShareLink', () => {
  const base = '📄 상세 분석 저장됨\n/vault/note.md';
  const okUrl = 'https://elanvital-public.s3.amazonaws.com/monad/publish/x.html';

  test('게시 성공 → 공개 링크 덧붙임(원본 보존)', () => {
    const r = appendPublicShareLink(base, '/vault/note.md', {
      publish: () => okUrl,
      readMarkdown: () => '# note',
    });
    expect(r.publicUrl).toBe(okUrl);
    expect(r.curated.startsWith(base)).toBe(true);
    expect(r.curated).toContain(`🌐 공개 링크: ${okUrl}`);
  });

  test('obsidianPath 없음 → 원본 그대로(fail-soft)', () => {
    const r = appendPublicShareLink(base, undefined, { publish: () => okUrl, readMarkdown: () => 'x' });
    expect(r.curated).toBe(base);
    expect(r.publicUrl).toBeUndefined();
  });

  test('파일 읽기 실패 → 원본 그대로(fail-soft)', () => {
    const r = appendPublicShareLink(base, '/vault/note.md', { publish: () => okUrl, readMarkdown: () => null });
    expect(r.curated).toBe(base);
    expect(r.publicUrl).toBeUndefined();
  });

  test('게시 실패(null) → 원본 그대로(fail-soft)', () => {
    const r = appendPublicShareLink(base, '/vault/note.md', { publish: () => null, readMarkdown: () => '# n' });
    expect(r.curated).toBe(base);
    expect(r.publicUrl).toBeUndefined();
  });

  test('제어면 URL(localhost /d) → 노출 안 함(보안)', () => {
    const r = appendPublicShareLink(base, '/vault/note.md', {
      publish: () => 'http://localhost:8787/d/abc',
      readMarkdown: () => '# n',
    });
    expect(r.curated).toBe(base);
    expect(r.publicUrl).toBeUndefined();
  });
});
