import { afterEach, describe, expect, test } from 'bun:test';
import { addPaletteColorForTest, resetForTesting, setPtyAdapterForTesting, startPty } from '../src/pty-shell/registry.js';

function adapter() {
  let onData: (chunk: string) => void = () => {};
  return {
    pid: 1,
    write() {},
    kill() {},
    onData(listener: (chunk: string) => void) { onData = listener; return { dispose() {} }; },
    onExit() { return { dispose() {} }; },
    emit(chunk: string) { onData(chunk); },
  };
}

afterEach(() => { resetForTesting(); setPtyAdapterForTesting(null); });

describe('PTY ANSI screen rendering', () => {
  test('preserves default text, reconstructs styled cells once per run, and resets at the line end', async () => {
    const fake = adapter();
    setPtyAdapterForTesting(() => fake);
    const handle = startPty({ cmd: 'test', cols: 20, rows: 3 });
    fake.emit('\u001b[1;31mRED\u001b[0m plain\r\n\u001b[32mGREEN');

    const plain = await handle.renderScreen();
    const ansi = await handle.renderScreen({ ansi: true });
    expect(plain).toContain('RED plain');
    expect(plain).not.toContain('\u001b[');
    expect(ansi).toContain('\u001b[1;31mRED\u001b[0m plain');
    expect((ansi.match(/\u001b\[1;31m/g) ?? []).length).toBe(1);
    expect(ansi).toContain('RED\u001b[0m plain');
    expect(ansi).toMatch(/\u001b\[32mGREEN\u001b\[0m$/);
  });

  test('resets and reapplies full attributes across styled runs without repeating an unchanged run', async () => {
    const fake = adapter();
    setPtyAdapterForTesting(() => fake);
    const handle = startPty({ cmd: 'test', cols: 20, rows: 3 });
    fake.emit('\u001b[1;31mAB\u001b[22;32mC\u001b[44mD');

    const ansi = await handle.renderScreen({ ansi: true });
    expect(ansi).toContain('\u001b[1;31mAB\u001b[0m\u001b[32mC\u001b[0m\u001b[32;44mD\u001b[0m');
    expect((ansi.match(/\u001b\[1;31m/g) ?? []).length).toBe(1);
    expect((ansi.match(/\u001b\[32m/g) ?? []).length).toBe(1);
  });

  test('resets an active line before the next line begins', async () => {
    const fake = adapter();
    setPtyAdapterForTesting(() => fake);
    const handle = startPty({ cmd: 'test', cols: 20, rows: 3 });
    fake.emit('\u001b[31mRED\r\nNEXT');

    const ansi = await handle.renderScreen({ ansi: true });
    expect(ansi).toContain('\u001b[31mRED\u001b[0m\n\u001b[31mNEXT\u001b[0m');
  });

  test('skips wide-character continuation cells', async () => {
    const fake = adapter();
    setPtyAdapterForTesting(() => fake);
    const handle = startPty({ cmd: 'test', cols: 20, rows: 3 });
    fake.emit('\u001b[31m한A\u001b[0m');

    const ansi = await handle.renderScreen({ ansi: true });
    expect(ansi).toContain('\u001b[31m한A\u001b[0m');
    expect(ansi).not.toContain('한 A');
  });

  test('preserves standard, bright, and 256-color palette modes with bold', async () => {
    const fake = adapter();
    setPtyAdapterForTesting(() => fake);
    const handle = startPty({ cmd: 'test', cols: 20, rows: 3 });
    fake.emit('\u001b[1;31mA\u001b[92mB\u001b[38;5;196mC');

    await expect(handle.renderScreen({ ansi: true })).resolves.toContain('\u001b[1;31mA\u001b[0m\u001b[1;92mB\u001b[0m\u001b[1;38;5;196mC\u001b[0m');
  });

  test('serializes extended underline style and color', async () => {
    const fake = adapter();
    setPtyAdapterForTesting(() => fake);
    const handle = startPty({ cmd: 'test', cols: 20, rows: 3 });
    fake.emit('\u001b[4:2;58:5:196mD\u001b[4:3;58:2::1:2:3mE\u001b[24;59mF');

    const ansi = await handle.renderScreen({ ansi: true });
    expect(ansi).toContain('\u001b[4:2;58;5;196mD\u001b[0m');
    expect(ansi).toContain('\u001b[4:3;58;2;1;2;3mE\u001b[0m');
    expect(ansi).toContain('F');
    expect(ansi).not.toContain('\u001b[4:1mF');
  });

  test('does not emit SGR for an unstyled screen and reports visible and hidden cursors', async () => {
    const fake = adapter();
    setPtyAdapterForTesting(() => fake);
    const handle = startPty({ cmd: 'test', cols: 20, rows: 3 });
    fake.emit('plain');
    await expect(handle.renderScreen({ ansi: true })).resolves.toMatch(/^\[screen 20x3 cursor=\(row 0, col 5, visible true\)\]\nplain$/);
    fake.emit('\u001b[?25l');
    await expect(handle.renderScreen()).resolves.toContain('cursor=(row 0, col 5, visible false)');
  });
});

describe('팔레트 색 — 저인덱스 표기 (무인 리뷰 must-fix 반려 · 2026-08-01)', () => {
  // ⛔ 리뷰는 저인덱스도 38;5;N 을 유지하라 했다. 지적은 맞지만 xterm 셀 API 가
  //    P16/P256 구분을 노출하지 않아 어느 쪽으로 내든 한쪽은 틀린다.
  //    실측: 축약을 제거하니 기존 테스트 5개가 깨졌다(\u001b[31m 이 38;5;1 로 나온다).
  //    ⇒ 결정: 저인덱스는 P16 표기를 유지한다. 이 테스트가 그 결정을 회귀로 고정한다.
  test.each([[0, '30'], [3, '33'], [7, '37'], [8, '90'], [15, '97']])(
    '전경 저인덱스 %i → %s', (idx, expected) => {
      const codes: string[] = [];
      addPaletteColorForTest(codes, true, idx as number);
      expect(codes).toEqual([expected as string]);
    });

  test('배경 저인덱스는 40/100 계열', () => {
    const bg: string[] = [];
    addPaletteColorForTest(bg, false, 3);
    expect(bg).toEqual(['43']);
  });

  test('16 이상은 38;5;N 을 쓴다', () => {
    const codes: string[] = [];
    addPaletteColorForTest(codes, true, 196);
    expect(codes).toEqual(['38', '5', '196']);
  });
});
