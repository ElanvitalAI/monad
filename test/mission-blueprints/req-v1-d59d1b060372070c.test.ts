import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import blueprint, { createOpenPullRequestCountReportBlueprint } from '../../src/mission-blueprints/req-v1-d59d1b060372070c.js';
import { loadMissionBlueprint } from '../../src/mission-blueprints/loader.js';
import { judgeMissionRequests } from '../../src/mission-loop/judge.js';

const requestId = 'req:v1:d59d1b060372070c';
const capabilityId = 'report.openprcount';
const root = resolve(import.meta.dir, '../..');
const context = (authorityRoot: string) => ({ authorityRoot, capabilities: new Map(), signal: AbortSignal.timeout(30_000) });

describe('req:v1:d59d1b060372070c blueprint', () => {
  test('matches the authoritative frontmatter requirement', () => {
    const source = readFileSync(resolve(root, 'docs/mission-requests/req-v1-d59d1b060372070c.md'), 'utf8');
    expect(source).toContain(`id: ${requestId}`);
    expect(source).toContain(`requires: [${capabilityId}]`);
    expect(blueprint.id).toBe(requestId);
    expect(blueprint.requires.map(capability => capability.id)).toEqual([capabilityId]);
  });

  test('loads ready and is discovered by the judge through the request-id path convention', async () => {
    const loaded = await loadMissionBlueprint({
      authorityRoot: root,
      requestId,
      requestRequires: [{ id: capabilityId }],
      catalog: [{ id: capabilityId, async probe() { return { ok: true } as const; } }],
    });
    expect(loaded.status).toBe('ready');

    const judgment = judgeMissionRequests(root).judgments.find(candidate => candidate.file.endsWith('req-v1-d59d1b060372070c.md'));
    expect(judgment).toMatchObject({ status: 'blueprint-candidate', blueprintPath: resolve(root, 'src/mission-blueprints/req-v1-d59d1b060372070c.ts') });
  });

  test('reports the supplied open pull-request count from its authority root in one line', async () => {
    let observedRoot: string | undefined;
    const report = createOpenPullRequestCountReportBlueprint(authorityRoot => {
      observedRoot = authorityRoot;
      return '[{"number":7,"state":"OPEN"},{"number":8,"state":"OPEN"}]';
    });
    const result = await report.run(context('/authority/root') as never);
    expect(observedRoot).toBe('/authority/root');
    expect(result).toMatchObject({ ok: true, measured: { open: 2, root: '/authority/root' } });
    expect(result.body).toContain('열린 판 2건');
    expect(result.body).toContain('/authority/root');
    expect(result.body.split('\n')).toHaveLength(1);
  });

  test('degrades malformed or unreadable snapshots without emitting a multiline body', async () => {
    const malformed = createOpenPullRequestCountReportBlueprint(() => 'not json');
    const unreadable = createOpenPullRequestCountReportBlueprint(() => { throw new Error('read\nfailed'); });

    for (const report of [malformed, unreadable]) {
      const result = await report.run(context('/authority\nroot') as never);
      expect(result.ok).toBe(false);
      expect(result.measured.open).toBe('unmeasurable');
      expect(result.body).toContain('판정 불가');
      expect(result.body.split('\n')).toHaveLength(1);
    }
  });
});
