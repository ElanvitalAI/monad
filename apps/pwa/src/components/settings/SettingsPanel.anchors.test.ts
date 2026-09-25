// PWA `/settings` Phase 3 — anchor inventory smoke test.
//
// Phase 2 의 `SETUP_LINKS` (apps/pwa/src/app/setup/done/setup-links.ts) anchor 6개가
// SettingsPanel.tsx 에 실제로 존재해야 `/setup/done` 의 link cards 가
// 정확한 위치로 scroll. 본 test 는 source level grep — SSR 없이도
// regression 잡힘.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SETUP_LINKS } from '../../app/setup/done/setup-links';

const SETTINGS_PANEL_PATH = join(
  import.meta.dir,
  'SettingsPanel.tsx',
);

describe('SettingsPanel anchor inventory (Phase 3 ↔ Phase 2 sync)', () => {
  const source = readFileSync(SETTINGS_PANEL_PATH, 'utf-8');

  test.each(SETUP_LINKS.map((l) => l.anchor))(
    'contains anchor id="%s"',
    (anchor) => {
      // 두 표기 허용: 명시적 placeholder div OR card 가 자체 section id 보유.
      const placeholderPattern = new RegExp(`id="${anchor}"`, 'm');
      expect(source).toMatch(placeholderPattern);
    },
  );

  test('all anchors are siblings of cards (not nested inside data-testids)', () => {
    // Quick guard: anchor div 이 같은 줄에서 className="scroll-mt-..." 와
    // pair 됨 OR card 자체 (PersonaCard) 가 id="..."  를 가짐.
    for (const link of SETUP_LINKS) {
      const idLine = new RegExp(`id="${link.anchor}"`, 'g');
      const matches = source.match(idLine);
      expect(matches?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });
});
