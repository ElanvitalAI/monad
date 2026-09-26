import { describe, expect, test } from 'bun:test';
import {
  widgetIO,
  buildWizardSpec,
} from '../src/onboarding/widget-impl.js';
import type { TestReadlineHost } from '../src/expression/widget/index.js';

const asTestHost = (h: unknown): TestReadlineHost => h as TestReadlineHost;

describe('onboarding/widget-impl · WizardIO compatibility', () => {
  test('widgetIO() satisfies the WizardIO interface', () => {
    const io = widgetIO();
    expect(typeof io.ask).toBe('function');
    expect(typeof io.askSecret).toBe('function');
    expect(typeof io.print).toBe('function');
    expect(typeof io.close).toBe('function');
    io.close();
  });

  test('ask() resolves with the next emitted line', async () => {
    const io = widgetIO();
    const promise = io.ask('Pick:');
    asTestHost(io.__host).emit({ kind: 'line', value: '  hello  ' });
    const result = await promise;
    expect(result).toBe('hello');
    io.close();
  });

  test('lines emitted before ask() are queued + replayed', async () => {
    const io = widgetIO();
    asTestHost(io.__host).emit({ kind: 'line', value: 'first' });
    asTestHost(io.__host).emit({ kind: 'line', value: 'second' });
    expect(await io.ask('A')).toBe('first');
    expect(await io.ask('B')).toBe('second');
    io.close();
  });

  test('askSecret() routes through the same line stream + reports placeholder progress', async () => {
    const seen: Array<{ step: string; pendingAnswer?: unknown }> = [];
    const io = widgetIO({ onProgress: (info) => seen.push(info) });
    const askSecret = io.askSecret;
    if (!askSecret) throw new Error('widgetIO must expose askSecret');
    const promise = askSecret('Token:');
    asTestHost(io.__host).emit({ kind: 'line', value: 'sk-foo' });
    expect(await promise).toBe('sk-foo');
    expect(seen[0]?.pendingAnswer).toBe('<secret>');
    io.close();
  });

  test('close() is idempotent', () => {
    const io = widgetIO();
    io.close();
    expect(() => io.close()).not.toThrow();
  });
});

describe('onboarding/widget-impl · buildWizardSpec', () => {
  test('returns an InteractiveModalSpec with text steps', () => {
    const spec = buildWizardSpec([
      { id: 'name', label: 'Name' },
      { id: 'token', label: 'Token', secret: true },
    ]);
    expect(spec.kind).toBe('interactive-modal');
    expect(spec.id).toBe('elanous-setup-wizard');
    expect(spec.steps.length).toBe(2);
    expect(spec.steps[0]).toEqual({
      kind: 'text',
      id: 'name',
      label: 'Name',
      secret: undefined,
    });
    expect(spec.steps[1]).toEqual({
      kind: 'text',
      id: 'token',
      label: 'Token',
      secret: true,
    });
  });
});
