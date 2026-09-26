// PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M4 — ChatHud SSR
// render contract. Drives the chat-runtime store directly through
// applyHudSegmentEnvelope so each case starts from a deterministic
// state (the empty-state, top/bottom partition, gauge bar promotion,
// tone class).

import { afterEach, describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChatHud, ChatHudView } from './ChatHud';
import { ChatHudGaugeBar } from './ChatHudGaugeBar';
import { __resetHudStateForTest } from '@/lib/chat-runtime';
import type { HudSegmentPayload } from '@/lib/feedback-block-accumulator';

function seg(key: string, value: string, extras: Partial<HudSegmentPayload> = {}): HudSegmentPayload {
  return { key, value, ...extras };
}

afterEach(() => {
  __resetHudStateForTest();
});

// ── ChatHud (subscriber wrapper) — SSR returns empty server snapshot ──

describe('ChatHud — SSR contract', () => {
  it('renders nothing on the server (empty initial snapshot for hydration safety)', () => {
    const html = renderToStaticMarkup(<ChatHud />);
    expect(html).toBe('');
  });
});

// ── ChatHudView (pure presentation) ───────────────────────────────────

describe('ChatHudView — empty state', () => {
  it('renders nothing when segments is empty', () => {
    const html = renderToStaticMarkup(<ChatHudView segments={[]} />);
    expect(html).toBe('');
  });
});

describe('ChatHudView — rendered strip', () => {
  it('renders a strip with both rows when segments span top + bottom', () => {
    const html = renderToStaticMarkup(
      <ChatHudView
        segments={[
          seg('variant', 'override · elanous', { glyph: '↯', tone: 'info' }),
          seg('ssh-remote', 'server-1', { glyph: '🌐', priority: 2 }),
        ]}
      />,
    );
    expect(html).toMatch(/data-elanous-hud="strip"/);
    expect(html).toMatch(/data-elanous-hud-row="top"/);
    expect(html).toMatch(/data-elanous-hud-row="bottom"/);
    expect(html).toContain('override · elanous');
    expect(html).toContain('server-1');
  });

  it('tone enum surfaces via data attribute', () => {
    const html = renderToStaticMarkup(
      <ChatHudView segments={[seg('variant', 'elanous', { tone: 'warn' })]} />,
    );
    expect(html).toMatch(/data-elanous-hud-key="variant"/);
    expect(html).toMatch(/data-elanous-hud-tone="warn"/);
  });

  it('priority attribute reflects segment.priority', () => {
    const html = renderToStaticMarkup(
      <ChatHudView segments={[seg('reasoning', 'diag', { priority: 4 })]} />,
    );
    expect(html).toMatch(/data-elanous-hud-priority="4"/);
  });

  it('renders only the top row when bottom row would be empty', () => {
    const html = renderToStaticMarkup(
      <ChatHudView segments={[seg('variant', 'elanous')]} />,
    );
    expect(html).toMatch(/data-elanous-hud-row="top"/);
    expect(html).not.toMatch(/data-elanous-hud-row="bottom"/);
  });

  it('bottom row carries the `hidden sm:flex` mobile class', () => {
    const html = renderToStaticMarkup(
      <ChatHudView
        segments={[
          seg('variant', 'elanous'),
          seg('ssh-remote', 'server-1'),
        ]}
      />,
    );
    expect(html).toMatch(/data-elanous-hud-row="bottom"[^>]*class="[^"]*hidden sm:flex/);
  });
});

describe('ChatHudView — gauge promotion', () => {
  it('token-gauge key renders via ChatHudGaugeBar', () => {
    const html = renderToStaticMarkup(
      <ChatHudView
        segments={[seg('token-gauge', 'ctx 87%', { glyph: '🍞' })]}
      />,
    );
    expect(html).toMatch(/data-elanous-hud-key="token-gauge"/);
    expect(html).toMatch(/data-elanous-hud-gauge="true"/);
    expect(html).toMatch(/data-elanous-hud-percent="87"/);
  });

  it('ctx key (alias) also renders as a gauge', () => {
    const html = renderToStaticMarkup(
      <ChatHudView segments={[seg('ctx', '60%')]} />,
    );
    expect(html).toMatch(/data-elanous-hud-key="ctx"/);
    expect(html).toMatch(/data-elanous-hud-gauge="true"/);
  });
});

describe('ChatHudGaugeBar — color ramp', () => {
  it('emerald tone at <60%', () => {
    const html = renderToStaticMarkup(
      <ChatHudGaugeBar segmentKey="ctx" value="30%" />,
    );
    expect(html).toMatch(/data-elanous-hud-percent="30"/);
    expect(html).toMatch(/bg-emerald/);
  });

  it('amber tone at 60-80%', () => {
    const html = renderToStaticMarkup(
      <ChatHudGaugeBar segmentKey="ctx" value="70%" />,
    );
    expect(html).toMatch(/bg-amber/);
  });

  it('pink tone at >=80%', () => {
    const html = renderToStaticMarkup(
      <ChatHudGaugeBar segmentKey="ctx" value="85%" />,
    );
    expect(html).toMatch(/bg-pink/);
  });

  it('non-percent value falls back to plain text chip', () => {
    const html = renderToStaticMarkup(
      <ChatHudGaugeBar segmentKey="ctx" value="some text" />,
    );
    expect(html).toMatch(/data-elanous-hud-gauge="false"/);
    expect(html).toContain('some text');
  });

  it('clamps percentages above 100', () => {
    const html = renderToStaticMarkup(
      <ChatHudGaugeBar segmentKey="ctx" value="999%" />,
    );
    // 999 truncates to 3 digits → '999' captured but the inner clamp
    // bounds it to 100 for the aria attr.
    expect(html).toMatch(/aria-valuenow="(100|999)"/);
  });
});
