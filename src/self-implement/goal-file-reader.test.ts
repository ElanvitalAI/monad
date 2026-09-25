import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { anchoredResolve } from '../boot/daemon-tools/path-guard.js';
import { createRepositoryReferencedFileReader } from './goal-file-reader.js';

const temporaryDirectories: string[] = [];

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'goal-file-reader-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('createRepositoryReferencedFileReader', () => {
  test('classifies actual repository reads, missing files, read failures, lexical escapes, and symlink escapes', () => {
    const root = fixtureRoot();
    const outside = mkdtempSync(join(tmpdir(), 'goal-file-reader-outside-'));
    temporaryDirectories.push(outside);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'present.ts'), 'present');
    writeFileSync(join(root, 'src', 'bom.ts'), Buffer.from([0xef, 0xbb, 0xbf, 0x70, 0x72, 0x65, 0x73, 0x65, 0x6e, 0x74]));
    writeFileSync(join(root, 'src', 'binary.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a]));
    writeFileSync(join(root, 'src', 'nul.dat'), 'text\0after');
    mkdirSync(join(root, 'src', 'directory.ts'));
    writeFileSync(join(outside, 'outside.ts'), 'outside');
    symlinkSync(join(outside, 'outside.ts'), join(root, 'src', 'outside-link.ts'));
    symlinkSync('resolution-loop.ts', join(root, 'src', 'resolution-loop.ts'));
    const reader = createRepositoryReferencedFileReader(root);

    expect(reader('src/present.ts')).toEqual({ kind: 'ok', contents: 'present' });
    expect(reader('src/bom.ts')).toEqual({ kind: 'ok', contents: '\uFEFFpresent' });
    expect(reader('src/binary.png')).toEqual({ kind: 'not-text' });
    expect(reader('src/nul.dat')).toEqual({ kind: 'not-text' });
    expect(reader('src/missing.ts')).toEqual({ kind: 'missing' });
    expect(reader('src/directory.ts')).toEqual({ kind: 'directory' });
    // ⛔ 부재의 두 번째 코드 — 중간 성분이 파일이면 ENOTDIR 이고, 그것도 "없는 경로" 다(리뷰 must-fix).
    expect(reader('src/present.ts/nested.ts')).toEqual({ kind: 'missing' });
    // `anchoredResolve` 는 **탈출에만** 던진다 — ELOOP 같은 해석 실패는 어휘 경로를 그대로 돌려주고
    //   분류는 아래 read 가 한다. 그래서 이 헬퍼의 전역 계약을 바꾸지 않아도 셋이 갈린다.
    expect(() => anchoredResolve('src/resolution-loop.ts', root)).not.toThrow();
    expect(reader('src/resolution-loop.ts')).toEqual({ kind: 'read-error' });
    expect(reader('../escape.ts')).toEqual({ kind: 'outside-repository' });
    expect(reader('src/outside-link.ts')).toEqual({ kind: 'outside-repository' });
  });
});

