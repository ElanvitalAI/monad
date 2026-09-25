import { describe, expect, test } from 'bun:test';
import * as nodeFs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  createPublishArtifactStore,
  validateRelativeArtifactPath,
  isValidPublishId,
  PublishStoreError,
  PUBLISH_TTL_MS,
  type PublishArtifactFs,
} from './artifact-store.js';
import type { PublishId, PublishManifest, PublishTarget } from './types.js';

const ID_A = 'AAAAAAAAAAAAAAAAAAAAAA' as PublishId; // 22 chars
const ID_B = 'BBBBBBBBBBBBBBBBBBBBBB' as PublishId;

function makeManifest(
  id: PublishId,
  createdMs: number,
  targets: readonly PublishTarget[] = ['funnel'],
): PublishManifest {
  const targetMeta: Record<string, unknown> = {};
  for (const t of targets) {
    targetMeta[t] = {
      target: t,
      artifactPath: `targets/${t}/index.html`,
      origin: 'https://example.ts.net',
      url: `https://example.ts.net/d/${id}`,
    };
  }
  return {
    version: 1,
    id,
    createdAt: new Date(createdMs).toISOString(),
    expiresAt: new Date(createdMs + PUBLISH_TTL_MS).toISOString(),
    title: 'Test doc',
    description: 'desc',
    lang: 'ko',
    sourcePath: 'source.md',
    sourceSha256: 'deadbeef',
    targets: targetMeta as PublishManifest['targets'],
  };
}

function tmpRoot(): string {
  return nodeFs.mkdtempSync(path.join(os.tmpdir(), 'pub-store-'));
}

describe('validateRelativeArtifactPath', () => {
  test('accepts known private/public paths', () => {
    expect(() => validateRelativeArtifactPath('source.md')).not.toThrow();
    expect(() => validateRelativeArtifactPath('manifest.json')).not.toThrow();
    expect(() => validateRelativeArtifactPath('targets/funnel/index.html')).not.toThrow();
  });

  test('rejects absolute, traversal, backslash, NUL, unknown', () => {
    for (const bad of [
      '/etc/passwd',
      '../escape',
      'targets/../../x',
      'targets\\funnel\\index.html',
      'source.md\0',
      '',
      'unknown.txt',
      './source.md',
    ]) {
      expect(() => validateRelativeArtifactPath(bad)).toThrow(PublishStoreError);
    }
  });
});

describe('isValidPublishId', () => {
  test('accepts 22-char base64url, rejects others', () => {
    expect(isValidPublishId(ID_A)).toBe(true);
    expect(isValidPublishId('short')).toBe(false);
    expect(isValidPublishId('AAAAAAAAAAAAAAAAAAAAA')).toBe(false); // 21
    expect(isValidPublishId('AAAAAAAAAAAAAAAAAAAAA=')).toBe(false); // padding
    expect(isValidPublishId('AAAAAAAAAAAAAAAAAAAA/x')).toBe(false); // slash
  });
});

