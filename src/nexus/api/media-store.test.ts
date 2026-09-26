import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  gcMediaStore,
  mediaFileExtension,
  mediaStoreId,
  resolveMediaPath,
  saveRemoteMedia,
} from './media-store.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'elanous-media-test-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

function okResponse(bytes: Uint8Array): Response {
  // ⛔ `Uint8Array` 를 그대로 못 넘긴다 — 이 tsc 판에서 `BodyInit`/`BlobPart` 가
  //   `ArrayBufferLike` 제네릭을 안 받는다. 밑에 깔린 «버퍼»를 준다.
  return new Response(bytes.buffer as ArrayBuffer, { status: 200 });
}

describe('media-store · 확장자', () => {
  test('주소의 확장자를 «그대로» 쓴다', () => {
    expect(mediaFileExtension('https://cdn.test/a/b.png?x=1', 'image')).toBe('.png');
    expect(mediaFileExtension('https://cdn.test/a/b.MP4', 'video')).toBe('.mp4');
  });

  test('⛔ 모르는 확장자를 «지어내지 않고» 종류의 기본값으로 내려간다', () => {
    // 잘못 붙이면 플레이어가 못 연다 — 그래서 아무거나 붙이지 않는다.
    expect(mediaFileExtension('https://cdn.test/opaque-id', 'video')).toBe('.mp4');
    expect(mediaFileExtension('https://cdn.test/a/b.exe', 'image')).toBe('.png');
    expect(mediaFileExtension('not a url at all', 'image')).toBe('.png');
  });
});

describe('media-store · id', () => {
  test('같은 주소는 «같은 id» — 두 번 담아도 파일이 하나다', () => {
    expect(mediaStoreId('https://cdn.test/a.png', 'image'))
      .toBe(mediaStoreId('https://cdn.test/a.png', 'image'));
  });

  test('다른 주소는 다른 id', () => {
    expect(mediaStoreId('https://cdn.test/a.png', 'image'))
      .not.toBe(mediaStoreId('https://cdn.test/b.png', 'image'));
  });
});

describe('media-store · resolveMediaPath', () => {
  test('⛔ 경로 탈출을 막는다', () => {
    // id 는 바깥(HTTP 경로)에서 온다 — 그 자리가 곧 공격면이다.
    expect(resolveMediaPath('../../etc/passwd', root)).toBeNull();
    expect(resolveMediaPath('a/b.png', root)).toBeNull();
    expect(resolveMediaPath('..', root)).toBeNull();
  });

  test('없는 id 는 null', () => {
    expect(resolveMediaPath(`${'a'.repeat(32)}.png`, root)).toBeNull();
  });

  test('있는 파일은 경로를 준다', () => {
    const id = `${'a'.repeat(32)}.png`;
    writeFileSync(join(root, id), 'x');
    expect(resolveMediaPath(id, root)).toBe(join(root, id));
  });
});

describe('media-store · saveRemoteMedia', () => {
  test('내려받아 담고 id·크기를 돌려준다', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const entry = await saveRemoteMedia('https://cdn.test/a.png', 'image', {
      root, fetchImpl: async () => okResponse(bytes),
    });
    expect(entry).not.toBeNull();
    expect(entry!.bytes).toBe(4);
    expect(existsSync(entry!.path)).toBe(true);
  });

  test('⭐ 이미 담은 주소는 «다시 안 받는다»', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return okResponse(new Uint8Array([1])); };
    await saveRemoteMedia('https://cdn.test/a.png', 'image', { root, fetchImpl });
    await saveRemoteMedia('https://cdn.test/a.png', 'image', { root, fetchImpl });
    expect(calls).toBe(1);
  });

  test('⛔ 상한을 넘는 파일은 «담지 않는다»(원격 주소가 살아 있으므로 복원은 계속 된다)', async () => {
    const entry = await saveRemoteMedia('https://cdn.test/big.mp4', 'video', {
      root, maxFileBytes: 3, fetchImpl: async () => okResponse(new Uint8Array([1, 2, 3, 4, 5])),
    });
    expect(entry).toBeNull();
    expect(readdirSync(root)).toHaveLength(0);
  });

  test('⛔ HTTP 실패·빈 본문은 «예외가 아니라 null»', async () => {
    // 보관은 «보험»이다 — 보험이 안 들렸다고 원래 일이 깨지면 안 된다.
    expect(await saveRemoteMedia('https://cdn.test/a.png', 'image', {
      root, fetchImpl: async () => new Response('nope', { status: 404 }),
    })).toBeNull();
    expect(await saveRemoteMedia('https://cdn.test/b.png', 'image', {
      root, fetchImpl: async () => okResponse(new Uint8Array()),
    })).toBeNull();
  });

  test('⛔ fetch 가 «던져도» null 이지 예외가 아니다', async () => {
    expect(await saveRemoteMedia('https://cdn.test/a.png', 'image', {
      root, fetchImpl: async () => { throw new Error('network down'); },
    })).toBeNull();
  });
});

describe('media-store · gc', () => {
  function seed(name: string, bytes: number, ageMs: number): void {
    const path = join(root, name);
    writeFileSync(path, new Uint8Array(bytes));
    const when = (Date.now() - ageMs) / 1000;
    utimesSync(path, when, when);
  }

  test('총량이 상한 안이면 «아무것도 안 지운다»', () => {
    seed('a.png', 10, 1000);
    expect(gcMediaStore(100, root)).toBe(0);
    expect(readdirSync(root)).toHaveLength(1);
  });

  test('⭐ 넘치면 «오래된 것부터» 지운다', () => {
    seed('old.png', 60, 90_000);
    seed('new.png', 60, 1_000);
    const freed = gcMediaStore(100, root);
    expect(freed).toBe(60);
    expect(readdirSync(root)).toEqual(['new.png']);
  });

  test('보관소가 «없어도» 죽지 않는다', () => {
    expect(gcMediaStore(100, join(root, 'nope'))).toBe(0);
  });
});
