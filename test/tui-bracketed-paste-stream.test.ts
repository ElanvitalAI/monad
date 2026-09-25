import { describe, expect, test } from 'bun:test';

import { KeyStreamParser } from '../src/tui.js';

const START = '\x1b[200~';
const END = '\x1b[201~';

function pasteKey(body: string) {
  return {
    name: 'paste',
    ctrl: false,
    shift: false,
    raw: START + body + END,
    paste: body,
  };
}

describe('KeyStreamParser bracketed paste', () => {
  test.each([
    ['CR', 'L1\rL2'],
    ['CRLF', 'L1\r\nL2'],
    ['LF', 'L1\nL2'],
  ])('normalizes %s body newlines to LF while preserving the raw envelope', (_kind, body) => {
    const parser = new KeyStreamParser();
    const [key] = parser.push(`${START}${body}${END}`);

    expect(key).toMatchObject({ name: 'paste', paste: 'L1\nL2' });
    expect(key!.raw).toBe(`${START}${body}${END}`);
  });

  test('emits one paste event and no enter for a multiline envelope', () => {
    const parser = new KeyStreamParser();
    const keys = parser.push(`${START}L1\nL2${END}`);

    expect(keys).toEqual([pasteKey('L1\nL2')]);
    expect(keys.filter((key) => key.name === 'enter')).toHaveLength(0);
  });

  test('preserves a multiline paste split across chunks', () => {
    const parser = new KeyStreamParser();

    expect(parser.push(`${START}L1\n`)).toEqual([]);
    expect(parser.push(`L2${END}`)).toEqual([pasteKey('L1\nL2')]);
  });

  test('preserves a paste when its closing envelope crosses chunks', () => {
    const parser = new KeyStreamParser();

    expect(parser.push(`${START}L1\nL2\x1b[20`)).toEqual([]);
    expect(parser.push('1~')).toEqual([pasteKey('L1\nL2')]);
  });

  test('preserves a single-line paste', () => {
    const parser = new KeyStreamParser();

    expect(parser.push(`${START}ABC${END}`)).toEqual([pasteKey('ABC')]);
  });

  test('preserves UTF-8 text split across paste-body chunks', () => {
    const parser = new KeyStreamParser();
    const envelope = Buffer.from(`${START}한글${END}`);
    const splitAt = envelope.indexOf(Buffer.from('한')) + 1;

    expect(parser.push(envelope.subarray(0, splitAt))).toEqual([]);
    expect(parser.push(envelope.subarray(splitAt))).toEqual([pasteKey('한글')]);
  });

  test('preserves the complete raw envelope when split at every byte boundary', () => {
    const source = Buffer.from(`${START}L1\nL2${END}`);
    for (let splitAt = 1; splitAt < source.length; splitAt++) {
      const parser = new KeyStreamParser();
      expect(parser.push(source.subarray(0, splitAt))).toEqual([]);
      expect(parser.push(source.subarray(splitAt))).toEqual([pasteKey('L1\nL2')]);
    }
  });

  // ⛔⭐ 끝 표식이 **안 오는**(또는 너무 큰) 봉투 — 상한이 없으면 pasteBody 가 무한히 자라고
  //    그 동안 TUI 가 **모든 입력을 삼킨 채** 붙여넣기 모드에서 못 나온다.
  //    ⭐ 값(1MiB)의 출처는 #5865 — 같은 결함을 다른 구현으로 다룬 PR(재발명 0).
  test('closes a normal 1MiB envelope once when its end marker arrives in the next chunk', () => {
    const parser = new KeyStreamParser();
    const body = 'x'.repeat(1024 * 1024);

    expect(parser.push(`${START}${body}`)).toEqual([]);
    const keys = parser.push(END);

    // ⭐ 계약을 직접 고정한다(리뷰 should-fix) — "봉투가 한 번만 닫히고 **다른 키가 전혀 없다**".
    //   `filter(paste).toHaveLength(1)` 만으로는 끝 표식이 일반 키로 새어 나온 경우를 못 가른다.
    expect(keys).toHaveLength(1);
    expect(keys.filter((key) => key.name === 'paste')).toHaveLength(1);
    expect(keys[0]).toMatchObject({ name: 'paste', paste: body });
    expect(Buffer.byteLength(keys[0]!.paste!)).toBe(1024 * 1024);
    expect(keys.slice(1).map((key) => key.raw).join('')).not.toContain(END);
  });

  test('closes the envelope AT the cap and keeps the remainder flowing', () => {
    const parser = new KeyStreamParser();
    expect(parser.push('\x1b[200~')).toEqual([]);
    // ⛔ **단일 대형 청크 하나**로 넘겨 본다 — 붙인 뒤에 재면 이 한 방에 무제한 초과한다.
    const keys = parser.push('x'.repeat(2 * 1024 * 1024) + 'TAIL');
    expect(keys[0]!.name).toBe('paste');
    expect(Buffer.byteLength(keys[0]!.paste!)).toBe(1024 * 1024);   // ⭐ **정확히 상한**
    // ⭐ 상한 뒤 데이터는 **버려지지 않는다** — 일반 키로 계속 흐른다
    expect(keys.slice(1, 5).map((k) => k.name).join('')).toBe('xxxx');
  });

  // ⛔⭐ 끝 표식이 **같은 청크에 있어도** 상한을 지킨다(리뷰 must-fix — 그 경로가 무제한이었다).
  test('the cap also applies when the end marker arrives in the same chunk', () => {
    const parser = new KeyStreamParser();
    const keys = parser.push('\x1b[200~' + 'y'.repeat(2 * 1024 * 1024) + '\x1b[201~');
    expect(keys[0]!.name).toBe('paste');
    expect(Buffer.byteLength(keys[0]!.paste!)).toBe(1024 * 1024);
  });

  // ⛔⭐ **바이트로 자른다** — UTF-16 slice 로 자르면 다중바이트 본문이 상한을 크게 넘는다.
  // ⛔⭐ 본문에 **원래 있던 U+FFFD** 를 지우면 안 된다(리뷰 must-fix) — 절단 산물과 구별해야 한다.
  test('a genuine U+FFFD in the body survives the cap boundary', () => {
    const parser = new KeyStreamParser();
    expect(parser.push('\x1b[200~')).toEqual([]);
    // 상한 직전까지 채우고, 경계에 **진짜 U+FFFD** 를 둔다
    const filler = 'a'.repeat(1024 * 1024 - 3);
    const keys = parser.push(filler + '\uFFFD' + 'REST');
    expect(keys[0]!.name).toBe('paste');
    expect(keys[0]!.paste!.endsWith('\uFFFD')).toBe(true);   // ⭐ 지워지지 않았다
    expect(Buffer.byteLength(keys[0]!.paste!)).toBe(1024 * 1024);
  });

  // ⛔⭐ 리뷰 must-fix — 매 청크마다 누적 전체를 다시 재면 **작은 청크 스트림에서 O(n²)** 다.
  //    누적 카운터가 있어야 한다. 여기서는 **동작 계약**(많은 작은 청크로도 상한이 정확)을 고정한다.
  test('many small chunks still stop exactly at the cap (running byte counter)', () => {
    const parser = new KeyStreamParser();
    expect(parser.push('\x1b[200~')).toEqual([]);
    const chunk = 'z'.repeat(64 * 1024);
    let closed = parser.push(chunk);
    for (let i = 1; i < 32 && closed.length === 0; i += 1) closed = parser.push(chunk);
    expect(closed[0]!.name).toBe('paste');
    expect(Buffer.byteLength(closed[0]!.paste!)).toBe(1024 * 1024);   // ⭐ 정확히 상한
  });

  test('the cap is measured in bytes, not UTF-16 units', () => {
    const parser = new KeyStreamParser();
    expect(parser.push('\x1b[200~')).toEqual([]);
    const keys = parser.push('가'.repeat(1024 * 1024));   // 한 글자 3바이트
    expect(keys[0]!.name).toBe('paste');
    expect(Buffer.byteLength(keys[0]!.paste!)).toBeLessThanOrEqual(1024 * 1024);
  });

  // ⛔⭐ 리뷰 must-fix — 봉투 안에서 청크가 `…\x1b` 로 끝나면 그 ESC 는 **끝 표식의 앞 한 글자**다.
  //    25ms 조용창 flush 가 그것을 Escape 로 소비하면 종료 표식이 깨져 붙여넣기가 **영영 안 닫힌다**.
  test('flushEscape does not steal the ESC that begins the paste end marker', () => {
    const parser = new KeyStreamParser();
    expect(parser.push('\x1b[200~body\x1b')).toEqual([]);   // 청크가 ESC 로 끝난다(=끝 표식 시작)
    expect(parser.flushEscape()).toEqual([]);                // ⭐ 훔치지 않는다
    expect(parser.flush()).toEqual([]);                      // flush 도 이미 조용하다
    // ⭐ 나머지 표식이 오면 봉투가 정상적으로 닫힌다
    const keys = parser.push('[201~');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ name: 'paste', paste: 'body' });
  });

  test('flushes a standalone Escape without misclassifying immediate Alt input', () => {
    const escape = new KeyStreamParser();
    expect(escape.push('\x1b')).toEqual([]);
    expect(escape.flush()).toEqual([
      { name: 'escape', ctrl: false, shift: false, raw: '\x1b' },
    ]);

    const alt = new KeyStreamParser();
    expect(alt.push('\x1b')).toEqual([]);
    expect(alt.push('x')).toEqual([
      { name: 'x', ctrl: false, shift: false, alt: true, raw: '\x1bx' },
    ]);
  });
});
