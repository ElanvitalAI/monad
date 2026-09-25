// PWA `/setup/done` Phase 2 — page export + link inventory contract.
//
// React Testing 없음 (per PWA convention). Page 의 default export 가
// 함수인지만 검증하고, SETUP_LINKS inventory 는 Phase 3 anchor sync
// 보장용 deep test.

import { describe, expect, test } from 'bun:test';

// ⛔ 2026-08-14 — `SETUP_LINKS` 는 `./setup-links` 로 «옮겨졌다»(Next 가 Page 파일의
//   비표준 export 를 거부한다 — 그 파일 머리말이 이유를 적어 뒀다). 이 검사만 옛 자리를
//   가리키고 있어서 `SyntaxError: Export named 'SETUP_LINKS' not found` 로 파일 전체가 죽었다.
import SetupDonePage from './page';
import { SETUP_LINKS } from './setup-links';

describe('SetupDonePage — Phase 2 mount surface', () => {
  test('exports a default component function', () => {
    expect(typeof SetupDonePage).toBe('function');
  });
});

describe('SETUP_LINKS inventory contract', () => {
  test('exports 6 link cards', () => {
    expect(SETUP_LINKS.length).toBe(6);
  });

  test('every link has anchor + label + description + primary fields', () => {
    for (const link of SETUP_LINKS) {
      expect(typeof link.anchor).toBe('string');
      expect(link.anchor.length).toBeGreaterThan(0);
      expect(typeof link.label).toBe('string');
      expect(link.label.length).toBeGreaterThan(0);
      expect(typeof link.description).toBe('string');
      expect(link.description.length).toBeGreaterThan(0);
      expect(typeof link.primary).toBe('boolean');
    }
  });

  test('anchor ids are unique', () => {
    const ids = SETUP_LINKS.map((l) => l.anchor);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('anchor ids are kebab-case (lowercase alphanumerics + dash)', () => {
    for (const link of SETUP_LINKS) {
      expect(link.anchor).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  test('3 primary + 3 optional split (matches design — 안 쓰는 사람 많은 항목은 collapsed)', () => {
    const primaryCount = SETUP_LINKS.filter((l) => l.primary).length;
    const optionalCount = SETUP_LINKS.filter((l) => !l.primary).length;
    expect(primaryCount).toBe(3);
    expect(optionalCount).toBe(3);
  });

  test('personas anchor is in the optional (collapsed) set — per user feedback', () => {
    const personas = SETUP_LINKS.find((l) => l.anchor === 'personas');
    expect(personas).toBeDefined();
    expect(personas?.primary).toBe(false);
  });

  test('expected anchor inventory (Phase 3 가 동일 id 사용해야 함)', () => {
    const anchors = SETUP_LINKS.map((l) => l.anchor).sort();
    expect(anchors).toEqual([
      'advanced',
      'channels',
      'ios',
      'personas',
      'tools',
      'voice',
    ]);
  });
});
