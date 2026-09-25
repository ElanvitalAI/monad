// ── PX-7 P4: watcher tests ──

import { describe, test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startDeclarativeWatcher,
  WATCHER_DEFAULT_DEBOUNCE_MS,
} from '../src/plugin-declarative/watcher';

function scratchSources() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-watch-'));
  const user = join(dir, 'user');
  for (const k of ['agents', 'skills', 'missions', 'workflows', 'hooks', 'routes']) {
    mkdirSync(join(user, k), { recursive: true });
  }
  return { user };
}

async function wait(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms));
}

describe('PX-7 P4 — watcher basic', () => {
  test('fires onChange after debounce on file add', async () => {
    const s = scratchSources();
    const changes: string[] = [];
    const h = startDeclarativeWatcher({
      sources: s,
      debounceMs: 50,
      onChange: (r) => { changes.push(r); },
    });
    writeFileSync(join(s.user, 'agents', 'new.md'), '---\n---\n');
    await wait(150);
    h.dispose();
    expect(changes.length).toBeGreaterThan(0);
  });

  test('coalesces rapid events into one callback', async () => {
    const s = scratchSources();
    let fired = 0;
    const h = startDeclarativeWatcher({
      sources: s,
      debounceMs: 100,
      onChange: () => { fired++; },
    });
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(s.user, 'agents', `f${i}.md`), '');
    }
    await wait(250);
    h.dispose();
    expect(fired).toBe(1);
  });

  test('dispose stops future callbacks', async () => {
    const s = scratchSources();
    let fired = 0;
    const h = startDeclarativeWatcher({
      sources: s,
      debounceMs: 50,
      onChange: () => { fired++; },
    });
    h.dispose();
    writeFileSync(join(s.user, 'agents', 'late.md'), '');
    await wait(150);
    expect(fired).toBe(0);
  });

  test('state exposes watching count + pending flag', () => {
    const s = scratchSources();
    const h = startDeclarativeWatcher({
      sources: s,
      debounceMs: 50,
      onChange: () => {},
    });
    const st = h.state();
    expect(st.watching).toBeGreaterThanOrEqual(6);   // 6 kinds, no project source
    h.dispose();
  });

  test('hidden files (.foo.md) do not trigger onChange', async () => {
    const s = scratchSources();
    let fired = 0;
    const h = startDeclarativeWatcher({
      sources: s,
      debounceMs: 50,
      onChange: () => { fired++; },
    });
    writeFileSync(join(s.user, 'agents', '.hidden.md'), '');
    await wait(150);
    h.dispose();
    expect(fired).toBe(0);
  });

  test('catalog.json writes are ignored', async () => {
    const s = scratchSources();
    let fired = 0;
    const h = startDeclarativeWatcher({
      sources: s,
      debounceMs: 50,
      onChange: () => { fired++; },
    });
    // Simulate persistCatalog writing the sibling — should not
    // trigger because filename is 'catalog.json'. We write inside a
    // kind dir just to confirm filter path.
    writeFileSync(join(s.user, 'agents', 'catalog.json'), '{}');
    await wait(150);
    h.dispose();
    expect(fired).toBe(0);
  });

  test('default debounce constant is 5s', () => {
    expect(WATCHER_DEFAULT_DEBOUNCE_MS).toBe(5_000);
  });

  test('delete event triggers onChange', async () => {
    const s = scratchSources();
    const path = join(s.user, 'agents', 'tmp.md');
    writeFileSync(path, '');
    let fired = 0;
    const h = startDeclarativeWatcher({
      sources: s,
      debounceMs: 50,
      onChange: () => { fired++; },
    });
    unlinkSync(path);
    await wait(150);
    h.dispose();
    expect(fired).toBe(1);
  });
});
