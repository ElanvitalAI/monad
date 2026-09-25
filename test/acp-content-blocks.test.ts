// Multimedia → ACP ContentBlock normalization.
//
// Covers the shapes each messenger delivers (Telegram downloaded
// file path, Discord downloaded file from CDN) and asserts they
// land as the right ACP block kind (image base64 vs resource_link
// vs text block), with sane summary strings folded into the
// composite prompt.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  localImageToBlock,
  localAudioToBlock,
  buildTranscribedVoiceBlocks,
  localFileToResourceLink,
  urlToResourceLink,
  textBlock,
  normalizeAttachment,
  buildAcpPrompt,
  attachmentsToNormalized,
  type NormalizedAttachment,
} from '../src/acp/content-blocks.js';
import type { Attachment } from '../src/context.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'acp-blocks-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('localImageToBlock', () => {
  it('base64-encodes a small image + sets mimeType', () => {
    const path = join(tmp, 'pic.png');
    const body = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic
    writeFileSync(path, body);
    const block = localImageToBlock(path);
    expect(block.type).toBe('image');
    if (block.type !== 'image') return;
    expect(block.mimeType).toBe('image/png');
    expect(block.data).toBe(body.toString('base64'));
  });

  it('infers mime from .jpg / .jpeg / .gif / .webp', () => {
    for (const [ext, mt] of [
      ['jpg',  'image/jpeg'],
      ['jpeg', 'image/jpeg'],
      ['gif',  'image/gif'],
      ['webp', 'image/webp'],
    ] as const) {
      const path = join(tmp, `pic.${ext}`);
      writeFileSync(path, Buffer.from([0]));
      const block = localImageToBlock(path);
      if (block.type !== 'image') throw new Error();
      expect(block.mimeType).toBe(mt);
    }
  });

  it('refuses oversize inline (>10 MB) with a clear error', () => {
    const path = join(tmp, 'huge.png');
    writeFileSync(path, Buffer.alloc(11 * 1024 * 1024));
    expect(() => localImageToBlock(path)).toThrow(/exceeds.*inline cap/i);
  });
});

describe('localAudioToBlock (Phase 8)', () => {
  let tmpA: string;
  beforeEach(() => { tmpA = mkdtempSync(join(tmpdir(), 'acp-audio-')); });
  afterEach(() => { rmSync(tmpA, { recursive: true, force: true }); });

  it('reads .ogg + emits ACP audio block with base64 data', () => {
    const path = join(tmpA, 'v.ogg');
    writeFileSync(path, Buffer.from([0x4f, 0x67, 0x67, 0x53])); // OggS magic
    const block = localAudioToBlock(path);
    expect(block.type).toBe('audio');
    const ab = block as { type: string; data: string; mimeType: string };
    expect(ab.data).toBe('T2dnUw==');
    expect(ab.mimeType).toBe('audio/ogg');
  });

  it('explicit mimeType overrides extension inference', () => {
    const path = join(tmpA, 'a.bin');
    writeFileSync(path, Buffer.from([0x01]));
    const block = localAudioToBlock(path, 'audio/opus');
    const ab = block as { type: string; mimeType: string };
    expect(ab.mimeType).toBe('audio/opus');
  });

  it('infers mp3 / wav / m4a / flac from extension', () => {
    for (const [ext, mime] of [
      ['mp3', 'audio/mpeg'],
      ['wav', 'audio/wav'],
      ['m4a', 'audio/mp4'],
      ['flac', 'audio/flac'],
      ['opus', 'audio/opus'],
    ] as const) {
      const path = join(tmpA, `f.${ext}`);
      writeFileSync(path, Buffer.from([0x00]));
      const block = localAudioToBlock(path);
      expect((block as { mimeType: string }).mimeType).toBe(mime);
    }
  });

  it('rejects oversize audio', () => {
    const path = join(tmpA, 'big.ogg');
    writeFileSync(path, Buffer.alloc(11 * 1024 * 1024));
    expect(() => localAudioToBlock(path)).toThrow(/exceeds.*inline cap/i);
  });
});

