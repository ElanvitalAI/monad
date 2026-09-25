import { describe, expect, test } from 'bun:test';
import { auditKeybindings, normalizeKeyLabel, renderKeymapAudit } from '../src/keymap-audit.js';
import type { KeyBinding } from '../src/keybindings.js';

describe('keymap audit', () => {
  test('normalizes modifier order and named keys', () => {
    expect(normalizeKeyLabel('Shift+Ctrl+space')).toBe('Ctrl+Shift+Space');
    expect(normalizeKeyLabel('C+pgup')).toBe('Ctrl+PageUp');
    expect(normalizeKeyLabel('return')).toBe('Enter');
  });

  test('flags global/context reuse as warning', () => {
    const bindings: KeyBinding[] = [
      { keys: ['Ctrl+G'], action: 'Cancel global', context: 'global' },
      { keys: ['Ctrl+G'], action: 'Reject picker', context: 'select' },
    ];
    const audit = auditKeybindings(bindings);
    expect(audit.issues).toHaveLength(1);
    expect(audit.issues[0]?.severity).toBe('warning');
    expect(audit.issues[0]?.key).toBe('Ctrl+G');
  });

  test('exclusive context reuse is informational', () => {
    const bindings: KeyBinding[] = [
      { keys: ['j'], action: 'Move browser', context: 'browser' },
      { keys: ['j'], action: 'Scroll log', context: 'log' },
    ];
    const audit = auditKeybindings(bindings);
    expect(audit.issues).toHaveLength(1);
    expect(audit.issues[0]?.severity).toBe('info');
  });

  test('renderer includes summary and issue actions', () => {
    const rendered = renderKeymapAudit(auditKeybindings([
      { keys: ['Ctrl+G'], action: 'Cancel global', context: 'global' },
      { keys: ['Ctrl+G'], action: 'Reject picker', context: 'select' },
    ]));
    expect(rendered).toContain('keybindings: 2');
    expect(rendered).toContain('Cancel global');
    expect(rendered).toContain('[warning]');
  });
});

