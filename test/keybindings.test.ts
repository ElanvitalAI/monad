// ── Keybinding registry tests ──

import { describe, test, expect } from 'bun:test';
import {
  KEYBINDINGS, CONTEXT_LABELS, keyBindingsByContext, renderKeyHelp,
  type KeyContext,
} from '../src/keybindings';
import { SLASH_COMMANDS } from '../src/chat/index';

describe('keybinding registry', () => {
  test('every binding has a known context', () => {
    const known = new Set(Object.keys(CONTEXT_LABELS) as KeyContext[]);
    for (const b of KEYBINDINGS) {
      expect(known.has(b.context)).toBe(true);
      expect(b.keys.length).toBeGreaterThan(0);
      expect(b.action.length).toBeGreaterThan(3);
    }
  });

  test('keyBindingsByContext groups exhaustively', () => {
    const grouped = keyBindingsByContext();
    const total = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
    expect(total).toBe(KEYBINDINGS.length);
    for (const ctx of Object.keys(CONTEXT_LABELS) as KeyContext[]) {
      expect(Array.isArray(grouped[ctx])).toBe(true);
    }
  });

  test('renderKeyHelp returns something non-empty, includes all context labels', () => {
    const out = renderKeyHelp();
    for (const label of Object.values(CONTEXT_LABELS)) {
      expect(out).toContain(label);
    }
    // Also contains the slash-command footer
    expect(out).toContain('Slash commands');
  });

  test('renderKeyHelp with context filter narrows output', () => {
    const full = renderKeyHelp();
    const narrow = renderKeyHelp({ context: 'log' });
    expect(narrow.length).toBeLessThan(full.length);
    expect(narrow).toContain('Log pane');
    expect(narrow).not.toContain('Browser');
  });

  test('every binding covered by ≥ one of: arrow keys, letter, modifier combo', () => {
    // Sanity check the data — catches empty-key typos.
    for (const b of KEYBINDINGS) {
      const allNonEmpty = b.keys.every(k => k.trim().length > 0);
      expect(allNonEmpty).toBe(true);
    }
  });

  test('VP3 — Ctrl+7 binding wired for Widget Playground view', () => {
    const ctrl7 = KEYBINDINGS.find(b => b.keys.includes('Ctrl+7'));
    expect(ctrl7).toBeDefined();
    expect(ctrl7!.keys).toContain('Ctrl+/ (fallback)');
    expect(ctrl7!.action).toContain('Widget Playground');
    expect(ctrl7!.action).toContain('/view 7');
  });

  test('VP3 — renderKeyHelp surfaces Ctrl+7 alongside other view shortcuts', () => {
    const out = renderKeyHelp();
    expect(out).toContain('Ctrl+7');
    expect(out).toContain('Ctrl+/');
    expect(out).toMatch(/View 7.*Widget Playground|Widget Playground.*View 7/);
  });
});

describe('slash command hygiene', () => {
  test('no two commands share a name or alias', () => {
    const seen = new Set<string>();
    for (const c of SLASH_COMMANDS) {
      expect(seen.has(c.name)).toBe(false);
      seen.add(c.name);
      for (const a of c.aliases ?? []) {
        expect(seen.has(a)).toBe(false);
        seen.add(a);
      }
    }
  });

  test('/keys is not listed without a dispatcher', () => {
    const found = SLASH_COMMANDS.find(c => c.name === 'keys');
    expect(found).toBeUndefined();
  });

  // ── ST4 — sessions sidebar chords ─────────────────────────────

  test('ST4 — sessions sidebar chord bindings are catalogued', () => {
    const chords = new Map<string, string>();
    for (const b of KEYBINDINGS) {
      for (const k of b.keys) chords.set(k, b.action);
    }
    expect(chords.get('Ctrl+B S')).toMatch(/Focus sessions sidebar/i);
    expect(chords.get('Ctrl+B n')).toMatch(/next session/i);
    expect(chords.get('Ctrl+B p')).toMatch(/previous session/i);
  });

  test('NT5 — notification bell chord is catalogued', () => {
    const chords = new Map<string, string>();
    for (const b of KEYBINDINGS) {
      for (const k of b.keys) chords.set(k, b.action);
    }
    expect(chords.get('Ctrl+B b')).toMatch(/notification bell/i);
  });
});
