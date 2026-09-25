import { afterEach, describe, expect, test } from 'bun:test';
import { promises as fsp, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  initPlanArtifact, loadPlanArtifact, loadPlanArtifactFromPath,
  planFilePathFor, planDir,
} from '../../src/plan-mode/index.js';

// Point HOME at a temp dir so the test's plan artifacts don't land
// in the user's ~/.monad/plans/. Restore after each test.
const prevHome = process.env.HOME;
const dirs: string[] = [];

function sandboxedHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'ce-pm-'));
  dirs.push(d);
  process.env.HOME = d;
  return d;
}

afterEach(() => {
  process.env.HOME = prevHome;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('plan artifact persistence', () => {
  test('initPlanArtifact writes a file with frontmatter + skeleton', async () => {
    const home = sandboxedHome();
    const path = await initPlanArtifact({ sessionId: 'abc', title: 'Fix auth bug' });
    expect(path).toBe(planFilePathFor('abc'));
    expect(path.startsWith(home)).toBe(true);

    const text = await fsp.readFile(path, 'utf-8');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain('sessionId: "abc"');
    expect(text).toContain('"Fix auth bug"');
    expect(text).toContain('phase: explore');
    expect(text).toContain('## Goal');
  });

  test('loadPlanArtifact round-trips the fields', async () => {
    sandboxedHome();
    await initPlanArtifact({ sessionId: 'abc', title: 'Title' });
    const art = await loadPlanArtifact('abc');
    expect(art).not.toBeNull();
    expect(art!.sessionId).toBe('abc');
    expect(art!.title).toBe('Title');
    expect(art!.phase).toBe('explore');
    expect(art!.body).toContain('## Goal');
  });

  test('loadPlanArtifact returns null for missing file', async () => {
    sandboxedHome();
    const art = await loadPlanArtifact('nope');
    expect(art).toBeNull();
  });

  test('loadPlanArtifactFromPath pulls sessionId from filename', async () => {
    sandboxedHome();
    const path = await initPlanArtifact({ sessionId: 'xyz', title: 'T' });
    const art = await loadPlanArtifactFromPath(path);
    expect(art?.sessionId).toBe('xyz');
  });

  test('parse falls back gracefully on artifacts without frontmatter', async () => {
    const home = sandboxedHome();
    const dir = planDir();
    await fsp.mkdir(dir, { recursive: true });
    const p = planFilePathFor('raw');
    await fsp.writeFile(p, '# Just a body\n', 'utf-8');
    const art = await loadPlanArtifact('raw');
    expect(art).not.toBeNull();
    expect(art!.body).toContain('Just a body');
  });
});
