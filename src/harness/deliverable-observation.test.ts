import { describe, expect, test } from 'bun:test';
import type { DeployVerifyResult } from './browser-verify.js';
import { observeDeliverables } from './deliverable-observation.js';
import { triageRun } from '../self-dev/orchestrate.js';
import { debug } from '../debug/log.js';
import type { LogRecord } from '../mss/logging/record.js';

const result = (overrides: Partial<DeployVerifyResult>): DeployVerifyResult => ({
  ok: true,
  url: 'https://example.test',
  findings: [],
  ...overrides,
});

describe('observeDeliverables', () => {
  test('confirmed finding is preserved and drives a repairable triage classification', async () => {
    const observed = await observeDeliverables([{ taskId: 'confirmed', target: 'https://example.test/confirmed' }], {
      verify: async () => result({
        structuredFindings: [{ kind: 'empty-body', certainty: 'confirmed', message: 'body missing' }],
      }),
    });

    const triage = triageRun([], observed.deployFindings);
    expect(triage.deliverableUnmeasured).toBe(false);
    expect(triage.repairable).toEqual(['confirmed']);
    expect(triage.classifications.find(({ taskId }) => taskId === 'confirmed')?.errorCode).toStartWith('web|empty-body|');
    expect(observed.deployFindings.get('confirmed')?.findings?.[0]?.certainty).toBe('confirmed');
  });

  test('logs each measured target with its structured finding outcome', async () => {
    const records: LogRecord[] = [];
    const off = debug.registerSink({
      name: 'deliverable-observation-log-capture',
      emit: (record) => { if (record.category === 'harness.deliverable-observation') records.push(record); },
    });
    try {
      await observeDeliverables([{ taskId: 'logged', target: 'https://example.test/logged' }], {
        verify: async () => result({
          structuredFindings: [{ kind: 'empty-body', certainty: 'confirmed', message: 'body missing' }],
        }),
      });
      expect(records).toHaveLength(1);
      expect(records[0]!.event).toBe('measured');
      expect(records[0]!.data).toMatchObject({
        taskId: 'logged',
        target: 'https://example.test/logged',
        findings: [{ kind: 'empty-body', certainty: 'confirmed', message: 'body missing' }],
        unmeasured: [],
      });
    } finally {
      off();
    }
  });

  test('suspected finding remains measured but is not repairable', async () => {
    const observed = await observeDeliverables([{ taskId: 'suspected', target: 'https://example.test/suspected' }], {
      verify: async () => result({
        structuredFindings: [{ kind: 'empty-body', certainty: 'suspected', message: 'body may be missing' }],
      }),
    });

    expect(observed.deployFindings.get('suspected')?.findings?.[0]?.certainty).toBe('suspected');
    expect(triageRun([], observed.deployFindings).repairable).toEqual([]);
  });

  test('fully measured clean result remains an empty-findings Map entry', async () => {
    const observed = await observeDeliverables([{ taskId: 'clean', target: 'https://example.test/clean' }], {
      verify: async () => result({}),
    });

    expect(observed.deployFindings.get('clean')).toEqual({ target: 'https://example.test/clean' });
    expect(observed.unmeasured).toEqual([]);
  });

  test('forwards the selected backend unchanged to the verifier seam', async () => {
    let backend: 'cdp' | 'aside' | undefined;
    await observeDeliverables([{ taskId: 'aside', target: 'https://example.test/aside' }], {
      backend: 'aside',
      verify: async (_target, deps) => {
        backend = deps?.backend;
        return result({ unmeasured: ['javascript-errors'] });
      },
    });

    expect(backend).toBe('aside');
  });

  test('signal-level javascript-errors miss preserves confirmed findings alongside its distinct status', async () => {
    const observed = await observeDeliverables([{ taskId: 'partial-broken', target: 'https://example.test/partial-broken' }], {
      verify: async () => result({
        structuredFindings: [{ kind: 'empty-body', certainty: 'confirmed', message: 'body missing' }],
        unmeasured: ['javascript-errors'],
      }),
    });

    expect(observed.deployFindings.has('partial-broken')).toBe(false);
    expect(observed.unmeasured).toEqual([{
      taskId: 'partial-broken',
      kind: 'signal-unmeasured',
      reason: 'javascript-errors',
    }]);
    expect(triageRun([], observed.deployFindings, true).repairable).toEqual([]);
  });

  test('signal-level javascript-errors miss preserves an observed empty findings entry', async () => {
    const observed = await observeDeliverables([{ taskId: 'partial-clean', target: 'https://example.test/partial-clean' }], {
      verify: async () => result({ unmeasured: ['javascript-errors'] }),
    });

    expect(observed.deployFindings.has('partial-clean')).toBe(false);
    expect(observed.unmeasured).toEqual([{
      taskId: 'partial-clean',
      kind: 'signal-unmeasured',
      reason: 'javascript-errors',
    }]);
  });

  test('no-cdp is unmeasured rather than an empty-findings measurement', async () => {
    const observed = await observeDeliverables([{ taskId: 'no-cdp', target: 'https://example.test/no-cdp' }], {
      verify: async () => result({ ok: false, skipped: 'no-cdp' }),
    });

    expect(observed.deployFindings.has('no-cdp')).toBe(false);
    expect(observed.unmeasured).toEqual([{
      taskId: 'no-cdp',
      kind: 'deliverable-unobserved',
      reason: 'no-cdp',
    }]);
  });

  test('legacy failed findings without certainty remain unmeasured rather than clean', async () => {
    const observed = await observeDeliverables([{ taskId: 'legacy-failure', target: 'https://example.test/legacy-failure' }], {
      verify: async () => result({ ok: false, findings: ['legacy renderer failed'] }),
    });

    expect(observed.deployFindings.has('legacy-failure')).toBe(false);
    expect(observed.unmeasured).toEqual([{
      taskId: 'legacy-failure',
      kind: 'deliverable-unobserved',
      reason: 'legacy-findings',
    }]);
    expect(triageRun([], observed.deployFindings).repairable).toEqual([]);
  });

  test('legacy-only findings discard concurrent signal misses as deliverable-unobserved', async () => {
    const observed = await observeDeliverables([{ taskId: 'legacy-partial', target: 'https://example.test/legacy-partial' }], {
      verify: async () => result({
        ok: false,
        findings: ['legacy renderer failed'],
        unmeasured: ['javascript-errors'],
      }),
    });

    expect(observed.deployFindings.has('legacy-partial')).toBe(false);
    expect(observed.unmeasured).toEqual([{
      taskId: 'legacy-partial',
      kind: 'deliverable-unobserved',
      reason: 'legacy-findings',
    }]);
  });

  test('mixed measurements only repair confirmed tasks and retain unmeasured tasks separately', async () => {
    const observed = await observeDeliverables([
      { taskId: 'broken', target: 'https://example.test/broken' },
      { taskId: 'unavailable', target: 'https://example.test/unavailable' },
    ], {
      verify: async (target) => target.endsWith('/broken')
        ? result({ structuredFindings: [{ kind: 'empty-title', certainty: 'confirmed', message: 'title missing' }] })
        : result({ ok: false, skipped: 'no-cdp' }),
    });

    expect(triageRun([], observed.deployFindings).repairable).toEqual(['broken']);
    expect(observed.unmeasured).toEqual([{
      taskId: 'unavailable',
      kind: 'deliverable-unobserved',
      reason: 'no-cdp',
    }]);
  });

  test('verifier exception retains the value without exposing its message', async () => {
    const error = new Error('secret verifier details');
    const observed = await observeDeliverables([{ taskId: 'throws', target: 'https://example.test/throws' }], {
      verify: async () => { throw error; },
    });

    expect(observed.deployFindings.has('throws')).toBe(false);
    expect(observed.unmeasured).toEqual([{
      taskId: 'throws',
      kind: 'deliverable-unobserved',
      reason: 'verify-exception',
      error,
    }]);
  });
});
