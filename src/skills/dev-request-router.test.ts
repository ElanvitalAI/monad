import { describe, expect, test } from 'bun:test';
import { debug } from '../debug/log.js';
import { devRequestRoutingDefaults } from '../user-config.js';
import { detectDevRequest, observeDevRequestRoute } from './dev-request-router.js';

const CFG = devRequestRoutingDefaults();

describe('detectDevRequest', () => {
  test('returns null when disabled, guarded, ambiguous, or without an implementation target', () => {
    expect(detectDevRequest('검색 결과를 구현해줘.', { ...CFG, enabled: false })).toBeNull();
    expect(detectDevRequest('이 코드를 읽어서 구현해줘.', CFG)).toBeNull();
    expect(detectDevRequest('어떻게 구현해?', CFG)).toBeNull();
    expect(detectDevRequest('구현해줘', CFG)).toBeNull();
  });

  test('records matched verb and target in the decision for caller observability', () => {
    expect(detectDevRequest('검색 결과를 최근 순으로 정렬하는 기능을 구현해줘.', CFG)).toMatchObject({
      verb: '구현해줘',
      target: '검색',
      reason: expect.stringContaining('구현해줘'),
    });
  });

  test('logs matched and deferred decisions as non-routing observations at skills.dev-route', () => {
    debug.clear();
    const matched = detectDevRequest('검색 결과를 최근 순으로 정렬하는 기능을 구현해줘.', CFG);
    observeDevRequestRoute('검색 결과를 최근 순으로 정렬하는 기능을 구현해줘.', CFG, matched);
    observeDevRequestRoute('이 함수가 어디서 쓰이는지 찾아줘.', CFG, null);
    const events = debug.events(2);
    expect(events.map((event) => [event.category, event.event])).toEqual([
      ['skills.dev-route', 'would-route'],
      ['skills.dev-route', 'not-routed'],
    ]);
    expect(events[0]?.data).toMatchObject({
      decision: true,
      routed: false,
      routingAction: 'none',
      matchedWords: { verb: '구현해줘' },
    });
    expect(events[1]?.data).toMatchObject({
      decision: false,
      routed: false,
      routingAction: 'none',
      reason: expect.stringContaining('guard'),
    });
  });

  test('observes a caller-supplied decision without re-running detection', () => {
    debug.clear();
    const supplied = { verb: '구현해줘', target: '기능', reason: 'caller decision' };
    expect(observeDevRequestRoute('guard keyword 설명해줘', CFG, supplied)).toEqual(supplied);
    expect(debug.events(1)[0]).toMatchObject({
      category: 'skills.dev-route',
      event: 'would-route',
      data: { decision: true, routed: false, routingAction: 'none', reason: 'caller decision' },
    });
  });
});