describe('buildTranscribedVoiceBlocks (Phase 8)', () => {
  let tmpT: string;
  beforeEach(() => { tmpT = mkdtempSync(join(tmpdir(), 'acp-tx-')); });
  afterEach(() => { rmSync(tmpT, { recursive: true, force: true }); });

  it('emits text block first then audio block', () => {
    const path = join(tmpT, 'v.ogg');
    writeFileSync(path, Buffer.from([0x4f, 0x67, 0x67, 0x53]));
    const blocks = buildTranscribedVoiceBlocks({
      localPath: path,
      mimeType: 'audio/ogg',
      transcript: '안녕하세요',
      language: 'ko',
    });
    expect(blocks.length).toBe(2);
    expect(blocks[0]!.type).toBe('text');
    expect((blocks[0] as { text: string }).text).toContain('안녕하세요');
    expect((blocks[0] as { text: string }).text).toContain('(ko)');
    expect(blocks[1]!.type).toBe('audio');
  });

  it('omits transcript block when transcript is empty', () => {
    const path = join(tmpT, 'v.ogg');
    writeFileSync(path, Buffer.from([0x01]));
    const blocks = buildTranscribedVoiceBlocks({
      localPath: path,
      transcript: '',
    });
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.type).toBe('audio');
  });

  it('keeps transcript block when audio file is oversize', () => {
    const path = join(tmpT, 'big.ogg');
    writeFileSync(path, Buffer.alloc(11 * 1024 * 1024));
    const blocks = buildTranscribedVoiceBlocks({
      localPath: path,
      transcript: 'hello',
    });
    // text block kept; audio block dropped on oversize.
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.type).toBe('text');
  });
});

describe('localFileToResourceLink', () => {
  it('builds a file:// URI and uses filename as name by default', () => {
    const block = localFileToResourceLink('/Users/me/report.pdf', {
      mimeType: 'application/pdf', size: 1024,
    });
    expect(block.type).toBe('resource_link');
    if (block.type !== 'resource_link') return;
    expect(block.uri).toBe('file:///Users/me/report.pdf');
    expect(block.name).toBe('report.pdf');
    expect(block.mimeType).toBe('application/pdf');
    expect(block.size).toBe(1024);
  });

  it('prepends a leading slash to a relative path', () => {
    const block = localFileToResourceLink('tmp/note.txt');
    if (block.type !== 'resource_link') return;
    expect(block.uri).toBe('file:///tmp/note.txt');
  });
});

describe('urlToResourceLink', () => {
  it('wraps an http URL with an auto-derived name', () => {
    const block = urlToResourceLink('https://example.com/path/doc.pdf');
    if (block.type !== 'resource_link') return;
    expect(block.uri).toBe('https://example.com/path/doc.pdf');
    expect(block.name).toBe('doc.pdf');
  });
});

describe('normalizeAttachment', () => {
  it('photo → image block + [photo W×H] summary', () => {
    const path = join(tmp, 'p.png');
    writeFileSync(path, Buffer.from([137, 80, 78, 71]));
    const att: NormalizedAttachment = {
      name: 'p.png', localPath: path, kind: 'photo', width: 800, height: 600,
    };
    const norm = normalizeAttachment(att);
    expect(norm.blocks[0]!.type).toBe('image');
    expect(norm.summary).toStartWith('[photo 800×600 · saved: ');
  });

  it('oversize photo degrades to resource_link with error hint', () => {
    const path = join(tmp, 'big.png');
    writeFileSync(path, Buffer.alloc(11 * 1024 * 1024));
    const norm = normalizeAttachment({
      name: 'big.png', localPath: path, kind: 'photo',
    });
    expect(norm.blocks[0]!.type).toBe('resource_link');
    expect(norm.summary).toMatch(/inline failed|exceeds/i);
  });

  it('voice → audio block (Phase 8 — 2026-04-30) + duration summary', () => {
    const path = join(tmp, 'v.ogg');
    writeFileSync(path, Buffer.from([0xff, 0xfe, 0xfd]));
    const norm = normalizeAttachment({
      name: 'v.ogg', localPath: path, kind: 'voice', duration: 12, mimeType: 'audio/ogg',
    });
    expect(norm.blocks[0]!.type).toBe('audio');
    expect(norm.summary).toContain('voice: 12s');
    // base64 of [0xff, 0xfe, 0xfd] = "//79"
    const ab = norm.blocks[0] as { type: string; data: string; mimeType: string };
    expect(ab.data).toBe('//79');
    expect(ab.mimeType).toBe('audio/ogg');
  });

  it('audio kind also emits audio block', () => {
    const path = join(tmp, 'a.mp3');
    writeFileSync(path, Buffer.from([0x49, 0x44, 0x33]));
    const norm = normalizeAttachment({
      name: 'a.mp3', localPath: path, kind: 'audio', duration: 30, mimeType: 'audio/mpeg',
    });
    expect(norm.blocks[0]!.type).toBe('audio');
    expect(norm.summary).toContain('audio: 30s');
  });

  it('oversize voice degrades to resource_link', () => {
    const path = join(tmp, 'big.ogg');
    writeFileSync(path, Buffer.alloc(11 * 1024 * 1024));
    const norm = normalizeAttachment({
      name: 'big.ogg', localPath: path, kind: 'voice', duration: 5, mimeType: 'audio/ogg',
    });
    expect(norm.blocks[0]!.type).toBe('resource_link');
  });

  it('document → resource_link + [document: name] summary', () => {
    const path = join(tmp, 'spec.pdf');
    writeFileSync(path, Buffer.from([0]));
    const norm = normalizeAttachment({
      name: 'spec.pdf', localPath: path, kind: 'document', mimeType: 'application/pdf',
    });
    expect(norm.blocks[0]!.type).toBe('resource_link');
    expect(norm.summary).toStartWith('[document: spec.pdf · saved: ');
  });
});

