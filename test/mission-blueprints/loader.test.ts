import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMissionBlueprint } from '../../src/mission-blueprints/loader.js';

const requestId = 'req:v1:0123456789abcdef';
const requiredCapability = 'analysis.valuechain';
const catalog = [{ id: requiredCapability, async probe() { return { ok: true } as const; } }];
const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = join(tmpdir(), `mission-blueprint-loader-${crypto.randomUUID()}`);
  roots.push(root);
  await mkdir(join(root, 'src', 'mission-blueprints'), { recursive: true });
  return root;
}

async function writeBlueprint(root: string, source: string, id = requestId): Promise<void> {
  await Bun.write(join(root, 'src', 'mission-blueprints', `${id.replace(/:/g, '-')}.ts`), source);
}

function blueprintSource(overrides = ''): string {
  return `export default {
    id: '${requestId}',
    requires: [{ id: '${requiredCapability}' }],
    produces: { kind: 'report', deliver: ['telegram'] },
    async run() { globalThis.__blueprintRuns = (globalThis.__blueprintRuns ?? 0) + 1; return { ok: true, body: 'done', measured: {} }; },
    ${overrides}
  };`;
}

async function load(root: string) {
  return loadMissionBlueprint({
    authorityRoot: root,
    requestId,
    requestRequires: [{ id: requiredCapability }],
    catalog,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  delete (globalThis as { __blueprintRuns?: number }).__blueprintRuns;
});

describe('mission blueprint loader', () => {
  test('distinguishes a missing blueprint file', async () => {
    const result = await load(await createRoot());
    expect(result.status).toBe('missing');
  });

  test('rejects an invalid request id before deriving a path or importing a module', async () => {
    const root = await createRoot();
    const escapedPath = join(root, 'src', 'escape.ts');
    await Bun.write(escapedPath, "globalThis.__blueprintRuns = (globalThis.__blueprintRuns ?? 0) + 1; export default {};");

    const result = await loadMissionBlueprint({
      authorityRoot: root,
      requestId: '../escape',
      requestRequires: [{ id: requiredCapability }],
      catalog,
    });

    expect(result).toEqual({ status: 'invalid', path: '', reason: 'invalid-request-id' });
    expect((globalThis as { __blueprintRuns?: number }).__blueprintRuns).toBeUndefined();
  });

  test('returns the valid default export unchanged without executing it', async () => {
    const root = await createRoot();
    await writeBlueprint(root, blueprintSource());

    const result = await load(root);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected a ready blueprint.');
    expect(result.blueprint.id).toBe(requestId);
    expect((globalThis as { __blueprintRuns?: number }).__blueprintRuns).toBeUndefined();
  });

  test('returns normal capability unavailability with its provider id and repair hint, while propagating probe exceptions', async () => {
    const root = await createRoot();
    await writeBlueprint(root, blueprintSource());
    const unavailable = { ok: false as const, reason: 'SOURCE_REASON', repairHint: { paths: ['repair/a.ts'], what: 'fix source' } };

    await expect(loadMissionBlueprint({
      authorityRoot: root,
      requestId,
      requestRequires: [{ id: requiredCapability }],
      catalog: [{ id: requiredCapability, async probe() { return unavailable; } }],
    })).resolves.toMatchObject({
      status: 'unavailable', capabilityId: requiredCapability, reason: 'SOURCE_REASON', repairHint: unavailable.repairHint,
    });

    await expect(loadMissionBlueprint({
      authorityRoot: root,
      requestId,
      requestRequires: [{ id: requiredCapability }],
      catalog: [{ id: requiredCapability, async probe() { throw new Error('PROBE_THROWN'); } }],
    })).rejects.toThrow('PROBE_THROWN');
  });

  test('rejects malformed imports, invalid default exports, ids, and schedule ownership without running', async () => {
    const importFailureRoot = await createRoot();
    await writeBlueprint(importFailureRoot, "throw new Error('malformed module');");
    expect(await load(importFailureRoot)).toMatchObject({ status: 'invalid', reason: 'module-import-failed' });

    const shapeFailureRoot = await createRoot();
    await writeBlueprint(shapeFailureRoot, 'export default { id: "req:v1:0123456789abcdef" };');
    expect(await load(shapeFailureRoot)).toMatchObject({ status: 'invalid', reason: 'invalid-blueprint-shape-or-id' });

    const idFailureRoot = await createRoot();
    await writeBlueprint(idFailureRoot, blueprintSource("id: 'analysis.valuechain',"));
    expect(await load(idFailureRoot)).toMatchObject({ status: 'invalid', reason: 'invalid-blueprint-shape-or-id' });

    const scheduleRoot = await createRoot();
    await writeBlueprint(scheduleRoot, blueprintSource("schedule: '0 * * * *',"));
    expect(await load(scheduleRoot)).toMatchObject({ status: 'invalid', reason: 'invalid-blueprint-shape-or-id' });
    expect((globalThis as { __blueprintRuns?: number }).__blueprintRuns).toBeUndefined();
  });

  test('rejects filename/request/blueprint id disagreement before capability checks', async () => {
    const root = await createRoot();
    await writeBlueprint(root, blueprintSource("id: 'req:v1:fedcba9876543210',"));

    expect(await load(root)).toMatchObject({ status: 'invalid', reason: 'request-id-mismatch' });
    expect((globalThis as { __blueprintRuns?: number }).__blueprintRuns).toBeUndefined();
  });

  test('requires the blueprint capability set to cover every request requirement', async () => {
    const root = await createRoot();
    await writeBlueprint(root, blueprintSource("requires: [],"));

    expect(await load(root)).toMatchObject({ status: 'invalid', reason: 'missing-request-capability' });
    expect((globalThis as { __blueprintRuns?: number }).__blueprintRuns).toBeUndefined();
  });

  test('uses the capability-id regex only for capability references and validates catalog membership last', async () => {
    const root = await createRoot();
    const malformedCapability = 'req:v1:0123456789abcdef';
    await writeBlueprint(root, blueprintSource(`requires: [{ id: '${malformedCapability}' }],`));
    const malformedResult = await loadMissionBlueprint({
      authorityRoot: root,
      requestId,
      requestRequires: [{ id: malformedCapability }],
      catalog,
    });
    expect(malformedResult).toMatchObject({ status: 'invalid', reason: 'unknown-or-invalid-capability' });

    const unknownCapabilityRoot = await createRoot();
    await writeBlueprint(unknownCapabilityRoot, blueprintSource("requires: [{ id: 'analysis.missing' }],"));
    const result = await loadMissionBlueprint({
      authorityRoot: unknownCapabilityRoot,
      requestId,
      requestRequires: [{ id: 'analysis.missing' }],
      catalog,
    });
    expect(result).toMatchObject({ status: 'invalid', reason: 'unknown-or-invalid-capability' });
    expect((globalThis as { __blueprintRuns?: number }).__blueprintRuns).toBeUndefined();
  });
});
