import { expect, test } from 'bun:test';
import { classifyDecomposeFailure, reportDecomposeFailureHitl } from './se-mission-prepare-cause.js';

const source = await Bun.file(new URL('./se-mission-prepare.ts', import.meta.url)).text();

test('mission RFC preparation reuses the canonical RFC resolver', () => {
  expect(source).toContain("const { authorMissionRfc, createRfcResolver } = await import('../src/autopilot/mission-rfc-author.js');");
  expect(source).toContain('const resolve = createRfcResolver(missionId);');
  expect(source).not.toContain('MONAD_RFC_MODEL');
  expect(source).not.toContain('MONAD_RFC_FALLBACK_MODEL');
  expect(source).not.toContain("'author-fallback'");
});

test('unclassified decomposeError does not claim gateway exhaustion and is observed', () => {
  const logs: Array<{ category: string; event: string; data: Record<string, unknown> }> = [];
  const notices: string[] = [];
  const reported = reportDecomposeFailureHitl({
    decomposeError: 'ETIMEDOUT while waiting for decompose',
    model: 'gpt-test',
    opusModel: 'opus-test',
    notify: (text) => notices.push(text),
    log: (category, event, data) => { logs.push({ category, event, data }); },
  });
  expect(classifyDecomposeFailure('ETIMEDOUT while waiting for decompose').basis).toBe('unclassified');
  // 🩸 2026-09-23: 숫자만 보고 `took 504ms` 를 게이트웨이로 읽었다 — 상태를 «말하는» 문맥이 있을 때만 코드다.
  expect(classifyDecomposeFailure('fetch failed: took 504ms').basis).toBe('unclassified');
  expect(classifyDecomposeFailure('parse error at line 520 col 3').basis).toBe('unclassified');
  expect(classifyDecomposeFailure('HTTP 503 Service Unavailable').basis).toBe('gateway-confirmed');
  expect(classifyDecomposeFailure('upstream status: 502').basis).toBe('gateway-confirmed');
  expect(reported.notified).toBe(true);
  expect(notices).toHaveLength(1);
  expect(notices[0]).not.toContain('게이트웨이 오류(재시도 소진)');
  expect(notices[0]).toContain('원인 미분류');
  expect(notices[0]).toContain('ETIMEDOUT while waiting for decompose');
  expect(logs).toEqual([{
    category: 'mission.prepare.decompose-cause',
    event: 'classified',
    data: {
      errorPrefix: 'ETIMEDOUT while waiting for decompose',
      label: '원인 미분류',
      basis: 'unclassified',
    },
  }]);
  expect(source).toContain('reportDecomposeFailureHitl({');
  expect(source).toContain('notifyMissionHitl(progressOrigin, missionId, text, { opusFallbackButton: true })');
});
