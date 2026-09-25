// D3 — ChainForwardGateModal mount surface contract.

import { describe, test, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChainForwardGateModal } from './ChainForwardGateModal';

const sample = (forwardText = '안녕하세요. 이것은 confirm 대기 forward 입니다.') => ({
  from: { id: 'p1', label: 'codex' },
  to: { id: 'p2', label: 'claude' },
  forwardText,
});

describe('ChainForwardGateModal', () => {
  test('returns null when pending is undefined (no DOM rendered)', () => {
    const html = renderToStaticMarkup(
      <ChainForwardGateModal
        pending={undefined}
        queueLength={0}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toBe('');
  });

  test('renders from/to labels + preview when pending present', () => {
    const html = renderToStaticMarkup(
      <ChainForwardGateModal
        pending={sample()}
        queueLength={1}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('chain-forward-gate-from');
    expect(html).toContain('chain-forward-gate-to');
    expect(html).toContain('chain-forward-gate-preview');
    expect(html).toContain('codex');
    expect(html).toContain('claude');
    expect(html).toContain('confirm 대기');
  });

  test('renders confirm + cancel buttons with testids', () => {
    const html = renderToStaticMarkup(
      <ChainForwardGateModal
        pending={sample()}
        queueLength={1}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('chain-forward-gate-confirm');
    expect(html).toContain('chain-forward-gate-cancel');
    expect(html).toContain('Forward');
    expect(html).toContain('Cancel');
  });

  test('aria-modal + aria-live announcer present', () => {
    const html = renderToStaticMarkup(
      <ChainForwardGateModal
        pending={sample()}
        queueLength={1}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Chain forward gate');  // announcer prefix
  });

  test('queueLength > 1 surfaces +N queued hint', () => {
    const html = renderToStaticMarkup(
      <ChainForwardGateModal
        pending={sample()}
        queueLength={3}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('chain-forward-gate-queue-hint');
    expect(html).toContain('+2 queued');
  });

  test('queueLength === 1 hides the +N queued hint', () => {
    const html = renderToStaticMarkup(
      <ChainForwardGateModal
        pending={sample()}
        queueLength={1}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).not.toContain('chain-forward-gate-queue-hint');
  });

  test('long forward text is truncated with ellipsis hint', () => {
    const longText = 'x'.repeat(900);
    const html = renderToStaticMarkup(
      <ChainForwardGateModal
        pending={sample(longText)}
        queueLength={1}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('Truncated for preview');
    // preview contains the truncated head + ellipsis char
    expect(html).toContain('…');
  });
});
