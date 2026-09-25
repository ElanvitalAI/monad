import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  composeLiveProbeLine,
  decideLiveFallback,
  emitLiveProbeLine,
  grokQuotaProbeFromSnapshot,
  parseLiveReason,
  parseStatusJson,
  probeLine,
  readLiveFallbackChain,
  readLiveGrokQuota,
  rotationFromLive,
} from './codex-fallback-live-probe.js';

describe('rotationFromLive — status 스키마의 회전 대상', () => {
  it('rotated 의 유효한 계정 이름을 그대로 쓴다', () => {
    const rotation = rotationFromLive('rotated', 'team');
    expect(rotation).toEqual({
      reason: 'rotated',
      to: { name: 'team', storeKey: 'openai-codex:team', home: '', reached: undefined },
    });
  });

  it('대상이 없으면 가짜 unknown 후보를 만들지 않고 오류다', () => {
    expect(() => rotationFromLive('rotated', null)).toThrow(/rotation\.to missing or invalid/);
    expect(() => rotationFromLive('rotated', undefined)).toThrow(/rotation\.to missing or invalid/);
    expect(() => rotationFromLive('reset-credit-unknown', '')).toThrow(/rotation\.to missing or invalid/);
  });

  it('대상 형식이 아니면 오류다 — 객체·숫자를 unknown 으로 보정하지 않는다', () => {
    expect(() => rotationFromLive('rotated', { name: 'team' })).toThrow(/rotation\.to missing or invalid/);
    expect(() => rotationFromLive('rotated', 1)).toThrow(/rotation\.to missing or invalid/);
    expect(() => rotationFromLive('rotated', 'bad name')).toThrow(/rotation\.to missing or invalid/);
  });

  it('stay 사유는 대상 없이 받는다', () => {
    expect(rotationFromLive('reset-credit-available', null)).toEqual({ reason: 'reset-credit-available' });
    expect(rotationFromLive('no-candidate', undefined)).toEqual({ reason: 'no-candidate' });
  });
});

describe('grokQuotaProbeFromSnapshot — 운영 잔량 증거와 미확인을 가른다', () => {
  it('스냅샷이 없으면 미확인 unknown 이고 판정은 조건부다', () => {
    expect(grokQuotaProbeFromSnapshot(undefined)).toEqual({
      grokQuota: 'unknown',
      grokQuotaSource: 'unconfirmed',
      grokQuotaConfirmed: false,
      decisionConditional: true,
    });
    expect(grokQuotaProbeFromSnapshot(null)).toEqual({
      grokQuota: 'unknown',
      grokQuotaSource: 'unconfirmed',
      grokQuotaConfirmed: false,
      decisionConditional: true,
    });
  });

  it('공급자가 찼다고 말하면 exhausted 확정이다', () => {
    expect(grokQuotaProbeFromSnapshot({ rateLimitReached: 'rate_limit_reached' })).toEqual({
      grokQuota: 'exhausted',
      grokQuotaSource: 'usage-store-cache',
      grokQuotaConfirmed: true,
      decisionConditional: false,
    });
  });

  it('캐시는 읽었지만 재료가 없으면 unknown · 조건부 (출처는 cache)', () => {
    expect(grokQuotaProbeFromSnapshot({})).toEqual({
      grokQuota: 'unknown',
      grokQuotaSource: 'usage-store-cache',
      grokQuotaConfirmed: false,
      decisionConditional: true,
    });
  });

  it('budget state.json 이 없으면 미확인이다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-fallback-probe-quota-'));
    expect(readLiveGrokQuota(dir)).toEqual({
      grokQuota: 'unknown',
      grokQuotaSource: 'unconfirmed',
      grokQuotaConfirmed: false,
      decisionConditional: true,
    });
  });

  it('budget state.json 의 grok 스냅샷을 읽는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-fallback-probe-quota-ok-'));
    mkdirSync(join(dir, 'budget'));
    writeFileSync(join(dir, 'budget', 'state.json'), JSON.stringify({
      v: 1,
      snapshots: { grok: { rateLimitReached: 'rate_limit_reached' } },
    }));
    expect(readLiveGrokQuota(dir).grokQuota).toBe('exhausted');
    expect(readLiveGrokQuota(dir).grokQuotaConfirmed).toBe(true);
  });
});

