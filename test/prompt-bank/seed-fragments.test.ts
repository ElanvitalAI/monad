// ── AU7 — seed-fragments (idempotent boot-time installer) ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPromptBankStore } from '../../src/prompt-bank/store.js';
import { seedAu7Fragments, AU7_SEED_IDS } from '../../src/prompt-bank/seed-fragments.js';

describe('seedAu7Fragments', () => {
  let dir: string;
  let store: ReturnType<typeof openPromptBankStore>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'au7-seed-'));
    store = openPromptBankStore(join(dir, 'bank.db'));
  });

  afterEach(() => {
    try { store.close?.(); } catch { /* ignore */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('first run creates all seed fragments', () => {
    const res = seedAu7Fragments(store);
    expect(res.created).toBe(AU7_SEED_IDS.length);
    expect(res.updated).toBe(0);
    expect(res.unchanged).toBe(0);
  });

  test('second run with identical seed → all unchanged', () => {
    seedAu7Fragments(store);
    const res = seedAu7Fragments(store);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(0);
    expect(res.unchanged).toBe(AU7_SEED_IDS.length);
  });

  test('seed fragments have AU7 triggers wired', () => {
    seedAu7Fragments(store);
    for (const id of AU7_SEED_IDS) {
      const f = store.get(id);
      expect(f).not.toBeNull();
      expect(f!.owner).toBe('monad');
      expect(f!.targetSlot).toBe('system');
      expect(f!.enabled).toBe(true);
      const triggerIntent = f!.triggers.intent as string[] | undefined;
      expect(Array.isArray(triggerIntent)).toBe(true);
      expect(['ambiguous', 'destructive', 'multi-file']).toContain(triggerIntent![0]!);
    }
  });

  test('post-seed store returns fragments via search on tag', () => {
    seedAu7Fragments(store);
    const ambiguous = store.search({ tags: ['ambiguous'] });
    expect(ambiguous.length).toBeGreaterThanOrEqual(1);
    const destructive = store.search({ tags: ['destructive'] });
    expect(destructive.length).toBeGreaterThanOrEqual(1);
    const multi = store.search({ tags: ['multi-file'] });
    expect(multi.length).toBeGreaterThanOrEqual(1);
  });

  test('user disabling the fragment is respected — seed does not re-enable', () => {
    seedAu7Fragments(store);
    const id = AU7_SEED_IDS[0]!;
    store.setEnabled(id, false);
    // Re-run seeder. The content is unchanged, so update path is
    // not hit; unchanged count should include this fragment, and
    // enabled flag stays false.
    const res = seedAu7Fragments(store);
    const after = store.get(id);
    expect(after!.enabled).toBe(false);
    // It's in unchanged bucket because content+priority+enabled all match.
    expect(res.unchanged).toBeGreaterThanOrEqual(1);
  });
});
