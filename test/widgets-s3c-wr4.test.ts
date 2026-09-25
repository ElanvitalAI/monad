// ── WR-4 · S3.C · result-card 4 hook + hello-text stateless ──

import { describe, test, expect } from 'bun:test';
import resultCardWidget, { type ResultCardState } from '../widgets/result-card/widget.js';
import helloTextWidget from '../widgets/hello-text/widget.js';
import type { WidgetContext } from '../src/widgets/types.js';

function s(overrides: Partial<ResultCardState> = {}): ResultCardState {
  return {
    personaName: 'Persona',
    stance: 'loading',
    focused: false,
    ...overrides,
  };
}

const ctx = { character: 'Result' } as WidgetContext<ResultCardState>;

describe('wd-result-card · WR-4 · describeSurface', () => {
  test('persona name preferred over character', () => {
    const out = resultCardWidget.describeSurface!(s({ personaName: 'Park Ji-hoon', stance: 'bull', confidence: 72 }), ctx);
    expect(out).toContain('Park Ji-hoon');
    expect(out).toContain('bull');
    expect(out).toContain('72%');
  });

  test('character fallback when personaName empty', () => {
    const out = resultCardWidget.describeSurface!(s({ personaName: '', stance: 'loading' }), ctx);
    expect(out).toContain('Result');
  });

  test('error stance surfaces truncated error message', () => {
    const long = 'agent timed out after 30s waiting for upstream model response';
    const out = resultCardWidget.describeSurface!(s({ stance: 'error', error: long }), ctx);
    expect(out).toContain('error:');
    expect(out).toContain('agent timed out');
    expect(out.length).toBeLessThan(120);  // truncation ceiling
  });

  test('confidence omitted for loading/error stances', () => {
    const out1 = resultCardWidget.describeSurface!(s({ stance: 'loading', confidence: 50 }), ctx);
    expect(out1).not.toMatch(/\d+%/);
    const out2 = resultCardWidget.describeSurface!(s({ stance: 'error', confidence: 50, error: 'x' }), ctx);
    expect(out2).not.toMatch(/\d+%/);
  });
});

describe('wd-result-card · WR-4 · snapshotHash', () => {
  const hash = (st: ResultCardState) => resultCardWidget.snapshotHash!(st);

  test('stance change → distinct hash', () => {
    expect(hash(s({ stance: 'loading' }))).not.toBe(hash(s({ stance: 'bull' })));
  });

  test('confidence change → distinct hash', () => {
    expect(hash(s({ stance: 'bull', confidence: 50 }))).not.toBe(hash(s({ stance: 'bull', confidence: 70 })));
  });

  test('summary length change → distinct hash', () => {
    expect(hash(s({ stance: 'bull', summary: 'short' }))).not.toBe(hash(s({ stance: 'bull', summary: 'longer summary' })));
  });
});

describe('wd-result-card · WR-4 · onStateChange', () => {
  test('emits stance.change on stance transition', () => {
    const events: Array<{ kind: string; data: { from: string; to: string } }> = [];
    const tCtx = {
      character: 'Result',
      telemetry: { emit: (e: { kind: string; data: { from: string; to: string } }) => events.push(e) },
    } as unknown as WidgetContext<ResultCardState>;
    resultCardWidget.onStateChange!(s({ stance: 'loading' }), s({ stance: 'bull', confidence: 60 }), tCtx);
    const stanceEvents = events.filter((e) => e.kind === 'result-card.stance.change');
    expect(stanceEvents).toHaveLength(1);
    expect(stanceEvents[0]!.data.from).toBe('loading');
    expect(stanceEvents[0]!.data.to).toBe('bull');
  });

  test('confidence drift on loading stance does NOT emit', () => {
    const events: unknown[] = [];
    const tCtx = {
      character: 'Result',
      telemetry: { emit: (e: unknown) => events.push(e) },
    } as unknown as WidgetContext<ResultCardState>;
    resultCardWidget.onStateChange!(s({ stance: 'loading', confidence: 0 }), s({ stance: 'loading', confidence: 50 }), tCtx);
    expect(events).toHaveLength(0);
  });
});

describe('wd-hello-text · WR-4 stateless', () => {
  test('no onStateChange / snapshotHash / describeSurface hooks', () => {
    expect(helloTextWidget.onStateChange).toBeUndefined();
    expect(helloTextWidget.snapshotHash).toBeUndefined();
    expect(helloTextWidget.describeSurface).toBeUndefined();
  });
});