describe('commit + atomic publish', () => {
  test('commits and exposes only via valid manifest; boundaries preserved', () => {
    const root = tmpRoot();
    const store = createPublishArtifactStore({ root, now: () => 1000 });
    const m = makeManifest(ID_A, 1000);
    store.commit({ manifest: m, sourceMarkdown: '# hi', targets: { funnel: '<html>ok</html>' } });

    expect(store.readManifest(ID_A).id).toBe(ID_A);
    expect(store.readPublicArtifact(ID_A, 'funnel')).toBe('<html>ok</html>');

    const dir = path.join(root, 'docs', ID_A);
    expect(nodeFs.existsSync(path.join(dir, 'source.md'))).toBe(true);
    expect(nodeFs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
    expect(nodeFs.existsSync(path.join(dir, 'targets', 'funnel', 'index.html'))).toBe(true);
    const tmp = path.join(root, 'tmp');
    if (nodeFs.existsSync(tmp)) expect(nodeFs.readdirSync(tmp).length).toBe(0);
  });

  test('never overwrites an existing publish id (collision)', () => {
    const root = tmpRoot();
    const store = createPublishArtifactStore({ root, now: () => 1000 });
    const m = makeManifest(ID_A, 1000);
    store.commit({ manifest: m, sourceMarkdown: 'orig', targets: { funnel: 'orig-html' } });

    let err: unknown;
    try {
      store.commit({ manifest: m, sourceMarkdown: 'NEW', targets: { funnel: 'new-html' } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PublishStoreError);
    expect((err as PublishStoreError).detail.code).toBe('collision');
    expect(store.readPublicArtifact(ID_A, 'funnel')).toBe('orig-html');
    const src = nodeFs.readFileSync(path.join(root, 'docs', ID_A, 'source.md'), 'utf8');
    expect(src).toBe('orig');
  });

  test('rejects invalid publish id at commit', () => {
    const root = tmpRoot();
    const store = createPublishArtifactStore({ root });
    const bad = makeManifest('short' as PublishId, 1000);
    expect(() => store.commit({ manifest: bad, sourceMarkdown: 'x', targets: {} })).toThrow(
      PublishStoreError,
    );
  });
});

describe('partial write failure never exposes final artifact', () => {
  function failingFs(failOn: (p: string) => boolean): {
    fs: PublishArtifactFs;
    rmCalls: string[];
  } {
    const rmCalls: string[] = [];
    const fs: PublishArtifactFs = {
      mkdirSync: (p, o) => nodeFs.mkdirSync(p, o),
      writeFileSync: (p, b) => {
        if (failOn(p)) throw new Error(`inject write fail: ${p}`);
        nodeFs.writeFileSync(p, b);
      },
      readFileSync: (p, e) => nodeFs.readFileSync(p, e),
      existsSync: (p) => nodeFs.existsSync(p),
      readdirSync: (p) => nodeFs.readdirSync(p),
      renameSync: (a, b) => nodeFs.renameSync(a, b),
      rmSync: (p, o) => {
        rmCalls.push(p);
        nodeFs.rmSync(p, o);
      },
    };
    return { fs, rmCalls };
  }

  test('source write failure -> cleanup, no final dir', () => {
    const root = tmpRoot();
    const { fs, rmCalls } = failingFs((p) => p.endsWith('source.md'));
    const store = createPublishArtifactStore({ root, fs, now: () => 1000 });
    expect(() =>
      store.commit({ manifest: makeManifest(ID_A, 1000), sourceMarkdown: 'x', targets: { funnel: 'h' } }),
    ).toThrow();
    expect(nodeFs.existsSync(path.join(root, 'docs', ID_A))).toBe(false);
    expect(rmCalls.length).toBeGreaterThan(0);
  });

  test('target write failure -> cleanup, no final dir', () => {
    const root = tmpRoot();
    const { fs } = failingFs((p) => p.endsWith(path.join('funnel', 'index.html')));
    const store = createPublishArtifactStore({ root, fs, now: () => 1000 });
    expect(() =>
      store.commit({ manifest: makeManifest(ID_A, 1000), sourceMarkdown: 'x', targets: { funnel: 'h' } }),
    ).toThrow();
    expect(nodeFs.existsSync(path.join(root, 'docs', ID_A))).toBe(false);
  });

  test('manifest write failure -> cleanup, no final dir', () => {
    const root = tmpRoot();
    const { fs } = failingFs((p) => p.endsWith('manifest.json'));
    const store = createPublishArtifactStore({ root, fs, now: () => 1000 });
    expect(() =>
      store.commit({ manifest: makeManifest(ID_A, 1000), sourceMarkdown: 'x', targets: { funnel: 'h' } }),
    ).toThrow();
    expect(nodeFs.existsSync(path.join(root, 'docs', ID_A))).toBe(false);
  });

  test('rename failure -> cleanup staging, no final dir', () => {
    const root = tmpRoot();
    const rmCalls: string[] = [];
    const fs: PublishArtifactFs = {
      mkdirSync: (p, o) => nodeFs.mkdirSync(p, o),
      writeFileSync: (p, b) => nodeFs.writeFileSync(p, b),
      readFileSync: (p, e) => nodeFs.readFileSync(p, e),
      existsSync: (p) => nodeFs.existsSync(p),
      readdirSync: (p) => nodeFs.readdirSync(p),
      renameSync: () => {
        throw new Error('inject rename fail');
      },
      rmSync: (p, o) => {
        rmCalls.push(p);
        nodeFs.rmSync(p, o);
      },
    };
    const store = createPublishArtifactStore({ root, fs, now: () => 1000 });
    expect(() =>
      store.commit({ manifest: makeManifest(ID_A, 1000), sourceMarkdown: 'x', targets: { funnel: 'h' } }),
    ).toThrow();
    expect(nodeFs.existsSync(path.join(root, 'docs', ID_A))).toBe(false);
    expect(rmCalls.length).toBeGreaterThan(0);
  });
});

describe('restart recovery', () => {
  test('preserves valid committed docs and wipes tmp remnants', () => {
    const root = tmpRoot();
    const store = createPublishArtifactStore({ root, now: () => 1000 });
    store.commit({ manifest: makeManifest(ID_A, 1000), sourceMarkdown: 'x', targets: { funnel: 'h' } });

    const tmp = path.join(root, 'tmp');
    nodeFs.mkdirSync(path.join(tmp, `${ID_B}.leftover`), { recursive: true });
    nodeFs.writeFileSync(path.join(tmp, `${ID_B}.leftover`, 'source.md'), 'partial');

    const brokenDir = path.join(root, 'docs', ID_B);
    nodeFs.mkdirSync(brokenDir, { recursive: true });
    nodeFs.writeFileSync(path.join(brokenDir, 'source.md'), 'orphan');

    const store2 = createPublishArtifactStore({ root, now: () => 1000 });
    store2.recover();

    expect(store2.readManifest(ID_A).id).toBe(ID_A);
    expect(nodeFs.readdirSync(tmp).length).toBe(0);
    expect(nodeFs.existsSync(brokenDir)).toBe(false);
    expect(store2.list().map((d) => d.id)).toEqual([ID_A]);
  });
});

describe('expiry (30d) + deletion', () => {
  test('exact 30-day inclusive boundary', () => {
    const root = tmpRoot();
    const created = 1_000_000;
    let clock = created;
    const store = createPublishArtifactStore({ root, now: () => clock });
    store.commit({ manifest: makeManifest(ID_A, created), sourceMarkdown: 'x', targets: { funnel: 'h' } });

    clock = created + PUBLISH_TTL_MS - 1;
    expect(store.isExpired(ID_A)).toBe(false);
    expect(store.readPublicArtifact(ID_A, 'funnel')).toBe('h');

    clock = created + PUBLISH_TTL_MS; // inclusive boundary => expired
    expect(store.isExpired(ID_A)).toBe(true);
    let err: unknown;
    try {
      store.readPublicArtifact(ID_A, 'funnel');
    } catch (e) {
      err = e;
    }
    expect((err as PublishStoreError).detail.code).toBe('expired');
  });

  test('idempotent deletion', () => {
    const root = tmpRoot();
    const store = createPublishArtifactStore({ root, now: () => 1000 });
    store.commit({ manifest: makeManifest(ID_A, 1000), sourceMarkdown: 'x', targets: { funnel: 'h' } });
    store.delete(ID_A);
    expect(nodeFs.existsSync(path.join(root, 'docs', ID_A))).toBe(false);
    expect(() => store.delete(ID_A)).not.toThrow();
    let err: unknown;
    try {
      store.readManifest(ID_A);
    } catch (e) {
      err = e;
    }
    expect((err as PublishStoreError).detail.code).toBe('missing');
  });

  test('missing id read throws missing', () => {
    const root = tmpRoot();
    const store = createPublishArtifactStore({ root });
    let err: unknown;
    try {
      store.readManifest(ID_A);
    } catch (e) {
      err = e;
    }
    expect((err as PublishStoreError).detail.code).toBe('missing');
    expect(store.isExpired(ID_A)).toBe(true);
  });
});
