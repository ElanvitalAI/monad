// ── OBSIDIAN_VAULT config tests ──
// `OBSIDIAN_VAULT` is read once at module load, so these tests
// exercise the default-value shape (env + fallback) rather than
// mutating process.env mid-run.

import { describe, test, expect } from 'bun:test';
import { homedir } from 'os';
import { join } from 'path';
import { OBSIDIAN_VAULT } from '../src/config.js';

describe('OBSIDIAN_VAULT', () => {
  test('is a non-empty absolute path', () => {
    expect(typeof OBSIDIAN_VAULT).toBe('string');
    expect(OBSIDIAN_VAULT.length).toBeGreaterThan(0);
    expect(OBSIDIAN_VAULT.startsWith('/')).toBe(true);
  });

  test('either honors $OBSIDIAN_VAULT or falls back to ~/Obsidian/ElanvitalAI', () => {
    const fromEnv = process.env.OBSIDIAN_VAULT;
    const fallback = join(homedir(), 'Obsidian', 'ElanvitalAI');
    expect(OBSIDIAN_VAULT).toBe(fromEnv || fallback);
  });
});