describe('buildAcpPrompt', () => {
  it('trailing text block contains the prompt + all summaries', () => {
    const path = join(tmp, 'x.png');
    writeFileSync(path, Buffer.from([137, 80, 78, 71]));
    const blocks = buildAcpPrompt('describe this', [
      { name: 'x.png', localPath: path, kind: 'photo', width: 10, height: 20 },
    ]);
    // Order: attachment blocks first, text block last.
    expect(blocks[0]!.type).toBe('image');
    expect(blocks[blocks.length - 1]!.type).toBe('text');
    const textLast = blocks[blocks.length - 1];
    if (textLast?.type !== 'text') throw new Error();
    expect(textLast.text).toContain('describe this');
    expect(textLast.text).toContain('[photo 10×20 · saved: ');
  });

  it('text-only prompt (no attachments) produces a single text block', () => {
    const blocks = buildAcpPrompt('hello');
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.type).toBe('text');
  });

  it('empty attachment array ≡ no attachments', () => {
    const blocks = buildAcpPrompt('hi', []);
    expect(blocks.length).toBe(1);
  });

  it('textBlock helper round-trips', () => {
    const b = textBlock('x');
    expect(b.type).toBe('text');
    if (b.type === 'text') expect(b.text).toBe('x');
  });
});

describe('attachmentsToNormalized', () => {
  function make(over: Partial<Attachment>): Attachment {
    return {
      id: 1,
      kind: 'image',
      token: '[Image #1]',
      sourcePath: '/abs/x.png',
      filename: 'x.png',
      sizeBytes: 100,
      mtime: Date.now(),
      pastedAt: Date.now(),
      loaded: false,
      ...over,
    };
  }

  it('image attachment → photo with mimeType + dimensions', () => {
    const out = attachmentsToNormalized([
      make({ kind: 'image', mediaType: 'image/png', dimensions: { w: 320, h: 240 } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'photo',
      localPath: '/abs/x.png',
      name: 'x.png',
      mimeType: 'image/png',
      width: 320,
      height: 240,
      sizeBytes: 100,
    });
  });

  it('pdf / docx / xlsx → document with mimeType', () => {
    const out = attachmentsToNormalized([
      make({ kind: 'pdf', filename: 'a.pdf', sourcePath: '/abs/a.pdf', mediaType: 'application/pdf' }),
      make({ id: 2, kind: 'docx', filename: 'b.docx', sourcePath: '/abs/b.docx' }),
      make({ id: 3, kind: 'xlsx', filename: 'c.xlsx', sourcePath: '/abs/c.xlsx' }),
    ]);
    expect(out.map((a) => a.kind)).toEqual(['document', 'document', 'document']);
    expect(out[0]?.mimeType).toBe('application/pdf');
    expect(out[1]?.mimeType).toBeUndefined();
  });

  it('text / md → document', () => {
    const out = attachmentsToNormalized([
      make({ kind: 'text', filename: 'n.txt', sourcePath: '/abs/n.txt' }),
      make({ id: 2, kind: 'md', filename: 'r.md', sourcePath: '/abs/r.md' }),
    ]);
    expect(out.map((a) => a.kind)).toEqual(['document', 'document']);
  });

  it('empty input → empty output', () => {
    expect(attachmentsToNormalized([])).toEqual([]);
  });
});
