import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractBrowserActStep } from './browser-act-step.js';

const row = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  category: 'harness.browser-action', event: 'executed', ts: '2026-08-28T00:00:00.000Z',
  data: JSON.stringify(data), ...extra,
});

describe('browser act step extraction', () => {
  test('is the single parser both trajectory modules use', () => {
    // 🪞 이 저장소에 같은 변환이 «둘» 있었다 — 뒤엣것을 내가 짓고 앞엣것을 «나중에» 알았다(2026-08-28).
    for (const f of ['browser-trajectory.ts', 'browser-act-trajectory.ts']) {
      const source = readFileSync(join(import.meta.dir, f), 'utf8');
      expect(source).toContain('extractBrowserActStep');
      // ⛔ 그리고 «자기 파서»로 되돌아가지 않았는지 — data 를 직접 JSON.parse 하는 자리가 없어야 한다
      expect(source).not.toContain('JSON.parse(row.data');
    }
  });

  test('parses the doubly-encoded data field — the row carries data as a string', () => {
    // ⛔ 이 저장소가 2026-08-27 에 «세 트랙»이 밟은 자리.
    const r = extractBrowserActStep(row({ target: '#a', url: 'https://x', coordinates: { x: 1, y: 2 }, personaId: 'p', runId: 'r' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.step).toMatchObject({ target: '#a', url: 'https://x', coordinates: { x: 1, y: 2 }, personaId: 'p', runId: 'r' });
  });

  test('separates "no coordinates key" from "coordinates present but unreadable"', () => {
    // ⛔ 앞엣것은 「그 조작에 좌표가 없다」(실패했다)이고, 뒤엣것은 «자료가 깨진» 것이다.
    const absent = extractBrowserActStep(row({ target: '#a' }));
    const broken = extractBrowserActStep(row({ target: '#a', coordinates: { x: 'nope', y: 2 } }));
    expect(absent.ok && absent.step.coordinatesPresent).toBe(false);
    expect(broken.ok && broken.step.coordinatesPresent).toBe(true);
    expect(absent.ok && absent.step.coordinates).toBeNull();
    expect(broken.ok && broken.step.coordinates).toBeNull();
  });

  test('reports why it could not extract, instead of returning a hollow step', () => {
    expect(extractBrowserActStep({ category: 'other', event: 'executed', data: '{}' })).toEqual({ ok: false, reason: 'unrelated-event' });
    expect(extractBrowserActStep(row({ target: '#a' }, { event: 'started' }))).toEqual({ ok: false, reason: 'unrelated-event' });
    expect(extractBrowserActStep({ category: 'harness.browser-action', event: 'executed', data: 'not json' })).toEqual({ ok: false, reason: 'invalid-row' });
    expect(extractBrowserActStep(row({ url: 'https://x' }))).toEqual({ ok: false, reason: 'missing-target' });
  });

  test('treats a failed action as a step, not as garbage', () => {
    // ⛔ 거부도 「무엇을 하려 했나」의 기록이다 — 버리는 것은 «부르는 쪽»이 정한다.
    const r = extractBrowserActStep(row({ target: '#a', url: 'https://x', ok: false, failureReason: 'unarmed', coordinates: null }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.step).toMatchObject({ ok: false, failureReason: 'unarmed', coordinates: null });
  });

  test('a row with no ok field is a success — the field only appears on failures', () => {
    const r = extractBrowserActStep(row({ target: '#a', url: 'https://x' }));
    expect(r.ok && r.step.ok).toBe(true);
  });

  test('accepts both category spellings, because the store and the query disagree', () => {
    // 📏 관측은 'harness.browser-action' 으로 나가고 조회는 'harness.browser-act' 로 하는 판이 있다.
    for (const category of ['harness.browser-action', 'harness.browser-act']) {
      const r = extractBrowserActStep({ category, event: 'executed', data: JSON.stringify({ target: '#a' }) });
      expect(r.ok).toBe(true);
    }
  });
});
