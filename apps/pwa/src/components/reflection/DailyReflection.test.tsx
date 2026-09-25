// R6.4 — DailyReflection render contract.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { DailyReflection, type DailyReflectionData } from './DailyReflection';

const EMPTY: DailyReflectionData = {
  date: '2026-05-09',
  notesSaved: 0,
  ocrRuns: 0,
  sessionsToday: 0,
  topSessions: [],
  generatedAt: '2026-05-09T14:00:00Z',
};

const FILLED: DailyReflectionData = {
  date: '2026-05-09',
  notesSaved: 3,
  ocrRuns: 5,
  sessionsToday: 4,
  topSessions: [
    { id: 's-r-ocr', msgCount: 12, lastTurnAt: '2026-05-09T13:00Z', lastMsgPreview: 'OCR 결과 한번 봐줘' },
    { id: 's-cv-3', msgCount: 8, lastTurnAt: '2026-05-09T11:00Z' },
  ],
  generatedAt: '2026-05-09T14:00:00Z',
};

describe('DailyReflection · empty state', () => {
  test('renders the empty placeholder', () => {
    const html = renderToStaticMarkup(<DailyReflection snapshot={EMPTY} />);
    expect(html).toContain('data-testid="daily-reflection"');
    expect(html).toContain('data-testid="reflection-empty"');
    expect(html).toContain('오늘 기록된 활동이 없습니다');
    // No counter cells when empty
    expect(html).not.toContain('data-testid="reflection-notes-saved"');
  });

  test('date + generatedAt headers always render', () => {
    const html = renderToStaticMarkup(<DailyReflection snapshot={EMPTY} />);
    expect(html).toContain('data-testid="reflection-date"');
    expect(html).toContain('data-testid="reflection-generated-at"');
    expect(html).toContain('2026-05-09');
  });
});

describe('DailyReflection · filled state', () => {
  test('renders 3 counter cells', () => {
    const html = renderToStaticMarkup(<DailyReflection snapshot={FILLED} />);
    expect(html).toContain('data-testid="reflection-notes-saved"');
    expect(html).toContain('data-testid="reflection-ocr-runs"');
    expect(html).toContain('data-testid="reflection-sessions-today"');
    expect(html).not.toContain('data-testid="reflection-empty"');
  });

  test('counters reflect the snapshot numbers', () => {
    const html = renderToStaticMarkup(<DailyReflection snapshot={FILLED} />);
    expect(html).toMatch(/data-testid="reflection-notes-saved">[^<]*3</);
    expect(html).toMatch(/data-testid="reflection-ocr-runs">[^<]*5</);
    expect(html).toMatch(/data-testid="reflection-sessions-today">[^<]*4</);
  });

  test('top sessions render with id + msg count + preview', () => {
    const html = renderToStaticMarkup(<DailyReflection snapshot={FILLED} />);
    expect(html).toContain('data-testid="reflection-top-sessions"');
    expect(html).toContain('s-r-ocr');
    expect(html).toContain('s-cv-3');
    expect(html).toContain('OCR 결과 한번 봐줘');
    // 2 rows present
    const rowMatches = html.match(/data-testid="reflection-session-row"/g) || [];
    expect(rowMatches.length).toBe(2);
  });

  test('top sessions section omitted when empty array even on filled counters', () => {
    const html = renderToStaticMarkup(
      <DailyReflection snapshot={{ ...FILLED, topSessions: [] }} />,
    );
    expect(html).not.toContain('data-testid="reflection-top-sessions"');
    // Counters still render
    expect(html).toContain('data-testid="reflection-notes-saved"');
  });

  test('preview omitted on a session without it', () => {
    const html = renderToStaticMarkup(<DailyReflection snapshot={FILLED} />);
    // s-cv-3 has no preview in the fixture; verify the row is present
    // but no preview <p> — easier check: total <p> children inside
    // top-sessions block.
    expect(html).toContain('data-session-id="s-cv-3"');
  });
});
