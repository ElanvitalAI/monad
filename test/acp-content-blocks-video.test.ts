// PR7 (2026-05-14) — ACP video block kind 신설 unit tests.
//
// Schema 정의:
//   - localVideoToBlock(localPath, mimeType?) → { type: 'video', data, mimeType }
//   - MAX_INLINE_VIDEO_BYTES (25MB) cap
//   - inferVideoMime extension switch
//   - acpPromptToLlmContent 의 video case → text placeholder
//
// 본 PR 의 핵심 invariant: video block 이 wire 를 통과해도 server 가
// graceful 하게 placeholder text 로 흡수 (LLM 이 사용자가 video 첨부
// 했음을 메타로 본다). native passthrough 는 향후 별 PR.

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { localVideoToBlock, acpPromptToLlmContent } from '../src/acp/content-blocks.js';

let tmpRoot: string;

function fixtureFile(name: string, bytes: Buffer): string {
  if (!tmpRoot) tmpRoot = mkdtempSync(join(tmpdir(), 'acp-video-'));
  const path = join(tmpRoot, name);
  writeFileSync(path, bytes);
  return path;
}

describe('localVideoToBlock', () => {
  test('packs file bytes into ACP video content block (mp4 inferred)', () => {
    const path = fixtureFile('clip.mp4', Buffer.from([0x00, 0x00, 0x00, 0x18]));
    const block = localVideoToBlock(path) as { type: string; data: string; mimeType: string };
    expect(block.type).toBe('video');
    expect(block.mimeType).toBe('video/mp4');
    expect(block.data).toBe(Buffer.from([0x00, 0x00, 0x00, 0x18]).toString('base64'));
  });

  test('infers mimeType by extension (mov · m4v · webm · mkv)', () => {
    const cases: Array<{ name: string; expected: string }> = [
      { name: 'a.mov', expected: 'video/quicktime' },
      { name: 'b.m4v', expected: 'video/x-m4v' },
      { name: 'c.qt',  expected: 'video/quicktime' },
      { name: 'd.avi', expected: 'video/x-msvideo' },
      { name: 'e.webm', expected: 'video/webm' },
      { name: 'f.mkv', expected: 'video/x-matroska' },
      { name: 'g.unknown', expected: 'video/mp4' }, // default
    ];
    for (const c of cases) {
      const path = fixtureFile(c.name, Buffer.from([0xff]));
      const block = localVideoToBlock(path) as { mimeType: string };
      expect(block.mimeType).toBe(c.expected);
    }
  });

  test('explicit mimeType overrides extension-based inference', () => {
    const path = fixtureFile('weird.bin', Buffer.from([0xab, 0xcd]));
    const block = localVideoToBlock(path, 'video/webm') as { mimeType: string };
    expect(block.mimeType).toBe('video/webm');
  });

  test('throws when file exceeds 25 MB inline cap', () => {
    // 26 MB buffer
    const big = Buffer.alloc(26 * 1024 * 1024, 0xaa);
    const path = fixtureFile('huge.mp4', big);
    expect(() => localVideoToBlock(path)).toThrow(/exceeds.*inline cap/);
  });
});

describe('acpPromptToLlmContent · video case', () => {
  // PR8 (2026-05-14) — video block 이 LLMContentBlock 'video' 로 졸업
  // (이전 PR7 의 text placeholder 패턴 폐기). provider 어댑터 (Gemini ·
  // Anthropic · OpenAI) 가 분기 처리. 본 suite 는 ACP→LLM 변환 invariant
  // 만 유지하고 provider routing 검증은 llm-video-provider-routing.test.ts.

  test('video block (data + mimeType) → LLMContentBlock video', () => {
    const data = Buffer.from('xxxxxxxxxxxxxxxxxxxx', 'utf-8').toString('base64');
    const blocks = [
      { type: 'video', data, mimeType: 'video/mp4' } as const,
    ];
    const result = acpPromptToLlmContent(blocks as unknown as Parameters<typeof acpPromptToLlmContent>[0]);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('video');
    const v = result[0] as { type: 'video'; mediaType: string; base64: string };
    expect(v.mediaType).toBe('video/mp4');
    expect(v.base64).toBe(data);
  });

  test('video block without data still emits placeholder (no crash · no malformed video)', () => {
    const blocks = [
      { type: 'video', mimeType: 'video/webm' } as const,
    ];
    const result = acpPromptToLlmContent(blocks as unknown as Parameters<typeof acpPromptToLlmContent>[0]);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
    const text = (result[0] as { text: string }).text;
    expect(text).toContain('video/webm');
    expect(text).toContain('incomplete');
  });

  test('video block without mimeType + data → safe text placeholder fallback', () => {
    const blocks = [
      { type: 'video' } as const,
    ];
    const result = acpPromptToLlmContent(blocks as unknown as Parameters<typeof acpPromptToLlmContent>[0]);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
    expect((result[0] as { text: string }).text).toContain('video/*');
  });

  test('mixed text + image + video blocks: all preserved as native LLM blocks', () => {
    const blocks = [
      { type: 'text', text: 'describe this clip' },
      { type: 'image', data: 'IMG-BASE64', mimeType: 'image/jpeg' },
      { type: 'video', data: 'VID-BASE64', mimeType: 'video/mp4' },
    ];
    const result = acpPromptToLlmContent(blocks as unknown as Parameters<typeof acpPromptToLlmContent>[0]);
    expect(result.length).toBe(3);
    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('image');
    expect(result[2].type).toBe('video');
    const v = result[2] as { type: 'video'; mediaType: string; base64: string };
    expect(v.mediaType).toBe('video/mp4');
    expect(v.base64).toBe('VID-BASE64');
  });
});

// Cleanup tmp fixtures.
import { afterAll } from 'bun:test';
afterAll(() => {
  try { if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});
