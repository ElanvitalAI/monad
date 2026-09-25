import { describe, expect, test } from 'bun:test';
import { IUL_SIDEBAR_SHELL_COPY } from '../src/iul/sidebar-shell-copy.js';

describe('IUL sidebar shell copy catalog', () => {
  test('keeps theme, preset, and event copy canonical in one place', () => {
    expect(IUL_SIDEBAR_SHELL_COPY.themeFooterHint).toContain('type filter');
    expect(IUL_SIDEBAR_SHELL_COPY.themeLabFooterHint).toContain('live preview');
    expect(IUL_SIDEBAR_SHELL_COPY.presetsFooterHint).toContain('browse reusable presets');
    expect(IUL_SIDEBAR_SHELL_COPY.eventFooterHint).toContain('browse target experiments');
    expect(IUL_SIDEBAR_SHELL_COPY.themeLabWhyHere).toContain('one VW');
    expect(IUL_SIDEBAR_SHELL_COPY.popupFooterHint).toContain('popup lanes');
    expect(IUL_SIDEBAR_SHELL_COPY.motionFooterHint).toContain('motion recipes');
  });
});
