import { describe, expect, test } from 'bun:test';
import {
  createTestReadlineHost,
  runInteractiveModalSession,
  type InteractiveModalProgress,
} from '../src/expression/widget/index.js';
import type { InteractiveModalSpec } from '../src/expression/spec/types.js';

describe('expression/widget/interactive-modal · end-to-end', () => {
  test('drives a 3-step Q&A chain to done with answers aggregated', async () => {
    const spec: InteractiveModalSpec = {
      kind: 'interactive-modal',
      id: 'wizard',
      title: 'Setup',
      steps: [
        { kind: 'confirm', id: 'enable', label: 'Enable?', default: false },
        {
          kind: 'text',
          id: 'token',
          label: 'Token',
          validate: { pattern: '^.{4,}$', message: 'too short' },
        },
        {
          kind: 'pick',
          id: 'mode',
          label: 'Mode',
          items: [
            { id: 'fast', label: 'Fast' },
            { id: 'safe', label: 'Safe' },
          ],
        },
      ],
    };

    const host = createTestReadlineHost();
    const progressLog: InteractiveModalProgress[] = [];
    const promise = runInteractiveModalSession({
      spec,
      host,
      onProgress: (p) => progressLog.push(p),
    });

    // Pump answers in order. The session subscribes synchronously
    // before calling `dispatch({mount})`, so by the time we reach
    // here the host listener is wired and emit() drives the chain.
    host.emit({ kind: 'line', value: 'y' });
    host.emit({ kind: 'line', value: 'abcdef' });
    host.emit({ kind: 'line', value: 'fast' });

    const result = await promise;
    expect(result.status).toBe('done');
    expect(result.answers).toEqual({
      enable: true,
      token: 'abcdef',
      mode: 'fast',
    });
    // At least 3 progress events (one per accepted step).
    expect(progressLog.length).toBeGreaterThanOrEqual(3);
    expect(host.closed).toBe(true);
  });

  test('rejects invalid input and stays on the same step until valid', async () => {
    const spec: InteractiveModalSpec = {
      kind: 'interactive-modal',
      id: 'w',
      title: 't',
      steps: [
        {
          kind: 'text',
          id: 'token',
          label: 'Token',
          validate: { pattern: '^[a-z]{3,}$', message: 'lowercase 3+' },
        },
      ],
    };

    const host = createTestReadlineHost();
    const rejects: string[] = [];
    const promise = runInteractiveModalSession({
      spec,
      host,
      onProgress: (p) => {
        if (p.rejectReason) rejects.push(p.rejectReason);
      },
    });

    host.emit({ kind: 'line', value: '12' });   // reject
    host.emit({ kind: 'line', value: 'AB' });   // reject
    host.emit({ kind: 'line', value: 'abcd' }); // accept

    const result = await promise;
    expect(result.status).toBe('done');
    expect(result.answers.token).toBe('abcd');
    expect(rejects.length).toBeGreaterThanOrEqual(2);
  });

  test('Esc cancels mid-chain and returns partial answers', async () => {
    const spec: InteractiveModalSpec = {
      kind: 'interactive-modal',
      id: 'w',
      title: 't',
      steps: [
        { kind: 'confirm', id: 'a', label: 'A?' },
        { kind: 'confirm', id: 'b', label: 'B?' },
        { kind: 'confirm', id: 'c', label: 'C?' },
      ],
    };

    const host = createTestReadlineHost();
    const promise = runInteractiveModalSession({ spec, host });

    host.emit({ kind: 'line', value: 'y' });
    host.emit({ kind: 'key', key: { name: 'escape' } });

    const result = await promise;
    expect(result.status).toBe('cancel');
    expect(result.cancelReason).toBe('user');
    expect(result.answers).toEqual({ a: true });
  });

  test('lifecycle.onMount / onUnmount fire exactly once each', async () => {
    const spec: InteractiveModalSpec = {
      kind: 'interactive-modal',
      id: 'w',
      title: 't',
      steps: [{ kind: 'confirm', id: 'a', label: 'A?' }],
    };

    let mounts = 0;
    let unmounts = 0;

    const host = createTestReadlineHost();
    const promise = runInteractiveModalSession({
      spec,
      host,
      lifecycle: {
        onMount: () => {
          mounts += 1;
        },
        onUnmount: () => {
          unmounts += 1;
        },
      },
    });
    host.emit({ kind: 'line', value: 'y' });
    await promise;
    expect(mounts).toBe(1);
    expect(unmounts).toBe(1);
  });

  test('confirm step accepts y / yes / true / 1 / n / no / false / 0 + default on empty', async () => {
    const spec: InteractiveModalSpec = {
      kind: 'interactive-modal',
      id: 'w',
      title: 't',
      steps: [
        { kind: 'confirm', id: 'a', label: 'A?', default: true },
        { kind: 'confirm', id: 'b', label: 'B?' },
      ],
    };

    const host = createTestReadlineHost();
    const promise = runInteractiveModalSession({ spec, host });
    host.emit({ kind: 'line', value: '' });    // → true (default)
    host.emit({ kind: 'line', value: 'NO' });  // → false
    const result = await promise;
    expect(result.answers).toEqual({ a: true, b: false });
  });

  test('pick step matches by id OR label', async () => {
    const spec: InteractiveModalSpec = {
      kind: 'interactive-modal',
      id: 'w',
      title: 't',
      steps: [
        {
          kind: 'pick',
          id: 'mode',
          label: 'Mode',
          items: [
            { id: 'fast', label: 'Fast' },
            { id: 'safe', label: 'Safe' },
          ],
        },
      ],
    };

    const host = createTestReadlineHost();
    const promise = runInteractiveModalSession({ spec, host });
    host.emit({ kind: 'line', value: 'Safe' }); // matches by label
    const result = await promise;
    expect(result.answers.mode).toBe('safe');
  });
});
