// 롱콘텐츠 spill 단위테스트 — 업로드 주입(S3 무관·순수).
import { describe, test, expect } from 'bun:test';
import { spillLongContent } from './content-spill.js';

describe('spillLongContent', () => {
  test('threshold 이하 → 원문 그대로(spill 안 함)', () => {
    const r = spillLongContent('짧은 메시지', { threshold: 100 });
    expect(r.spilled).toBe(false);
    expect(r.text).toBe('짧은 메시지');
    expect(r.url).toBeUndefined();
  });

  test('threshold 초과 → 미리보기+링크로 대체', () => {
    const long = 'X'.repeat(5000);
    const up = () => 'https://elanvital-public.s3.amazonaws.com/monad/x/spill/abc.txt';
    const r = spillLongContent(long, { threshold: 3500, previewChars: 200, upload: up });
    expect(r.spilled).toBe(true);
    expect(r.url).toContain('spill/abc.txt');
    expect(r.text).toContain('…');
    expect(r.text).toContain('전체 5000자');
    expect(r.text).toContain(r.url!);
    expect(r.text.length).toBeLessThan(long.length); // 짧아짐
  });

  test('업로드 실패(null) → 원문 유지(fail-soft·기존 분할 폴백)', () => {
    const long = 'Y'.repeat(5000);
    const r = spillLongContent(long, { threshold: 3500, upload: () => null });
    expect(r.spilled).toBe(false);
    expect(r.text).toBe(long);
  });

  test('동일 내용 → 동일 키(dedupe·같은 링크)', () => {
    const long = 'Z'.repeat(5000);
    const keys: string[] = [];
    const up = (_t: string, key: string) => { keys.push(key); return `https://x/${key}`; };
    spillLongContent(long, { threshold: 100, upload: up });
    spillLongContent(long, { threshold: 100, upload: up });
    expect(keys[0]).toBe(keys[1]!); // content-hash 키 동일
  });

  test('ext=md → .md 키', () => {
    const keys: string[] = [];
    const up = (_t: string, key: string) => { keys.push(key); return 'https://x'; };
    spillLongContent('M'.repeat(5000), { threshold: 100, ext: 'md', upload: up });
    expect(keys[0]!.endsWith('.md')).toBe(true);
  });
});
