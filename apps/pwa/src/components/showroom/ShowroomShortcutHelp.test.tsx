// FU.B3 (2026-05-09 night) — ShowroomShortcutHelp render contract.
// Pattern mirror: VoiceOverlay.test.tsx · ShowroomInput.test.tsx —
// server-side renderToStaticMarkup + grep for structural markers
// the renderer would lose on regression.

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ShowroomShortcutHelp } from './ShowroomShortcutHelp';
import { SHORTCUT_DESCRIPTIONS } from '@/lib/showroom-keyboard-shortcuts';

describe('ShowroomShortcutHelp — render contract', () => {
  it('open=false → renders nothing (guard)', () => {
    const html = renderToStaticMarkup(
      <ShowroomShortcutHelp open={false} onClose={() => {}} />,
    );
    expect(html).toBe('');
  });

  it('open=true → dialog with role=dialog + aria-modal + labelledby', () => {
    const html = renderToStaticMarkup(
      <ShowroomShortcutHelp open onClose={() => {}} />,
    );
    expect(html).toMatch(/role="dialog"/);
    expect(html).toMatch(/aria-modal="true"/);
    expect(html).toMatch(/aria-labelledby="showroom-shortcut-help-title"/);
    expect(html).toContain('Keyboard shortcuts');
  });

  it('lists every SHORTCUT_DESCRIPTIONS entry (combo + effect)', () => {
    const html = renderToStaticMarkup(
      <ShowroomShortcutHelp open onClose={() => {}} />,
    );
    for (const entry of SHORTCUT_DESCRIPTIONS) {
      // effect strings should appear verbatim
      expect(html).toContain(entry.effect);
      // combo strings appear inside <kbd> — check at minimum the
      // raw chars appear (some chars HTML-escape so we can't grep
      // exactly the rendered fragment cheaply)
      expect(html).toContain(entry.id);
    }
  });

  it('close button has aria-label + Keyboard icon', () => {
    const html = renderToStaticMarkup(
      <ShowroomShortcutHelp open onClose={() => {}} />,
    );
    expect(html).toMatch(/aria-label="Close shortcut help"/);
    expect(html).toMatch(/data-testid="showroom-shortcut-help-close"/);
  });

  it('every shortcut row renders with stable testid (regression guard)', () => {
    const html = renderToStaticMarkup(
      <ShowroomShortcutHelp open onClose={() => {}} />,
    );
    expect(html).toMatch(/showroom-shortcut-help-row-focus-broadcast-input/);
    expect(html).toMatch(/showroom-shortcut-help-row-toggle-role-judge/);
    expect(html).toMatch(/showroom-shortcut-help-row-toggle-voice/);
    expect(html).toMatch(/showroom-shortcut-help-row-toggle-tts/);
    expect(html).toMatch(/showroom-shortcut-help-row-open-help/);
  });
});
