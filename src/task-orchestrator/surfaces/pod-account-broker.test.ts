import { describe, expect, test } from 'bun:test';
import { makePodAccountBroker, planPodAccounts } from './pod-account-broker.js';

const c = (name: string, usedPercent?: number, reached?: boolean) => ({ name, storeKey: `openai-codex:${name}`, home: `/h/${name}`, reached, ...(usedPercent !== undefined ? { usedPercent } : {}) });

describe('pod account broker — 병렬 Pod 가 한 계정에 몰리지 않게', () => {
  test('📏 09-26 실제 잔량(default 100% · team 74% · third 47%) → third · team 순, default 는 뺀다', () => {
    const plan = planPodAccounts([c('default', 100, true), c('team', 74), c('third', 47)]);
    expect(plan.usable).toEqual(['third', 'team']);
    expect(plan.excluded.map((e) => e.name)).toEqual(['default']);
  });
  test('Job 마다 돌려 준다 — 넷이면 third · team · third · team', () => {
    const next = makePodAccountBroker(planPodAccounts([c('team', 74), c('third', 47)]));
    expect([next(), next(), next(), next()]).toEqual(['third', 'team', 'third', 'team']);
  });
  test('문턱(95%) 이상은 빼고, 신호 없는 계정은 뒤로(빼지 않음)', () => {
    expect(planPodAccounts([c('a', 96), c('b'), c('c', 10)]).usable).toEqual(['c', 'b']);
  });
  test('쓸 계정이 없으면 이유와 명시 방법을 대고 던진다', () => {
    expect(() => makePodAccountBroker(planPodAccounts([c('default', 100, true)]))).toThrow('--pod-account');
  });
});
