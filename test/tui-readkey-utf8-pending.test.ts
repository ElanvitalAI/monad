import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';

import { closeTui, initTui, KeyStreamParser, readKey } from '../src/tui.js';

function waitForStdinReader(): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tick = () => {
      if (process.stdin.listenerCount('data') > 0) { resolve(); return; }
      if (attempt++ > 200) { reject(new Error('readKey did not attach a stdin data listener')); return; }
      setTimeout(tick, 1);
    };
    tick();
  });
}

describe('readKey UTF-8 decoder carry', () => {
  let stdin: { setRawMode?: (mode: boolean) => unknown };
  let originalIsTTY: PropertyDescriptor | undefined;
  let originalSetRawMode: ((mode: boolean) => unknown) | undefined;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    stdin = process.stdin as unknown as { setRawMode?: (mode: boolean) => unknown };
    originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    originalSetRawMode = stdin.setRawMode;
    // ⛔ `.bind()` 로 잡지 않는다(리뷰 should-fix) — 바인딩된 래퍼를 되돌리면 **함수 identity 가
    //   원본과 달라져** 같은 프로세스의 뒤 테스트가 원본을 못 되찾는다. 참조 그대로 보관한다.
    originalWrite = process.stdout.write;
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    stdin.setRawMode = () => stdin;
    (process.stdout.write as unknown as (chunk: string | Uint8Array) => boolean) = (() => true) as typeof process.stdout.write;
    initTui(false);
  });

  afterEach(() => {
    closeTui();
    (process.stdout.write as typeof process.stdout.write) = originalWrite;
    if (originalSetRawMode) stdin.setRawMode = originalSetRawMode;
    else Reflect.deleteProperty(stdin, 'setRawMode');
    if (originalIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  });

  test.each(['한', '😀'])('keeps byte-split UTF-8 %s pending through continuation-only chunks', async (character) => {
    const stream = new PassThrough();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { configurable: true, value: stream });
    try {
      const bytes = Buffer.from(character);
      let resolved = false;
      const first = readKey().then((key) => {
        resolved = true;
        return key;
      });
      await waitForStdinReader();

      for (let index = 0; index < bytes.length - 1; index += 1) {
        stream.write(bytes.subarray(index, index + 1));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(resolved).toBe(false);
        expect(stream.isPaused()).toBe(false);
      }

      stream.write(bytes.subarray(bytes.length - 1));
      await expect(first).resolves.toMatchObject({ name: character });
    } finally {
      Object.defineProperty(process, 'stdin', { configurable: true, value: originalStdin });
      stream.destroy();
    }
  });

  test.each(['before-next-read', 'after-next-read'] as const)('retains an open paste envelope when its continuation arrives %s', async (order) => {
    const stream = new PassThrough();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { configurable: true, value: stream });
    try {
      const first = readKey();
      await waitForStdinReader();
      stream.write('x\x1b[200~first ');
      await expect(first).resolves.toMatchObject({ name: 'x' });
      expect(stream.isPaused()).toBe(true);

      if (order === 'before-next-read') stream.write('second\x1b[201~');
      const paste = readKey();
      if (order === 'after-next-read') stream.write('second\x1b[201~');
      await expect(paste).resolves.toMatchObject({ name: 'paste', paste: 'first second' });
    } finally {
      Object.defineProperty(process, 'stdin', { configurable: true, value: originalStdin });
      stream.destroy();
    }
  });

  test.each([
    ['한', 2, 'before-next-read'],
    ['한', 2, 'after-next-read'],
    ['😀', 3, 'before-next-read'],
    ['😀', 3, 'after-next-read'],
  ] as const)('retains split %s when its continuation arrives %s', async (character, splitAt, order) => {
    const stream = new PassThrough();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { configurable: true, value: stream });
    try {
      const bytes = Buffer.from(character);
      const first = readKey();
      await waitForStdinReader();
      stream.write(Buffer.concat([Buffer.from('x'), bytes.subarray(0, splitAt)]));
      await expect(first).resolves.toMatchObject({ name: 'x' });
      expect(stream.isPaused()).toBe(true);

      if (order === 'before-next-read') stream.write(bytes.subarray(splitAt));
      const second = readKey();
      if (order === 'after-next-read') stream.write(bytes.subarray(splitAt));
      await expect(second).resolves.toMatchObject({ name: character });
    } finally {
      Object.defineProperty(process, 'stdin', { configurable: true, value: originalStdin });
      stream.destroy();
    }
  });

  test('exposes decoder-held bytes from the decoder write result', () => {
    const parser = new KeyStreamParser();
    const bytes = Buffer.from('한');
    expect(parser.push(bytes.subarray(0, 2))).toEqual([]);
    expect(parser.hasPendingDecoderBytes()).toBe(true);
    expect(parser.push(Buffer.alloc(0))).toEqual([]);
    expect(parser.hasPendingDecoderBytes()).toBe(true);
    expect(parser.push(bytes.subarray(2))).toMatchObject([{ name: '한' }]);
    expect(parser.hasPendingDecoderBytes()).toBe(false);
  });

  test('reports decoder carry after a complete character followed by the next lead byte', () => {
    const parser = new KeyStreamParser();
    const character = Buffer.from('한');

    expect(parser.push(Buffer.concat([Buffer.from('x'), character.subarray(0, 2)]))).toMatchObject([{ name: 'x' }]);
    expect(parser.hasPendingDecoderBytes()).toBe(true);
    expect(parser.push(character.subarray(2))).toMatchObject([{ name: '한' }]);
    expect(parser.hasPendingDecoderBytes()).toBe(false);
  });

  test('preserves input after non-standard UTF-8 lead bytes', async () => {
    for (const lead of [Buffer.from([0xC0]), Buffer.from([0xC1]), Buffer.from([0xF5]), Buffer.from([0xF7])]) {
      const stream = new PassThrough();
      const originalStdin = process.stdin;
      Object.defineProperty(process, 'stdin', { configurable: true, value: stream });
      try {
        const first = readKey();
        await waitForStdinReader();
        stream.write(lead);
        await new Promise((resolve) => setTimeout(resolve, 0));
        stream.write(Buffer.from('x'));

        await expect(first).resolves.toMatchObject({ name: '�' });
        await expect(readKey()).resolves.toMatchObject({ name: 'x' });
      } finally {
        Object.defineProperty(process, 'stdin', { configurable: true, value: originalStdin });
        stream.destroy();
      }
    }
  });
});
