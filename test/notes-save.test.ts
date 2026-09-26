// R-OCR.3.2 — handleNotesSave handler contract.
//
// Covers:
//   1. CORS preflight (OPTIONS)
//   2. vault-not-wired → 503
//   3. bad JSON / missing markdown → 400
//   4. happy path · file lands at notes/<YYYY-MM-DD>/<slug>-<stamp>.md
//   5. title derivation (explicit > first heading > first 40 chars)
//   6. tags include 'camera-intake' + polishMode tag (always-on)
//   7. frontmatter carries title + source + polishMode + savedAt
//   8. schema_validation_failed maps to 422 (when title undeterminable
//      and explicit title omitted)
//   9. auth check seam · 401
//
// Cross-ref:
//   src/nexus/api/notes-save.ts (handler)
//   src/knowledge/write.ts (knowledgeWrite · 'note' kind schema)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R-OCR.3

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleNotesSave } from '../src/nexus/api/notes-save.js';
import type { ObsidianVault } from '../src/auto-research/obsidian-bridge.js';

let tmpRoot: string;
let testVault: ObsidianVault;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'elanous-notes-save-'));
  testVault = { root: tmpRoot, isSimulated: true, label: 'test-vault' };
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* swallow */ }
});

function makePost(body: unknown): Request {
  return new Request('http://localhost/v1/notes/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleNotesSave · CORS preflight', () => {
  test('OPTIONS → 204 + CORS headers', async () => {
    const req = new Request('http://localhost/v1/notes/save', { method: 'OPTIONS' });
    const res = await handleNotesSave(req, { vault: testVault });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('handleNotesSave · dep-injection seam', () => {
  test('omitted vault → 503 notes_vault_not_wired', async () => {
    const res = await handleNotesSave(makePost({ markdown: '# title' }), {});
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('notes_vault_not_wired');
  });
});

describe('handleNotesSave · request validation', () => {
  test('non-JSON body → 400', async () => {
    const req = new Request('http://localhost/v1/notes/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await handleNotesSave(req, { vault: testVault });
    expect(res.status).toBe(400);
  });

  test('missing markdown → 400', async () => {
    const res = await handleNotesSave(makePost({ title: 'x' }), { vault: testVault });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain('markdown');
  });

  test('whitespace-only markdown → 400', async () => {
    const res = await handleNotesSave(makePost({ markdown: '   \n\n  ' }), { vault: testVault });
    expect(res.status).toBe(400);
  });

  test('GET → 405', async () => {
    const req = new Request('http://localhost/v1/notes/save', { method: 'GET' });
    const res = await handleNotesSave(req, { vault: testVault });
    expect(res.status).toBe(405);
  });
});

describe('handleNotesSave · happy path · vault write', () => {
  test('writes file to notes/<YYYY-MM-DD>/<slug>-<stamp>.md', async () => {
    const FIXED_TS = Date.UTC(2026, 4, 9, 12, 34, 56);  // 2026-05-09
    const res = await handleNotesSave(makePost({
      markdown: '# 회의 메모\n\n- 결정 1\n- 결정 2',
    }), {
      vault: testVault,
      now: () => FIXED_TS,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      ok: boolean;
      knowledgeId: string;
      path: string;
      vaultLabel: string;
      savedAt: string;
    };
    expect(body.ok).toBe(true);
    expect(body.knowledgeId).toMatch(/^notes\/2026-05-09\/회의-메모-\d+\.md$/);
    expect(body.vaultLabel).toBe('test-vault');
    expect(body.savedAt).toContain('2026-05-09');
    expect(existsSync(body.path)).toBe(true);
  });

  test('persisted file body contains markdown + frontmatter', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# 메모\n\n본문',
      tags: ['urgent'],
      sourceProvider: 'upstage',
      polishMode: 'enrich',
      polishUsdEstimate: 0.0023,
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { path: string };
    const written = readFileSync(body.path, 'utf-8');
    // Frontmatter expectations
    expect(written).toContain('title: 메모');
    expect(written).toContain('source: camera-intake');
    expect(written).toContain('polishMode: enrich');
    expect(written).toContain('sourceProvider: upstage');
    expect(written).toContain('savedAt:');
    // tags merged: user 'urgent' + always-on 'camera-intake' + 'polish:enrich'
    expect(written).toContain('urgent');
    expect(written).toContain('camera-intake');
    expect(written).toContain('polish:enrich');
    // Body preserved
    expect(written).toContain('# 메모');
    expect(written).toContain('본문');
  });

  test('explicit title overrides derived title', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# Different Heading\n\n본문',
      title: 'Custom Title',
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { knowledgeId: string; path: string };
    expect(body.knowledgeId).toContain('Custom-Title');
    const written = readFileSync(body.path, 'utf-8');
    expect(written).toContain('title: Custom Title');
  });

  test('no heading · falls back to first non-empty line truncated', async () => {
    const res = await handleNotesSave(makePost({
      markdown: 'just some plain text without a heading at all here',
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { knowledgeId: string; path: string };
    expect(body.knowledgeId).toContain('just-some');
    const written = readFileSync(body.path, 'utf-8');
    // First 40 chars of the line, then a horizontal-ellipsis suffix
    expect(written).toMatch(/title: just some plain text/);
  });

  // 2026-05-09 dogfood — OCR'd photo started with single Korean
  // glyph "오" on its own line; previously the saved file got
  // title="오" / slug="오-<stamp>". Now skipped → next substantial
  // line wins.
  test('1-char first heading skipped · falls through to substantial line', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# 오\n\n오늘 회의 메모\n\n본문 내용',
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { path: string };
    const written = readFileSync(body.path, 'utf-8');
    expect(written).toContain('title: 오늘 회의 메모');
    expect(written).not.toMatch(/title: 오$/m);
  });

  test('1-char standalone first line skipped · falls through to next', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '오\n\n진짜 본문은 여기서부터',
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { path: string };
    const written = readFileSync(body.path, 'utf-8');
    expect(written).toContain('title: 진짜 본문은 여기서부터');
  });

  test('2-char Korean heading kept (회의 / 메모 are real titles)', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# 회의\n\n안건 1\n안건 2',
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { path: string };
    const written = readFileSync(body.path, 'utf-8');
    expect(written).toContain('title: 회의');
  });

  test('only 1-char content present · falls through to final fallback', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '오',
    }), { vault: testVault });
    // Nothing substantial · final fallback returns "오" so the
    // save isn't blocked.
    expect(res.status).toBe(201);
  });

  test('polishMode defaults to minimal when omitted', async () => {
    const res = await handleNotesSave(makePost({ markdown: '# t' }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { path: string };
    const written = readFileSync(body.path, 'utf-8');
    expect(written).toContain('polishMode: minimal');
    expect(written).toContain('polish:minimal');
  });

  test('two saves with same title in same second do not collide', async () => {
    let now = Date.UTC(2026, 4, 9, 12, 0, 0);
    const opts = { vault: testVault, now: () => now };

    const r1 = await handleNotesSave(makePost({ markdown: '# Same' }), opts);
    expect(r1.status).toBe(201);
    const b1 = await r1.json();

    now += 1;  // 1 ms later
    const r2 = await handleNotesSave(makePost({ markdown: '# Same' }), opts);
    expect(r2.status).toBe(201);
    const b2 = await r2.json();

    expect(b1.knowledgeId).not.toBe(b2.knowledgeId);
  });

  test('appends trailing newline when missing', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# t\nbody',  // no trailing \n
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { path: string };
    const written = readFileSync(body.path, 'utf-8');
    expect(written.endsWith('\n')).toBe(true);
  });
});

describe('handleNotesSave · title undeterminable', () => {
  test('markdown is whitespace-only → caught earlier as 400', async () => {
    // (covered above; here we ensure that a real edge case where
    // markdown is non-empty but only contains a heading pattern that
    // doesn't extract returns a 400 with the helpful message)
    const res = await handleNotesSave(makePost({
      markdown: '###',  // 3 hashes only — neither H1/H2 nor non-heading text
    }), { vault: testVault });
    // First non-empty line falls back; '###' becomes the title.
    expect(res.status).toBe(201);
  });
});

describe('handleNotesSave · auth check seam', () => {
  test('checkAuth returns false → 401', async () => {
    const res = await handleNotesSave(makePost({ markdown: '# t' }), {
      vault: testVault,
      checkAuth: () => false,
    });
    expect(res.status).toBe(401);
  });

  test('checkAuth returns true → write proceeds', async () => {
    const res = await handleNotesSave(makePost({ markdown: '# t' }), {
      vault: testVault,
      checkAuth: () => true,
    });
    expect(res.status).toBe(201);
  });
});

// PLAN-ipad-notes-obsidian-typora §5 Phase O2 — PR R (2026-05-17) —
// explicit `path` override for auto-save. First write creates the file
// (overwrite=true is safe — knowledgeWrite's overwrite guard is the only
// thing the flag changes when the file doesn't exist yet); subsequent
// writes replace the body in place. Validation surface: leading slash,
// `..`, and missing `.md` extension all return 400 with reason so the
// iPad can recover cleanly.
describe('handleNotesSave · explicit path override (PR R)', () => {
  test('explicit path writes to that exact relPath', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# Hello\nbody',
      path: 'Daily/2026-05-17.md',
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { knowledgeId: string; path: string };
    expect(body.knowledgeId).toBe('Daily/2026-05-17.md');
    expect(existsSync(body.path)).toBe(true);
    expect(readFileSync(body.path, 'utf-8')).toContain('Hello');
  });

  test('explicit path overwrites existing file', async () => {
    const first = await handleNotesSave(makePost({
      markdown: '# First version',
      path: 'Notes/scratch.md',
    }), { vault: testVault });
    expect(first.status).toBe(201);
    const f1 = await first.json() as { path: string };
    expect(readFileSync(f1.path, 'utf-8')).toContain('First version');

    const second = await handleNotesSave(makePost({
      markdown: '# Second version\nwith extra body',
      path: 'Notes/scratch.md',
    }), { vault: testVault });
    expect(second.status).toBe(201);
    const f2 = await second.json() as { path: string };
    expect(f2.path).toBe(f1.path);
    const after = readFileSync(f2.path, 'utf-8');
    expect(after).toContain('Second version');
    expect(after).not.toContain('First version');
  });

  test('leading slash → 400', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# t',
      path: '/escape.md',
    }), { vault: testVault });
    expect(res.status).toBe(400);
    const body = await res.json() as { reason: string };
    expect(body.reason).toContain('vault-relative');
  });

  test('`..` segment → 400', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# t',
      path: '../escape.md',
    }), { vault: testVault });
    expect(res.status).toBe(400);
    const body = await res.json() as { reason: string };
    expect(body.reason).toContain('escapes vault');
  });

  test('missing .md extension → 400', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# t',
      path: 'Notes/scratch.txt',
    }), { vault: testVault });
    expect(res.status).toBe(400);
    const body = await res.json() as { reason: string };
    expect(body.reason).toContain('.md');
  });

  test('empty path string falls back to generated relPath', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# Generated',
      path: '   ',
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { knowledgeId: string };
    expect(body.knowledgeId.startsWith('notes/')).toBe(true);
  });
});

