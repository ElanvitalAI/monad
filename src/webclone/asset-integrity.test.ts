// ── 🩸 「셌다」와 「쓸 수 있다」는 다른 값 ─────────────────────────────────────

import { describe, expect, test } from 'bun:test';

import { checkAssets, formatIntegrity, inspectAsset } from './asset-integrity.js';

const enc = (s: string) => new TextEncoder().encode(s);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

describe('inspectAsset', () => {
  test('크기 0 은 «받다 만 것»이다', () => {
    expect(inspectAsset({ path: 'a.js', bytes: 0, head: new Uint8Array() })?.defect).toBe('empty');
  });

  test('🩸 .js 자리에 HTML — 오류 페이지를 받아 저장한 것이다', () => {
    expect(inspectAsset({ path: 'app.js', bytes: 900, head: enc('<!DOCTYPE html><html>404') })?.defect)
      .toBe('html-in-code-slot');
    expect(inspectAsset({ path: 'app.css', bytes: 900, head: enc('  <html>oops') })?.defect)
      .toBe('html-in-code-slot');
  });

  test('⛔ HTML «파일»은 HTML 이어도 성하다 — 자리가 다르다', () => {
    expect(inspectAsset({ path: 'index.html', bytes: 900, head: enc('<!DOCTYPE html>') })).toBeNull();
  });

  test('이미지 매직 바이트를 본다 — 확장자를 «믿지» 않는다', () => {
    expect(inspectAsset({ path: 'a.png', bytes: 100, head: enc('<html>') })?.defect).toBe('wrong-magic');
    expect(inspectAsset({ path: 'a.png', bytes: 100, head: png })).toBeNull();
    expect(inspectAsset({ path: 'a.jpg', bytes: 100, head: jpg })).toBeNull();
  });

  test('✅ 성한 코드는 «안» 잡힌다', () => {
    expect(inspectAsset({ path: 'app.js', bytes: 90, head: enc('export const a = 1;') })).toBeNull();
  });

  test('쿼리·조각 뒤는 판정에서만 떼고, verdict 경로는 원래 이름으로 둔다', () => {
    const wrongPng = inspectAsset({ path: 'a.png?vsn=d', bytes: 100, head: enc('<html>') });
    expect(wrongPng).toMatchObject({ path: 'a.png?vsn=d', defect: 'wrong-magic', expected: 'PNG' });
    expect(inspectAsset({ path: 'b.js?v=123', bytes: 100, head: enc('<!doctype html>') })?.defect)
      .toBe('html-in-code-slot');
    expect(inspectAsset({ path: 'c.png?vsn=d#icon', bytes: 100, head: png })).toBeNull();
    expect(inspectAsset({ path: 'e.png#icon', bytes: 100, head: enc('<html>') }))
      .toMatchObject({ path: 'e.png#icon', defect: 'wrong-magic', expected: 'PNG' });
    expect(inspectAsset({ path: 'd.unknownext?x=1', bytes: 100, head: enc('<html>') })).toBeNull();
  });
});

describe('checkAssets — ⛔ 분모가 0 이면 비율은 «없다»', () => {
  test('빈 목록은 비율 null — 0% 로 «몰지» 않는다', () => {
    const r = checkAssets([]);
    expect(r.brokenRatio).toBeNull();
    expect(formatIntegrity(r)).toContain('없었다');
  });

  test('전부 성하면 비율 0', () => {
    const r = checkAssets([{ path: 'a.js', bytes: 10, head: enc('x') }]);
    expect(r.brokenRatio).toBe(0);
    expect(formatIntegrity(r)).toContain('전부 성하다');
  });

  test('쿼리 자산은 검사 분모에 넣고, 모르는 확장자는 넣지 않는다', () => {
    const r = checkAssets([
      { path: 'c.png?vsn=d#icon', bytes: 100, head: png },
      { path: 'd.unknownext?x=1', bytes: 100, head: enc('<html>') },
    ]);
    expect(r.checked).toBe(1);
    expect(r.broken).toEqual([]);
    expect(r.brokenRatio).toBe(0);
  });

  test('🔴 깨진 것을 «이름과 원인»으로 댄다 — 수만 말하지 않는다', () => {
    const r = checkAssets([
      { path: 'a.js', bytes: 10, head: enc('<html>') },
      { path: 'b.js', bytes: 0, head: new Uint8Array() },
      { path: 'c.js', bytes: 10, head: enc('ok') },
    ]);
    expect(r.broken.length).toBe(2);
    const line = formatIntegrity(r);
    expect(line).toContain('a.js(html-in-code-slot)');
    expect(line).toContain('b.js(empty)');
  });
});

// ── 🩸 매직 표 — 확장자가 12종으로 늘었다. ⛔ «양성·음성 둘 다» 누른다 ───────────
//
// 실측 2026-09-08: 보관본의 `.woff2` 15개가 전부 `wOF2` 였다(실물에서 확인).
// ⛔ 옛 판은 png/jpeg 만 봐서 폰트가 «검사 밖»이었다 — 「성하다」가 아니라 「안 봤다」였다.
describe('매직 표 — 12종', () => {
  const b = (...n: number[]) => new Uint8Array(n);
  const t = (s: string) => new TextEncoder().encode(s);
  const check = (path: string, head: Uint8Array) => inspectAsset({ path, bytes: 999, head });

  test('⭐ 실물에서 온 머리 바이트를 «통과»시킨다', () => {
    expect(check('a.woff2', t('wOF2 '))).toBeNull();      // 🩸 보관본 15개가 이 모양이다
    expect(check('a.woff', t('wOFF'))).toBeNull();
    expect(check('a.ttf', b(0x00, 0x01, 0x00, 0x00))).toBeNull();
    expect(check('a.otf', t('OTTO'))).toBeNull();
    expect(check('a.gif', t('GIF89a'))).toBeNull();
    expect(check('a.ico', b(0x00, 0x00, 0x01, 0x00))).toBeNull();
    expect(check('a.webm', b(0x1a, 0x45, 0xdf, 0xa3))).toBeNull();
    expect(check('a.mp3', t('ID3'))).toBeNull();
  });

  test('⭐ 오프셋이 «앞이 아닌» 둘도 안다', () => {
    expect(check('a.mp4', t('    ftypmp42'))).toBeNull();     // ftyp 는 4바이트 뒤
    expect(check('a.webp', t('RIFF    WEBP'))).toBeNull();    // WEBP 는 8바이트 뒤
  });

  test('🔴 틀리면 «무엇이었어야 하나»를 댄다 — 그것 없이는 못 고친다', () => {
    const v = check('a.woff2', t('<!DOCTYPE html>'));
    expect(v?.defect).toBe('wrong-magic');
    expect(v?.expected).toBe('WOFF2');
  });

  test('⛔ SVG 는 «시작»이 아니라 «있나»로 본다 — 주석으로 열 수 있다', () => {
    expect(check('a.svg', t('<!-- 주석 --> <svg xmlns="x">'))).toBeNull();
    expect(check('a.svg', t('<html><body>404'))?.defect).toBe('wrong-magic');
  });

  test('⛔ 목록에 «없는» 확장자는 검사하지 않는다 — 모르는 걸 틀렸다고 하면 거짓양성이다', () => {
    expect(check('a.webmanifest', t('{"name":"x"}'))).toBeNull();
    expect(check('a.txt', b(0xff, 0xd8))).toBeNull();
  });
});