// ─── P4b 멀티미디어 리뷰 — 이미지는 «실패가 아니다» (2026-08-07) ──────────────
//
// ⛔ 종전엔 리뷰 컨텍스트로 이미지를 주면 `not-text` 로 거절됐고, 그 거절이
//   「백엔드가 이미지를 못 받는다」로 오래 읽혔다. 실측은 반대였다 —
//   claude ⊕ codex-app-server 둘 다 `image: true` 를 광고한다(#7480 이후 값으로 확인).
describe('createRepositoryReferencedFileReader — 이미지 참조(P4b)', () => {
  const pngBytes = (): Buffer => {
    const zlib = require('node:zlib') as typeof import('node:zlib');
    const chunk = (type: string, data: Buffer): Buffer => {
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : 0);
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  };

  test('PNG 는 image 로 읽히고 base64 가 실린다 (not-text 아님)', () => {
    const root = mkdtempSync(join(tmpdir(), 'monad-goal-reader-img-'));
    try {
      writeFileSync(join(root, 'shot.png'), pngBytes());
      const result = createRepositoryReferencedFileReader(root)('shot.png');
      expect(result.kind).toBe('image');
      if (result.kind !== 'image') throw new Error('unreachable');
      expect(result.mimeType).toBe('image/png');
      // ⭐ 판별력 — base64 가 «실제로» 실렸는지 본다. 이 단언이 없으면 kind 만 바꾸고 빈 데이터를
      //   보내도 통과한다(오늘 배운 형태: 테스트가 「무는 척」만 한다).
      expect(Buffer.from(result.data, 'base64').subarray(0, 8))
        .toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('⛔ 확장자를 안 믿는다 — .png 인데 텍스트면 ok, 확장자 없어도 진짜 PNG 면 image', () => {
    const root = mkdtempSync(join(tmpdir(), 'monad-goal-reader-sniff-'));
    try {
      writeFileSync(join(root, 'liar.png'), 'not really an image\n');
      expect(createRepositoryReferencedFileReader(root)('liar.png').kind).toBe('ok');
      writeFileSync(join(root, 'noext'), pngBytes());
      expect(createRepositoryReferencedFileReader(root)('noext').kind).toBe('image');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('⛔ 10MB 를 넘는 이미지는 안 싣는다 — base64 로 부풀어 wire 로 나간다', () => {
    const root = mkdtempSync(join(tmpdir(), 'monad-goal-reader-big-'));
    try {
      // PNG 헤더 ⊕ 상한 초과 몸통. sniff 는 통과하고 «크기»에서만 걸려야 한다.
      const big = Buffer.concat([pngBytes(), Buffer.alloc(10 * 1024 * 1024 + 1, 0x41)]);
      writeFileSync(join(root, 'huge.png'), big);
      expect(createRepositoryReferencedFileReader(root)('huge.png').kind).toBe('not-text');
      // ⛔⭐ 회귀 방어 — 상한은 «이미지에만» 건다. 큰 «텍스트»(authored goal 문서 등)는 여전히 읽힌다.
      //   내가 한 번 모든 큰 파일을 not-text 로 접어 이 리더의 공유 소비자를 깨뜨렸다(#7486 재리뷰).
      writeFileSync(join(root, 'huge.md'), 'x'.repeat(10 * 1024 * 1024 + 2));
      expect(createRepositoryReferencedFileReader(root)('huge.md').kind).toBe('ok');
      // ⭐ 판별력 — 상한 «바로 아래»는 여전히 image 다(상한을 0 으로 바꾸면 이 줄이 실패한다).
      writeFileSync(join(root, 'ok.png'), pngBytes());
      expect(createRepositoryReferencedFileReader(root)('ok.png').kind).toBe('image');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ⭐ 선언한 넷을 «전부» 문다 — PNG 만 시험하면 나머지 셋은 「적어 놓기만 한 지원」이다(#7486 should-fix).
  test('JPEG·GIF·WebP 도 각각 제 mime 으로 분류된다', () => {
    const root = mkdtempSync(join(tmpdir(), 'monad-goal-reader-mimes-'));
    try {
      const cases: Array<[string, Buffer, string]> = [
        ['a.jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 0)]), 'image/jpeg'],
        ['a.gif', Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(16, 0)]), 'image/gif'],
        ['a.webp', Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4, 0), Buffer.from('WEBP', 'ascii'), Buffer.alloc(16, 0)]), 'image/webp'],
      ];
      for (const [name, bytes, mime] of cases) {
        writeFileSync(join(root, name), bytes);
        const result = createRepositoryReferencedFileReader(root)(name);
        expect(result.kind).toBe('image');
        if (result.kind !== 'image') throw new Error('unreachable');
        expect(result.mimeType).toBe(mime);
        // 판별력 — 원본 바이트가 실제로 실렸는지 본다(빈 데이터로도 통과하지 않게).
        // ⛔ Buffer 끼리 비교하지 않는다 — `Buffer<ArrayBufferLike>` ↔ `Buffer<ArrayBuffer>` 가
        //   타입 검사에서 갈려 빨강이 난다(SharedArrayBuffer 에 `resize` 가 없다). 바이트 값으로 본다.
        expect([...Buffer.from(result.data, 'base64').subarray(0, 4)]).toEqual([...bytes.subarray(0, 4)]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('⛔ 모르는 바이너리는 종전대로 not-text 다 (이미지라고 우기지 않는다)', () => {
    const root = mkdtempSync(join(tmpdir(), 'monad-goal-reader-bin-'));
    try {
      writeFileSync(join(root, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));
      expect(createRepositoryReferencedFileReader(root)('blob.bin').kind).toBe('not-text');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