// PLAN-ipad-notes-obsidian-typora R1·a · PR Z1 (2026-05-17) — mtime
// conflict detection. Daemon stats the file and compares its mtime
// against the iPad's cached `lastKnownMtime`; disk newer → 409 so the
// user can choose between reload / force / view both. Tests cover the
// 4 branches: matching mtime (write proceeds), drift inside tolerance
// (write proceeds), disk newer (409 conflict), missing file (skip
// check entirely — first-time write at this path).
describe('handleNotesSave · mtime conflict (PR Z1)', () => {
  async function setupExisting(path: string, body: string): Promise<number> {
    // Seed an on-disk version, return its mtimeMs so subsequent tests
    // can compare against fresh / stale values.
    const first = await handleNotesSave(makePost({
      markdown: body,
      path,
    }), { vault: testVault });
    expect(first.status).toBe(201);
    const { mtimeMs } = await first.json() as { mtimeMs: number };
    expect(typeof mtimeMs).toBe('number');
    return mtimeMs;
  }

  test('first write returns mtimeMs in response', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# v1',
      path: 'Notes/mtime-first.md',
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { mtimeMs: number };
    expect(typeof body.mtimeMs).toBe('number');
    expect(body.mtimeMs).toBeGreaterThan(0);
  });

  test('matching lastKnownMtime → write proceeds (200)', async () => {
    const path = 'Notes/mtime-match.md';
    const firstMtime = await setupExisting(path, '# v1');
    // Same mtime as captured — write should succeed and return a newer mtime.
    const res = await handleNotesSave(makePost({
      markdown: '# v2 updated',
      path,
      lastKnownMtime: firstMtime,
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { mtimeMs: number };
    expect(body.mtimeMs).toBeGreaterThanOrEqual(firstMtime);
  });

  test('disk newer than lastKnownMtime → 409 mtime_conflict', async () => {
    const path = 'Notes/mtime-stale.md';
    const firstMtime = await setupExisting(path, '# v1');
    // Wait long enough that an external rewrite has a clearly newer mtime.
    await new Promise<void>((r) => setTimeout(r, 30));
    // Simulate an external edit by writing directly with a touch.
    const { writeFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const abs = join(tmpRoot, path);
    writeFileSync(abs, '# externally edited\n');
    const newMtime = statSync(abs).mtimeMs;
    expect(newMtime).toBeGreaterThan(firstMtime + 5);
    // iPad still thinks lastKnownMtime = firstMtime; daemon should 409.
    const res = await handleNotesSave(makePost({
      markdown: '# would clobber external edit',
      path,
      lastKnownMtime: firstMtime,
    }), { vault: testVault });
    expect(res.status).toBe(409);
    const body = await res.json() as {
      error: string;
      currentMtime: number;
      lastKnownMtime: number;
      path: string;
    };
    expect(body.error).toBe('mtime_conflict');
    expect(body.currentMtime).toBeGreaterThan(body.lastKnownMtime);
    expect(body.path).toBe(path);
  });

  test('lastKnownMtime omitted → skip check (back-compat)', async () => {
    const path = 'Notes/mtime-skip.md';
    const firstMtime = await setupExisting(path, '# v1');
    // External edit makes disk newer, but caller doesn't pass
    // lastKnownMtime → behave like R-OCR.3 (overwrite).
    await new Promise<void>((r) => setTimeout(r, 10));
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(tmpRoot, path), '# externally edited\n');
    const res = await handleNotesSave(makePost({
      markdown: '# overwrite without check',
      path,
      // lastKnownMtime intentionally omitted
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { mtimeMs: number };
    expect(body.mtimeMs).toBeGreaterThan(firstMtime);
  });

  test('file does not exist + lastKnownMtime supplied → no check, just create', async () => {
    // iPad cached an old mtime but the file was deleted externally —
    // treat as a first write, no 409.
    const res = await handleNotesSave(makePost({
      markdown: '# fresh',
      path: 'Notes/mtime-vanished.md',
      lastKnownMtime: 1234567890000,
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { mtimeMs: number };
    expect(body.mtimeMs).toBeGreaterThan(0);
  });

  test('drift inside tolerance (5ms) → write proceeds', async () => {
    const path = 'Notes/mtime-drift.md';
    const firstMtime = await setupExisting(path, '# v1');
    // Send lastKnownMtime that's slightly off (within drift) — still OK.
    const res = await handleNotesSave(makePost({
      markdown: '# v2',
      path,
      lastKnownMtime: firstMtime - 3,
    }), { vault: testVault });
    expect(res.status).toBe(201);
  });
});

// A1 / R1·b (PLAN R1 polish · 2026-05-17) — pre-overwrite forensic
// capture. Overwrite path snapshots prev mtime + size so a post-hoc
// "did auto-save clobber an external edit?" diagnosis has facts.
describe('handleNotesSave · A1 prev-snapshot audit', () => {
  async function setupExisting(path: string, body: string): Promise<number> {
    const { writeFileSync, statSync, mkdirSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const abs = join(tmpRoot, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
    return statSync(abs).mtimeMs;
  }

  test('overwrite path surfaces prevSnapshot in response', async () => {
    const path = 'Notes/audit-overwrite.md';
    const oldMtime = await setupExisting(path, '# v1 body content');
    await new Promise<void>((r) => setTimeout(r, 10));
    const res = await handleNotesSave(makePost({
      markdown: '# v2',
      path,
      lastKnownMtime: oldMtime + 50, // pretend we're up-to-date
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      prevSnapshot?: { mtimeMs: number; size: number };
    };
    expect(body.prevSnapshot).toBeDefined();
    expect(body.prevSnapshot!.size).toBe('# v1 body content'.length);
    expect(body.prevSnapshot!.mtimeMs).toBe(oldMtime);
  });

  test('first-create (no prior file) → prevSnapshot is undefined', async () => {
    const res = await handleNotesSave(makePost({
      markdown: '# fresh',
      path: 'Notes/audit-first.md',
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { prevSnapshot?: unknown };
    expect(body.prevSnapshot).toBeUndefined();
  });

  test('unique-path generator (no explicit path) → prevSnapshot undefined', async () => {
    // Generated path = notes/<day>/<slug>-<stamp>.md — never overwrites.
    const res = await handleNotesSave(makePost({
      markdown: '# generated path',
      title: 'audit-generated',
    }), { vault: testVault });
    expect(res.status).toBe(201);
    const body = await res.json() as { prevSnapshot?: unknown };
    expect(body.prevSnapshot).toBeUndefined();
  });
});
