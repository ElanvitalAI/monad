import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistBlueprintBody, runCompositeCycle } from '../../src/mission-loop/composite-cycle.js';
import { runMissionRequestJudge } from '../../scripts/mission-request-judge.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function deliveryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mission-delivery-'));
  roots.push(root);
  return root;
}

describe('blueprint file delivery', () => {
  test('persists a non-empty body beneath the configured delivery root', () => {
    const root = deliveryRoot();
    const outcome = persistBlueprintBody('req:v1:delivery', '# Durable report', { resolveDeliveryRoot: () => root });
    expect(outcome).toMatchObject({ status: 'persisted', bytes: 16 });
    if (outcome.status !== 'persisted') throw new Error('expected persistence');
    expect(outcome.path).toBe(join(root, 'mission-delivery', 'req_v1_delivery.md'));
    expect(existsSync(outcome.path)).toBe(true);
    expect(readFileSync(outcome.path, 'utf8')).toBe('# Durable report');
  });

  test('returns failure without throwing when persistence fails', () => {
    const outcome = persistBlueprintBody('req:v1:delivery', 'BODY', {
      resolveDeliveryRoot: () => deliveryRoot(),
      persistBody: () => { throw new Error('READ_ONLY_ROOT'); },
    });
    expect(outcome).toEqual({ status: 'failed', reason: 'READ_ONLY_ROOT' });
  });

  test('judge tick distinguishes persisted and failed runtime file delivery', async () => {
    const root = deliveryRoot();
    mkdirSync(join(root, 'docs', 'mission-requests'), { recursive: true });
    const base = { requestId: 'req:v1:delivery', action: 'executed' as const, body: 'BODY', measured: {}, deliver: [] };
    const persisted = await runMissionRequestJudge(['--root', root, '--tick'], { runCompositeCycle: async () => ({ actions: [{ ...base, fileDelivery: { status: 'persisted', path: '/delivery/report.md', bytes: 4 } }] }) });
    const failed = await runMissionRequestJudge(['--root', root, '--tick'], { runCompositeCycle: async () => ({ actions: [{ ...base, fileDelivery: { status: 'failed', reason: 'READ_ONLY_ROOT' } }] }) });
    expect(persisted.at(-1)).toContain('file-delivery persisted');
    expect(failed.at(-1)).toContain('file-delivery failed · READ_ONLY_ROOT');
    expect(failed.at(-1)).not.toContain('no-delivery');
  });

  test('runCompositeCycle preserves execution data when body persistence fails', async () => {
    const root = deliveryRoot();
    mkdirSync(join(root, 'docs', 'mission-requests'), { recursive: true });
    const requestId = 'req:v1:delivery';
    writeFileSync(join(root, 'docs', 'mission-requests', 'request.md'), `---\nid: ${requestId}\nrequires: [alpha.beta]\n---\n`);
    const result = await runCompositeCycle(root, {
      judge: authorityRoot => ({ authorityRoot, requestCatalog: root, catalogStatus: 'present', requestsScanned: 1, invalidCount: 0, judgments: [{ file: 'request.md', status: 'blueprint-candidate', capabilityCount: 1, blueprintPath: 'candidate.ts' }] }),
      catalog: [{ id: 'alpha.beta', async probe() { return { ok: true } as const; } }],
      loadBlueprint: async () => ({ status: 'ready', path: 'candidate.ts', blueprint: { id: requestId, requires: [{ id: 'alpha.beta' }], produces: { kind: 'report', deliver: [] }, async run() { return { ok: true, body: 'BODY', measured: { count: 1 } }; } } }),
      resolveDeliveryRoot: () => root,
      persistBody: () => { throw new Error('READ_ONLY_ROOT'); },
    });
    expect(result.actions).toEqual([{ requestId, action: 'executed', body: 'BODY', measured: { count: 1 }, deliver: [], fileDelivery: { status: 'failed', reason: 'READ_ONLY_ROOT' } }]);
  });
});
