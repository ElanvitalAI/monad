import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { MorningShowroomContent, type MorningState } from './MorningShowroom';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'MorningShowroom.tsx'), 'utf8');

const CARD = {
  kind: 'morning-digest-showroom' as const,
  date: '2026-08-15',
  createdAt: 0,
  lanes: [
    { lane: 'yesterday' as const, text: '어제 완료', prompt: 'yesterday' },
    { lane: 'today' as const, text: '오늘 할 일', prompt: 'today' },
    { lane: 'blockers' as const, text: '막힌 일 없음', prompt: 'blockers' },
    { lane: 'opportunities' as const, text: '관찰 기회', prompt: 'opportunities' },
  ],
};

function render(state: MorningState): string {
  return renderToStaticMarkup(<MorningShowroomContent state={state} onRetry={() => {}} />);
}

describe('MorningShowroom · state render contract', () => {
  test('renders an actionable unavailable state without an HTTP status', () => {
    const html = render({ kind: 'unavailable' });
    expect(html).toContain('data-testid="morning-showroom-unavailable"');
    expect(html).toContain('아직 연결되지 않았습니다');
    expect(html).toContain('다시 시도');
    expect(html).not.toMatch(/\b[1-5]\d{2}\b/);
  });

  test('renders a distinct loaded-empty state with a usable refresh action', () => {
    const html = render({ kind: 'empty' });
    expect(html).toContain('data-testid="morning-showroom-empty"');
    expect(html).toContain('아직 보여 줄 Morning showroom 항목이 없습니다');
    expect(html).toContain('data-testid="morning-showroom-empty-retry"');
    expect(html).toContain('<button');
    expect(html).toContain('새로 고침');
    expect(html).not.toContain('아직 연결되지 않았습니다');
  });

  test('preserves the populated four-pane card rendering', () => {
    const html = render({ kind: 'card', card: CARD });
    expect(html).toContain('Morning showroom · 2026-08-15');
    expect(html).toContain('data-lane="yesterday"');
    expect(html).toContain('data-lane="today"');
    expect(html).toContain('data-lane="blockers"');
    expect(html).toContain('data-lane="opportunities"');
    expect(html).toContain('어제 완료');
    expect(html).toContain('오늘 할 일');
  });
});

describe('MorningShowroom · API seam and retry wiring', () => {
  test('keeps the injectable API seam and categorizes empty successful cards', () => {
    expect(SRC).toContain('api?: MorningShowroomApiClient');
    expect(SRC).toContain('api.compose(props.request)');
    expect(SRC).toContain("card.lanes.length === 0 ? { kind: 'empty' }");
  });

  test('retries the existing compose call from both unavailable and empty states without backend details', () => {
    expect(SRC).toContain('const [retryKey, setRetryKey] = useState(0);');
    expect(SRC).toContain('retryKey]);');
    expect(SRC).toContain('onRetry={() => setRetryKey((key) => key + 1)}');
    expect(SRC).toContain('data-testid="morning-showroom-empty-retry"');
    expect(SRC).toContain(".catch(() => {");
    expect(SRC).not.toContain('Morning digest error (');
  });
});
