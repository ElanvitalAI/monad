// R5.5 — SessionCard render contract.
//
// Pure presentational component; SSR rendering verifies all the
// structural markers a future refactor could lose.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionCard, type CardSessionData } from './SessionCard';

const baseSession: CardSessionData = {
  id: 'sess-r5-1',
  msgCount: 12,
  lastTurnAt: '2026-05-09T07:00:00Z',
  ageMs: 3 * 60_000,
  status: 'active',
  lastMsgPreview: 'OCR 결과 한번 봐줘',
  origin: 'pwa',
};

describe('SessionCard · render contract', () => {
  test('renders id + status pill + age + preview', () => {
    const html = renderToStaticMarkup(<SessionCard session={baseSession} active />);
    expect(html).toContain('data-testid="session-card"');
    expect(html).toContain('data-testid="session-card-id"');
    expect(html).toContain('data-testid="session-card-status"');
    expect(html).toContain('data-testid="session-card-age"');
    expect(html).toContain('data-testid="session-card-preview"');
    expect(html).toContain('sess-r5-1');
    expect(html).toContain('대화중');           // status label for 'active'
    expect(html).toContain('OCR 결과 한번 봐줘');
    expect(html).toContain('pwa');               // origin appears in age line
  });

  test('age formatter — minutes', () => {
    const html = renderToStaticMarkup(
      <SessionCard session={{ ...baseSession, ageMs: 4 * 60_000 }} active />,
    );
    expect(html).toContain('4분 전');
  });

  test('age formatter — hours', () => {
    const html = renderToStaticMarkup(
      <SessionCard session={{ ...baseSession, ageMs: 3 * 60 * 60_000 }} active />,
    );
    expect(html).toContain('3시간 전');
  });

  test('age formatter — days', () => {
    const html = renderToStaticMarkup(
      <SessionCard session={{ ...baseSession, ageMs: 2 * 24 * 60 * 60_000 }} active />,
    );
    expect(html).toContain('2일 전');
  });

  test('age formatter — sub-minute', () => {
    const html = renderToStaticMarkup(
      <SessionCard session={{ ...baseSession, ageMs: 30_000 }} active />,
    );
    expect(html).toContain('방금');
  });

  test('idle status pill', () => {
    const html = renderToStaticMarkup(
      <SessionCard session={{ ...baseSession, status: 'idle' }} active />,
    );
    expect(html).toContain('대기중');
  });

  test('stale status pill', () => {
    const html = renderToStaticMarkup(
      <SessionCard session={{ ...baseSession, status: 'stale' }} active />,
    );
    expect(html).toContain('오래됨');
  });

  test('preview omitted when not provided', () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={{ ...baseSession, lastMsgPreview: undefined }}
        active
      />,
    );
    expect(html).not.toContain('data-testid="session-card-preview"');
  });

  test('hint footer renders only on active card', () => {
    const activeHtml = renderToStaticMarkup(<SessionCard session={baseSession} active />);
    const peekHtml = renderToStaticMarkup(<SessionCard session={baseSession} active={false} stackIndex={1} />);
    expect(activeHtml).toContain('data-testid="session-card-hint"');
    expect(activeHtml).toContain('거절');
    expect(activeHtml).toContain('승인');
    expect(peekHtml).not.toContain('data-testid="session-card-hint"');
  });

  test('data-active reflects prop', () => {
    const a = renderToStaticMarkup(<SessionCard session={baseSession} active />);
    const p = renderToStaticMarkup(<SessionCard session={baseSession} active={false} stackIndex={2} />);
    expect(a).toContain('data-active="true"');
    expect(p).toContain('data-active="false"');
    expect(p).toContain('data-stack-index="2"');
  });
});