describe('decideLiveFallback — 운영 입력을 가정하지 않는다', () => {
  const chainBoth = ['codex-rotate', 'grok'] as const;

  it('reset-credit-available + 운영 체인 grok + 자격 있음 + 잔량 미확인 → grok (조건부)', () => {
    expect(decideLiveFallback('reset-credit-available', null, chainBoth, true, 'unknown'))
      .toEqual({ action: 'switch-backend', backend: 'grok' });
  });

  it('같은 이유라도 grok 자격이 없으면 stay 이고 JSON 에 그 입력이 남는다', () => {
    const decision = decideLiveFallback('reset-credit-available', null, chainBoth, false, 'unknown');
    expect(decision).toEqual({ action: 'stay', why: 'grok-unavailable' });
    const line = probeLine({
      liveReason: 'reset-credit-available',
      chain: chainBoth,
      chainSource: 'config',
      grokAvailable: false,
      grokAvailableSource: 'resolveGrokCredential',
      grokQuota: 'unknown',
      grokQuotaSource: 'unconfirmed',
      grokQuotaConfirmed: false,
      decisionConditional: true,
    }, decision);
    expect(line.inputKind).toBe('live');
    expect(line.grokAvailable).toBe(false);
    expect(line.chain).toEqual(['codex-rotate', 'grok']);
    expect(line.action).toBe('stay');
    expect(line.why).toBe('grok-unavailable');
    expect(line.grokQuotaConfirmed).toBe(false);
    expect(line.decisionConditional).toBe(true);
  });

  it('운영 잔량이 exhausted 면 grok 전환을 제시하지 않는다', () => {
    const decision = decideLiveFallback('reset-credit-available', null, chainBoth, true, 'exhausted');
    expect(decision).toEqual({ action: 'stay', why: 'grok-exhausted' });
    const line = probeLine({
      liveReason: 'reset-credit-available',
      chain: chainBoth,
      chainSource: 'config',
      grokAvailable: true,
      grokAvailableSource: 'resolveGrokCredential',
      grokQuota: 'exhausted',
      grokQuotaSource: 'usage-store-cache',
      grokQuotaConfirmed: true,
      decisionConditional: false,
    }, decision);
    expect(line.action).toBe('stay');
    expect(line.why).toBe('grok-exhausted');
    expect(line.backend).toBeUndefined();
    expect(line.grokQuota).toBe('exhausted');
    expect(line.grokQuotaConfirmed).toBe(true);
    expect(line.decisionConditional).toBe(false);
  });

  it('잔량 unknown 이면 전환은 조건부이고 JSON 에 미확인이 남는다', () => {
    const decision = decideLiveFallback('reset-credit-available', null, chainBoth, true, 'unknown');
    expect(decision).toEqual({ action: 'switch-backend', backend: 'grok' });
    const line = probeLine({
      liveReason: 'reset-credit-available',
      chain: chainBoth,
      chainSource: 'config',
      grokAvailable: true,
      grokAvailableSource: 'resolveGrokCredential',
      grokQuota: 'unknown',
      grokQuotaSource: 'unconfirmed',
      grokQuotaConfirmed: false,
      decisionConditional: true,
    }, decision);
    expect(line.action).toBe('switch-backend');
    expect(line.backend).toBe('grok');
    expect(line.grokQuota).toBe('unknown');
    expect(line.grokQuotaConfirmed).toBe(false);
    expect(line.decisionConditional).toBe(true);
  });

  it('체인이 기본값이면 chainSource 가 default 로 드러난다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-fallback-probe-'));
    expect(readLiveFallbackChain(dir)).toEqual({
      chain: ['codex-rotate', 'grok'],
      chainSource: 'default',
    });
  });

  it('운영 config 의 fallbackChain 을 읽는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-fallback-probe-cfg-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ llm: { fallbackChain: ['codex-rotate'] } }));
    expect(readLiveFallbackChain(dir)).toEqual({
      chain: ['codex-rotate'],
      chainSource: 'config',
    });
  });

  it('status JSON 에서 이유를 손으로 박지 않는다', () => {
    expect(parseLiveReason({ rotation: { reason: 'reset-credit-available', to: null } }))
      .toEqual({ liveReason: 'reset-credit-available', to: null });
    expect(() => parseLiveReason({})).toThrow(/rotation\.reason/);
  });
});

describe('composeLiveProbeLine — 엔트리포인트 합성 (CLI 출력 파싱 ⊕ 운영 입력 ⊕ 한 줄 JSON)', () => {
  const chainBoth = ['codex-rotate', 'grok'] as const;
  const unconfirmed = grokQuotaProbeFromSnapshot(undefined);
  const exhausted = grokQuotaProbeFromSnapshot({ rateLimitReached: 'rate_limit_reached' });

  it('선행 로그가 있어도 status JSON 의 rotation.reason 을 쓴다', () => {
    const raw = 'note: skip\n{"rotation":{"reason":"reset-credit-available","to":null}}\n';
    expect(parseStatusJson(raw).rotation?.reason).toBe('reset-credit-available');
    const line = composeLiveProbeLine(raw, chainBoth, 'config', true, unconfirmed);
    expect(line.liveReason).toBe('reset-credit-available');
    expect(line.action).toBe('switch-backend');
    expect(line.backend).toBe('grok');
    expect(line.inputKind).toBe('live');
    expect(line.decisionConditional).toBe(true);
    expect(emitLiveProbeLine(line)).toBe(`${JSON.stringify(line)}\n`);
    expect(JSON.parse(emitLiveProbeLine(line))).toEqual(line);
  });

  it('운영 잔량이 exhausted 면 grok 전환을 한 줄 JSON 에 넣지 않는다', () => {
    const raw = '{"rotation":{"reason":"reset-credit-available"}}';
    const line = composeLiveProbeLine(raw, chainBoth, 'config', true, exhausted);
    expect(line.action).toBe('stay');
    expect(line.why).toBe('grok-exhausted');
    expect(line.grokQuota).toBe('exhausted');
    expect(line.grokQuotaConfirmed).toBe(true);
    expect(line.decisionConditional).toBe(false);
    expect(line.backend).toBeUndefined();
  });

  it('JSON 이 없으면 이유를 지어내지 않고 오류다', () => {
    expect(() => parseStatusJson('no json here')).toThrow(/JSON/);
    expect(() => composeLiveProbeLine('no json here', chainBoth, 'config', true, unconfirmed)).toThrow(/JSON/);
  });
});
