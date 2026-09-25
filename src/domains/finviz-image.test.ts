import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { captureFinvizMapImageUrl } from './finviz-image.js';

describe('captureFinvizMapImageUrl', () => {
  test('키 없음 → null(스킵)', async () => {
    expect(await captureFinvizMapImageUrl(undefined)).toBeNull();
    expect(await captureFinvizMapImageUrl('   ')).toBeNull();
  });

  test('fetcher 성공 → PNG URL', async () => {
    const url = await captureFinvizMapImageUrl('key', async (k, u) => {
      expect(k).toBe('key');
      expect(u).toContain('finviz.com/map');
      return 'https://storage.googleapis.com/firecrawl/shot.png';
    });
    expect(url).toContain('shot.png');
  });

  test('fetcher 실패(throw/null) → null(fail-soft)', async () => {
    expect(await captureFinvizMapImageUrl('key', async () => { throw new Error('firecrawl down'); })).toBeNull();
    expect(await captureFinvizMapImageUrl('key', async () => null)).toBeNull();
  });

  // 회귀 가드(2026-07-09) — firecrawl v2 기본 2일 캐시로 stale 히트맵 발송된 사건.
  // 기본 fetcher가 반드시 maxAge:0(캐시 무시·fresh)로 호출해야 함.
  test('기본 firecrawl 스크립트가 maxAge:0으로 캐시 무시', () => {
    const src = readFileSync(new URL('./finviz-image.ts', import.meta.url), 'utf-8');
    expect(src).toContain('maxAge: 0');
    expect(src).toMatch(/formats:\s*\['screenshot'\][\s\S]*maxAge:\s*0/);
  });
});
