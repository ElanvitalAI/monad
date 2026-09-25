// ── Presentation P5a · scenario catalog loader ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadScenarioCatalog } from '../../src/scenarios/catalog.js';

let tmp = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'p5a-scenarios-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function write(name: string, content: string): void {
  writeFileSync(join(tmp, name), content, 'utf8');
}

describe('loadScenarioCatalog · happy path', () => {
  test('loads every YAML file · sorted by filename', async () => {
    write('b-second.yaml', 'id: second\ntitle: Second\nlayout: []\n');
    write('a-first.yaml', 'id: first\ntitle: First\nlayout: []\n');
    const cat = await loadScenarioCatalog(tmp);
    expect(cat.errors).toEqual([]);
    const ids = [...cat.scenarios.keys()];
    expect(ids).toEqual(['first', 'second']);
  });

  test('returns ScenarioDef with optional description + meta', async () => {
    write('a.yaml', [
      'id: one',
      'title: One',
      'description: An example',
      'meta:',
      '  tags: [demo]',
      'layout:',
      '  - widget: log',
    ].join('\n'));
    const cat = await loadScenarioCatalog(tmp);
    const def = cat.scenarios.get('one');
    expect(def?.description).toBe('An example');
    expect(def?.meta?.tags).toEqual(['demo']);
  });

  test('supports both .yaml and .yml extensions', async () => {
    write('a.yaml', 'id: a\ntitle: A\nlayout: []\n');
    write('b.yml', 'id: b\ntitle: B\nlayout: []\n');
    const cat = await loadScenarioCatalog(tmp);
    expect(cat.scenarios.size).toBe(2);
  });
});

describe('loadScenarioCatalog · error handling', () => {
  test('missing directory → empty catalog with one error', async () => {
    const cat = await loadScenarioCatalog(join(tmp, 'does-not-exist'));
    expect(cat.scenarios.size).toBe(0);
    expect(cat.errors).toHaveLength(1);
    expect(cat.errors[0]?.message).toContain('read directory');
  });

  test('malformed YAML → error but other files load', async () => {
    write('bad.yaml', 'id: [broken\n');   // unterminated flow sequence
    write('good.yaml', 'id: ok\ntitle: OK\nlayout: []\n');
    const cat = await loadScenarioCatalog(tmp);
    expect(cat.scenarios.has('ok')).toBe(true);
    expect(cat.errors.some((e) => e.message.includes('YAML parse'))).toBe(true);
  });

  test('missing id → rejected with clear message', async () => {
    write('no-id.yaml', 'title: Missing\nlayout: []\n');
    const cat = await loadScenarioCatalog(tmp);
    expect(cat.scenarios.size).toBe(0);
    expect(cat.errors[0]?.message).toContain('`id`');
  });

  test('missing title → rejected', async () => {
    write('no-title.yaml', 'id: x\nlayout: []\n');
    const cat = await loadScenarioCatalog(tmp);
    expect(cat.scenarios.size).toBe(0);
    expect(cat.errors[0]?.message).toContain('`title`');
  });

  test('missing layout → rejected', async () => {
    write('no-layout.yaml', 'id: x\ntitle: X\n');
    const cat = await loadScenarioCatalog(tmp);
    expect(cat.scenarios.size).toBe(0);
    expect(cat.errors[0]?.message).toContain('`layout`');
  });
});

describe('loadScenarioCatalog · duplicate handling', () => {
  test('last-wins (default) · later file overrides earlier', async () => {
    write('a.yaml', 'id: same\ntitle: First\nlayout: []\n');
    write('b.yaml', 'id: same\ntitle: Second\nlayout: []\n');
    const cat = await loadScenarioCatalog(tmp);
    expect(cat.scenarios.get('same')?.title).toBe('Second');
    expect(cat.errors.some((e) => e.message.includes('duplicate'))).toBe(true);
  });

  test('strict mode · first-wins · later file rejected', async () => {
    write('a.yaml', 'id: same\ntitle: First\nlayout: []\n');
    write('b.yaml', 'id: same\ntitle: Second\nlayout: []\n');
    const cat = await loadScenarioCatalog(tmp, { onDuplicate: 'strict' });
    expect(cat.scenarios.get('same')?.title).toBe('First');
    expect(cat.errors.some((e) => e.message.includes('strict'))).toBe(true);
  });
});
